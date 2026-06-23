import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { MentorProfile, MenteeProfile, UserDoc, UserRole } from "../types";
import { signInWithPassword, refreshIdToken, IdentityToolkitError } from "../identityToolkit";
import { sendVerificationEmail, sendPasswordResetEmail } from "../email";

const router = Router();
const db = () => admin.firestore();

// ─── Validation helpers ───────────────────────────────────────────────────────

function isValidRole(role: unknown): role is UserRole {
  return role === "mentor" || role === "mentee" || role === "admin";
}

function validateRegisterBody(body: Record<string, unknown>): string | null {
  const { role, fullName, email, password, expertise, interests } = body;
  if (!isValidRole(role)) return "INVALID_ROLE";
  if (!fullName || !email || !password) return "MISSING_FIELDS";
  if (role === "mentor" && (!Array.isArray(expertise) || expertise.length === 0)) return "MISSING_EXPERTISE";
  if (role === "mentee" && (!Array.isArray(interests) || interests.length === 0)) return "MISSING_INTERESTS";
  return null;
}

// ─── Profile builders ─────────────────────────────────────────────────────────

function buildMentorProfile(
  uid: string,
  fullName: string,
  email: string,
  body: Record<string, unknown>,
  now: admin.firestore.Timestamp
): MentorProfile {
  const { currentRole, company, expertise, yearsExperience, availability, linkedIn, calendlyUrl } = body;
  return {
    userId: uid,
    fullName,
    email,
    currentRole: (currentRole as string) ?? null,
    company: (company as string) ?? null,
    expertise: expertise as string[],
    yearsExperience: (yearsExperience as number) ?? null,
    availability: availability === "unavailable" ? "unavailable" : "available",
    linkedIn: (linkedIn as string) ?? null,
    calendlyUrl: (calendlyUrl as string) ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

function buildMenteeProfile(
  uid: string,
  fullName: string,
  email: string,
  body: Record<string, unknown>,
  now: admin.firestore.Timestamp
): MenteeProfile {
  const { interests, experienceLevel, goals } = body;
  return {
    userId: uid,
    fullName,
    email,
    experienceLevel: (experienceLevel as string) ?? null,
    interests: interests as string[],
    goals: (goals as string) ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

async function saveRoleProfile(
  uid: string,
  role: "mentor" | "mentee",
  fullName: string,
  email: string,
  body: Record<string, unknown>,
  now: admin.firestore.Timestamp
): Promise<void> {
  if (role === "mentor") {
    const profile = buildMentorProfile(uid, fullName, email, body, now);
    await db().collection("mentorProfiles").doc(uid).set(profile);
  } else {
    const profile = buildMenteeProfile(uid, fullName, email, body, now);
    await db().collection("menteeProfiles").doc(uid).set(profile);
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /auth/register
router.post("/register", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const { role, fullName, email, password } = body as {
    role?: UserRole;
    fullName?: string;
    email?: string;
    password?: string;
  };

  const validationError = validateRegisterBody(body);
  if (validationError) {
    res.status(400).json({ error: { code: validationError } });
    return;
  }

  let uid: string;
  try {
    const userRecord = await admin.auth().createUser({ email, password, displayName: fullName });
    uid = userRecord.uid;
  } catch (err) {
    const code = (err as { code?: string }).code ?? "auth/unknown-error";
    res.status(400).json({ error: { code } });
    return;
  }

  try {
    const now = admin.firestore.Timestamp.now();
    const userDoc: UserDoc = { role: role!, fullName: fullName!, email: email!, isAdmin: false, createdAt: now };
    await db().collection("users").doc(uid).set(userDoc);

    if (role === "admin") {
      res.status(201).json({ uid, email, role: "admin", pending: true });
      return;
    }

    await saveRoleProfile(uid, role as "mentor" | "mentee", fullName!, email!, body, now);
  } catch (err) {
    // Firestore failed — roll back the Auth user to prevent an orphaned account
    await admin.auth().deleteUser(uid).catch(() => {});
    console.error("Register: Firestore write failed", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
    return;
  }

  try {
    const verificationLink = await admin.auth().generateEmailVerificationLink(email!);
    sendVerificationEmail(email!, fullName!, verificationLink).catch((err) =>
      console.error("Failed to send verification email:", err)
    );
  } catch (err) {
    console.error("Failed to generate verification link:", err);
  }

  res.status(201).json({ uid, email, role, pendingVerification: true });
});

// POST /auth/forgot-password
router.post("/forgot-password", async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: { code: "MISSING_FIELDS" } });
    return;
  }

  try {
    const resetLink = await admin.auth().generatePasswordResetLink(email);
    await sendPasswordResetEmail(email, resetLink);
  } catch (err) {
    console.error("forgot-password error:", err);
  }

  res.json({ ok: true });
});

// GET /auth/verify-status/:uid - poll whether a user's email has been verified
router.get("/verify-status/:uid", async (req: Request, res: Response) => {
  try {
    const userRecord = await admin.auth().getUser(req.params.uid);
    res.json({ verified: userRecord.emailVerified });
  } catch {
    res.status(404).json({ error: { code: "USER_NOT_FOUND" } });
  }
});

// POST /auth/resend-verification
router.post("/resend-verification", async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: { code: "MISSING_FIELDS" } });
    return;
  }

  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    if (!userRecord.emailVerified) {
      const userDoc = await db().collection("users").doc(userRecord.uid).get();
      const fullName = (userDoc.data()?.fullName as string) ?? email;
      const verificationLink = await admin.auth().generateEmailVerificationLink(email);
      await sendVerificationEmail(email, fullName, verificationLink);
    }
  } catch (err) {
    console.error("resend-verification error:", err);
  }

  // Always respond ok — don't reveal whether the email exists or is already verified
  res.json({ ok: true });
});

// POST /auth/refresh - exchange a refresh token for a new ID token
router.post("/refresh", async (req: Request, res: Response) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    res.status(400).json({ error: { code: "MISSING_FIELDS" } });
    return;
  }
  try {
    const session = await refreshIdToken(refreshToken);
    res.json(session);
  } catch (err) {
    const code = err instanceof IdentityToolkitError ? err.code : "UNKNOWN_ERROR";
    res.status(401).json({ error: { code } });
  }
});

// POST /auth/login
router.post("/login", async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: { code: "MISSING_FIELDS" } });
    return;
  }

  // Pre-check emailVerified to avoid creating and discarding a Firebase session
  // token for unverified users. If the user is not found here, signInWithPassword
  // will handle it with the correct error code.
  try {
    const preCheck = await admin.auth().getUserByEmail(email);
    if (!preCheck.emailVerified) {
      res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED" }, uid: preCheck.uid });
      return;
    }
  } catch {
    // User not found — fall through to signInWithPassword
  }

  try {
    const session = await signInWithPassword(email, password);
    const userDoc = await db().collection("users").doc(session.localId).get();
    const data = userDoc.data();
    res.json({
      idToken: session.idToken,
      refreshToken: session.refreshToken,
      expiresIn: session.expiresIn,
      uid: session.localId,
      email: session.email,
      fullName: (data?.fullName as string) ?? null,
      role: (data?.role as UserRole) ?? null,
      isAdmin: (data?.isAdmin as boolean) ?? false,
    });
  } catch (err) {
    const code = err instanceof IdentityToolkitError ? err.code : "UNKNOWN_ERROR";
    res.status(401).json({ error: { code } });
  }
});

export default router;
