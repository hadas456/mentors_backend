/**
 * Dev/test endpoints — only registered when ENABLE_DEV_ENDPOINTS=true.
 * This entire folder is excluded from production: it is never imported unless
 * the flag is set in app.ts.
 */
import { Router } from "express";
import * as admin from "firebase-admin";

const router = Router();
const db = () => admin.firestore();

const TEST_EMAILS = [
  "test.mentor@maakaf-test.dev",
  "test.mentee@maakaf-test.dev",
  "test.admin@maakaf-test.dev",
];

// DELETE /auth/dev/cleanup — wipe all test users from Auth + Firestore
router.delete("/cleanup", async (_req, res) => {
  const results: Record<string, string> = {};
  for (const email of TEST_EMAILS) {
    try {
      const userRecord = await admin.auth().getUserByEmail(email);
      const uid = userRecord.uid;
      await Promise.all([
        admin.auth().deleteUser(uid),
        db().collection("users").doc(uid).delete(),
        db().collection("mentorProfiles").doc(uid).delete().catch(() => {}),
        db().collection("menteeProfiles").doc(uid).delete().catch(() => {}),
      ]);
      results[email] = "deleted";
    } catch {
      results[email] = "not_found";
    }
  }
  res.json({ ok: true, results });
});

// GET /auth/dev/peek-otp/:uid — read stored OTP code so Postman tests
// can verify without accessing the email inbox
router.get("/peek-otp/:uid", async (req, res) => {
  try {
    const userDoc = await db().collection("users").doc(req.params.uid).get();
    const data    = userDoc.data();
    if (!data) {
      res.status(404).json({ error: { code: "USER_NOT_FOUND" } });
      return;
    }
    res.json({
      verificationCode: data.verificationCode ?? null,
      resetCode:        data.resetCode ?? null,
    });
  } catch (err) {
    console.error("dev/peek-otp error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

export default router;
