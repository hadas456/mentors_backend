import { Router, Request, Response } from "express";
import * as admin from "firebase-admin";
import { MentorProfile, MenteeProfile, UserDoc, UserRole } from "../types";
import { signInWithPassword, refreshIdToken, IdentityToolkitError } from "../identityToolkit";
import { sendVerificationCode, sendPasswordResetCode, sendLoginCode } from "../email";
import { generateOTP, getOTPExpiry, timingSafeEqual, parseAvailability } from "../utils";
import { checkRateLimit, clearRateLimit } from "../rateLimiter";

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
    availability: parseAvailability(availability),
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
    await db().collection("mentorProfiles").doc(uid).set(buildMentorProfile(uid, fullName, email, body, now));
  } else {
    await db().collection("menteeProfiles").doc(uid).set(buildMenteeProfile(uid, fullName, email, body, now));
  }
}

// ─── OTP helpers ──────────────────────────────────────────────────────────────

async function issueOTP(
  userRef: admin.firestore.DocumentReference,
  field: "verificationCode" | "resetCode" | "loginCode"
): Promise<string> {
  const code   = generateOTP();
  const expiry = getOTPExpiry();
  await userRef.update({
    [field]:           code,
    [`${field}Expiry`]: expiry,
  });
  return code;
}

function validateOTP(
  data: admin.firestore.DocumentData,
  submittedCode: string,
  field: "verificationCode" | "resetCode" | "loginCode"
): "ok" | "INVALID_CODE" | "CODE_EXPIRED" {
  const stored = data[field];
  const expiry = data[`${field}Expiry`] as admin.firestore.Timestamp | undefined;

  if (!stored) return "INVALID_CODE";
  if (!expiry || expiry.toDate() < new Date()) return "CODE_EXPIRED";
  if (!timingSafeEqual(stored, submittedCode)) return "INVALID_CODE";
  return "ok";
}

async function clearOTP(
  userRef: admin.firestore.DocumentReference,
  field: "verificationCode" | "resetCode" | "loginCode"
): Promise<void> {
  await userRef.update({
    [field]:            admin.firestore.FieldValue.delete(),
    [`${field}Expiry`]: admin.firestore.FieldValue.delete(),
  });
}

/** True for admin accounts, which are exempt from mandatory login OTP. */
function isAdminAccount(data: admin.firestore.DocumentData | undefined): boolean {
  return data?.isAdmin === true || data?.role === "admin";
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /auth/register
router.post("/register", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const { role, fullName, email, password } = body as {
    role?: UserRole; fullName?: string; email?: string; password?: string;
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

    if (role === "mentor" || role === "mentee") {
      await saveRoleProfile(uid, role, fullName!, email!, body, now);
    }
  } catch (err) {
    await admin.auth().deleteUser(uid).catch(() => {});
    console.error("Register: Firestore write failed", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
    return;
  }

  if (role === "admin") {
    // Admin accounts skip email-OTP verification entirely; access is instead
    // gated by isAdmin (set false above) until an existing admin approves them.
    try {
      await admin.auth().updateUser(uid, { emailVerified: true });
    } catch (err) {
      console.error("Register: failed to mark admin account emailVerified", err);
    }
    res.status(201).json({ uid, email, role, pending: true });
    return;
  }

  try {
    const userRef = db().collection("users").doc(uid);
    const code    = await issueOTP(userRef, "verificationCode");
    await sendVerificationCode(email!, fullName!, code);
    console.log(`[verify] code email sent to ${email}`);
  } catch (err: any) {
    console.error("[verify] failed to send verification code email:", err?.message ?? err);
    console.error("[verify] Gmail error detail:", JSON.stringify(err?.response?.data ?? err?.errors ?? {}));
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

  // Rate-limit: 3 requests per 10 minutes per email
  if (!checkRateLimit(`forgot:${email}`, 3, 10 * 60 * 1000)) {
    res.status(429).json({ error: { code: "TOO_MANY_ATTEMPTS" } });
    return;
  }

  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    const userRef  = db().collection("users").doc(userRecord.uid);
    const userDoc  = await userRef.get();
    const fullName = (userDoc.data()?.fullName as string) ?? email;
    const code     = await issueOTP(userRef, "resetCode");
    await sendPasswordResetCode(email, fullName, code);
    console.log(`[reset] code sent to ${email}`);
  } catch (err) {
    // Don't reveal whether the email exists — log and fall through
    console.error("[reset] forgot-password error:", err);
  }

  // Always respond ok — don't reveal whether the email exists
  res.json({ ok: true });
});

// POST /auth/reset-password
router.post("/reset-password", async (req: Request, res: Response) => {
  const { email, code, newPassword } = req.body as {
    email?: string; code?: string; newPassword?: string;
  };

  if (!email || !code || !newPassword) {
    res.status(400).json({ error: { code: "MISSING_FIELDS" } });
    return;
  }

  // Rate-limit: 5 attempts per 15 minutes per email
  if (!checkRateLimit(`reset:${email}`, 5, 15 * 60 * 1000)) {
    res.status(429).json({ error: { code: "TOO_MANY_ATTEMPTS" } });
    return;
  }

  let uid: string;
  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    uid = userRecord.uid;
  } catch {
    res.status(404).json({ error: { code: "USER_NOT_FOUND" } });
    return;
  }

  try {
    const userRef = db().collection("users").doc(uid);
    const userDoc = await userRef.get();
    const data    = userDoc.data();

    const result = validateOTP(data ?? {}, code, "resetCode");
    if (result !== "ok") {
      res.status(400).json({ error: { code: result } });
      return;
    }

    await admin.auth().updateUser(uid, { password: newPassword });
    await clearOTP(userRef, "resetCode");
    clearRateLimit(`reset:${email}`);

    res.json({ ok: true });
  } catch (err: any) {
    const errCode = err?.errorInfo?.code ?? "INTERNAL_ERROR";
    res.status(400).json({ error: { code: errCode } });
  }
});

// GET /auth/verify-status/:uid
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

  // Rate-limit: 3 resends per 10 minutes per email
  if (!checkRateLimit(`resend:${email}`, 3, 10 * 60 * 1000)) {
    res.status(429).json({ error: { code: "TOO_MANY_ATTEMPTS" } });
    return;
  }

  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    if (!userRecord.emailVerified) {
      const userRef  = db().collection("users").doc(userRecord.uid);
      const userDoc  = await userRef.get();
      const fullName = (userDoc.data()?.fullName as string) ?? email;
      const code     = await issueOTP(userRef, "verificationCode");
      await sendVerificationCode(email, fullName, code);
    }
  } catch (err) {
    console.error("resend-verification error:", err);
  }

  // Always respond ok — don't reveal whether the email exists or is already verified
  res.json({ ok: true });
});

// POST /auth/verify-code
router.post("/verify-code", async (req: Request, res: Response) => {
  const { uid, code, email, password } = req.body as {
    uid?: string; code?: string; email?: string; password?: string;
  };

  if (!uid || !code || !email || !password) {
    res.status(400).json({ error: { code: "MISSING_FIELDS" } });
    return;
  }

  // Rate-limit: 5 attempts per 15 minutes per uid
  if (!checkRateLimit(`verify:${uid}`, 5, 15 * 60 * 1000)) {
    res.status(429).json({ error: { code: "TOO_MANY_ATTEMPTS" } });
    return;
  }

  try {
    const userRef = db().collection("users").doc(uid);
    const userDoc = await userRef.get();
    const data    = userDoc.data();

    const result = validateOTP(data ?? {}, code, "verificationCode");
    if (result !== "ok") {
      res.status(400).json({ error: { code: result } });
      return;
    }

    await admin.auth().updateUser(uid, { emailVerified: true });
    await clearOTP(userRef, "verificationCode");
    clearRateLimit(`verify:${uid}`);

    const session = await signInWithPassword(email, password);
    res.json({
      idToken:      session.idToken,
      refreshToken: session.refreshToken,
      expiresIn:    session.expiresIn,
      uid:          session.localId,
      email:        session.email,
      fullName:     (data?.fullName as string) ?? null,
      role:         (data?.role as string) ?? null,
      isAdmin:      (data?.isAdmin as boolean) ?? false,
    });
  } catch (err) {
    console.error("verify-code error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// POST /auth/refresh
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

  // Rate-limit: 10 login attempts per 15 minutes per email
  if (!checkRateLimit(`login:${email}`, 10, 15 * 60 * 1000)) {
    res.status(429).json({ error: { code: "TOO_MANY_ATTEMPTS" } });
    return;
  }

  try {
    const preCheck = await admin.auth().getUserByEmail(email);
    if (!preCheck.emailVerified) {
      try {
        const userRef  = db().collection("users").doc(preCheck.uid);
        const userDoc  = await userRef.get();
        const fullName = (userDoc.data()?.fullName as string) ?? email;
        const code     = await issueOTP(userRef, "verificationCode");
        await sendVerificationCode(email, fullName, code);
        console.log(`[verify] login: code sent to ${email}`);
      } catch (codeErr) {
        console.error("[verify] login: failed to send code:", codeErr);
      }
      res.status(403).json({ error: { code: "EMAIL_NOT_VERIFIED" }, uid: preCheck.uid });
      return;
    }
  } catch {
    // User not found — fall through to signInWithPassword
  }

  try {
    const session = await signInWithPassword(email, password);
    const userRef = db().collection("users").doc(session.localId);
    const userDoc = await userRef.get();
    const data    = userDoc.data();

    if (!isAdminAccount(data)) {
      // Mandatory login OTP for mentor/mentee accounts. Password is already
      // validated above, so we never email a code to an unauthenticated caller.
      if (!checkRateLimit(`login-otp:${session.localId}`, 5, 15 * 60 * 1000)) {
        res.status(429).json({ error: { code: "TOO_MANY_ATTEMPTS" } });
        return;
      }
      try {
        const fullName = (data?.fullName as string) ?? email;
        const code     = await issueOTP(userRef, "loginCode");
        await sendLoginCode(email, fullName, code);
        console.log(`[login-otp] code sent to ${email}`);
      } catch (codeErr) {
        console.error("[login-otp] failed to send code:", codeErr);
      }
      res.status(403).json({ error: { code: "LOGIN_CODE_REQUIRED" }, uid: session.localId });
      return;
    }

    clearRateLimit(`login:${email}`);
    res.json({
      idToken:      session.idToken,
      refreshToken: session.refreshToken,
      expiresIn:    session.expiresIn,
      uid:          session.localId,
      email:        session.email,
      fullName:     (data?.fullName as string) ?? null,
      role:         (data?.role as UserRole) ?? null,
      isAdmin:      (data?.isAdmin as boolean) ?? false,
    });
  } catch (err) {
    const code = err instanceof IdentityToolkitError ? err.code : "UNKNOWN_ERROR";
    res.status(401).json({ error: { code } });
  }
});

// POST /auth/login/verify-code
router.post("/login/verify-code", async (req: Request, res: Response) => {
  const { uid, code, email, password } = req.body as {
    uid?: string; code?: string; email?: string; password?: string;
  };

  if (!uid || !code || !email || !password) {
    res.status(400).json({ error: { code: "MISSING_FIELDS" } });
    return;
  }

  // Rate-limit: 5 attempts per 15 minutes per uid
  if (!checkRateLimit(`login-verify:${uid}`, 5, 15 * 60 * 1000)) {
    res.status(429).json({ error: { code: "TOO_MANY_ATTEMPTS" } });
    return;
  }

  try {
    const userRef = db().collection("users").doc(uid);
    const userDoc = await userRef.get();
    const data    = userDoc.data();

    const result = validateOTP(data ?? {}, code, "loginCode");
    if (result !== "ok") {
      res.status(400).json({ error: { code: result } });
      return;
    }

    await clearOTP(userRef, "loginCode");
    clearRateLimit(`login-verify:${uid}`);
    clearRateLimit(`login-otp:${uid}`);
    clearRateLimit(`login:${email}`);

    const session = await signInWithPassword(email, password);
    res.json({
      idToken:      session.idToken,
      refreshToken: session.refreshToken,
      expiresIn:    session.expiresIn,
      uid:          session.localId,
      email:        session.email,
      fullName:     (data?.fullName as string) ?? null,
      role:         (data?.role as string) ?? null,
      isAdmin:      (data?.isAdmin as boolean) ?? false,
    });
  } catch (err) {
    if (err instanceof IdentityToolkitError) {
      res.status(401).json({ error: { code: err.code } });
      return;
    }
    console.error("login/verify-code error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// POST /auth/login/resend-code
router.post("/login/resend-code", async (req: Request, res: Response) => {
  const { uid, email } = req.body as { uid?: string; email?: string };
  if (!uid || !email) {
    res.status(400).json({ error: { code: "MISSING_FIELDS" } });
    return;
  }

  // Rate-limit: 3 resends per 10 minutes per uid
  if (!checkRateLimit(`login-resend:${uid}`, 3, 10 * 60 * 1000)) {
    res.status(429).json({ error: { code: "TOO_MANY_ATTEMPTS" } });
    return;
  }

  try {
    const userRef = db().collection("users").doc(uid);
    const userDoc = await userRef.get();
    if (userDoc.exists) {
      const data = userDoc.data();
      if (!isAdminAccount(data)) {
        const fullName = (data?.fullName as string) ?? email;
        const code     = await issueOTP(userRef, "loginCode");
        await sendLoginCode(email, fullName, code);
      }
    }
  } catch (err) {
    console.error("login/resend-code error:", err);
  }

  // Always respond ok — don't leak existence or admin status
  res.json({ ok: true });
});

export default router;
