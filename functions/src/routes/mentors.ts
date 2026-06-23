import { Router } from "express";
import * as admin from "firebase-admin";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { MentorProfile } from "../types";

const router = Router();
const db = () => admin.firestore();

// GET /mentors - public mentor directory, optional ?topic= & ?availability= filters
router.get("/", async (req, res) => {
  try {
    let query: admin.firestore.Query = db().collection("mentorProfiles");

    if (typeof req.query.availability === "string") {
      query = query.where("availability", "==", req.query.availability);
    }
    if (typeof req.query.topic === "string") {
      query = query.where("expertise", "array-contains", req.query.topic);
    }

    const snap = await query.get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error("GET /mentors error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// GET /mentors/:id - a single mentor profile
router.get("/:id", async (req, res) => {
  try {
    const doc = await db().collection("mentorProfiles").doc(req.params.id).get();
    if (!doc.exists) {
      res.status(404).json({ error: { code: "NOT_FOUND" } });
      return;
    }
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error("GET /mentors/:id error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// PUT /mentors/me - create or update the signed-in user's mentor profile
router.put("/me", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const uid = req.uid as string;

    const userDoc = await db().collection("users").doc(uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "mentor") {
      res.status(403).json({ error: { code: "FORBIDDEN" } });
      return;
    }

    const { currentRole, company, expertise, yearsExperience, availability, linkedIn, calendlyUrl } = req.body;
    if (!Array.isArray(expertise) || expertise.length === 0) {
      res.status(400).json({ error: { code: "MISSING_FIELDS" } });
      return;
    }

    const now = admin.firestore.Timestamp.now();
    const ref = db().collection("mentorProfiles").doc(uid);
    const existing = await ref.get();

    const profile: MentorProfile = {
      userId: uid,
      fullName: userDoc.data()?.fullName,
      email: userDoc.data()?.email,
      currentRole: currentRole ?? null,
      company: company ?? null,
      expertise,
      yearsExperience: yearsExperience ?? null,
      availability: availability === "unavailable" ? "unavailable" : "available",
      linkedIn: linkedIn ?? null,
      calendlyUrl: calendlyUrl ?? null,
      createdAt: existing.exists ? (existing.data() as MentorProfile).createdAt : now,
      updatedAt: now,
    };

    await ref.set(profile, { merge: true });
    res.json({ id: uid, ...profile });
  } catch (err) {
    console.error("PUT /mentors/me error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

export default router;
