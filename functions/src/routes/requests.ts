import { Router } from "express";
import * as admin from "firebase-admin";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { MentorshipRequest, RequestStatus } from "../types";
import { sendNewRequestEmail, sendMentorResponseEmail } from "../email";
import { notifyNewRequest, notifyRequestResponse } from "../notifications";

const router = Router();
const db = () => admin.firestore();

const MENTOR_TRANSITIONS: RequestStatus[] = ["approved", "rejected", "needs_info", "completed"];

// POST /requests - a mentee creates a new mentorship request
router.post("/", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const uid = req.uid as string;

    const userDoc = await db().collection("users").doc(uid).get();
    if (!userDoc.exists || userDoc.data()?.role !== "mentee") {
      res.status(403).json({ error: { code: "FORBIDDEN" } });
      return;
    }

    const { mentorId, topic, description } = req.body;
    if (!mentorId || !topic) {
      res.status(400).json({ error: { code: "MISSING_FIELDS" } });
      return;
    }

    const mentorDoc = await db().collection("mentorProfiles").doc(mentorId).get();
    if (!mentorDoc.exists) {
      res.status(404).json({ error: { code: "NOT_FOUND" } });
      return;
    }

    const now = admin.firestore.Timestamp.now();
    const data: MentorshipRequest = {
      menteeId: uid,
      mentorId,
      menteeName: userDoc.data()?.fullName,
      mentorName: mentorDoc.data()?.fullName,
      topic,
      description: description ?? null,
      status: "pending",
      mentorResponse: null,
      createdAt: now,
      updatedAt: now,
    };

    const ref = await db().collection("mentorshipRequests").add(data);

    sendNewRequestEmail(
      mentorDoc.data()?.email,
      mentorDoc.data()?.fullName,
      userDoc.data()?.fullName,
      topic
    ).catch((err) => console.error("Failed to send new-request email:", err));

    notifyNewRequest(mentorId, userDoc.data()?.fullName, topic, ref.id)
      .catch((err) => console.error("Failed to create new-request notification:", err));

    res.status(201).json({ id: ref.id, ...data });
  } catch (err) {
    console.error("POST /requests error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// GET /requests - list requests where the signed-in user is the mentee or the mentor
router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const uid = req.uid as string;

    const [asMentee, asMentor] = await Promise.all([
      db().collection("mentorshipRequests").where("menteeId", "==", uid).get(),
      db().collection("mentorshipRequests").where("mentorId", "==", uid).get(),
    ]);

    const requests = [...asMentee.docs, ...asMentor.docs].map((d) => ({ id: d.id, ...d.data() }));
    res.json(requests);
  } catch (err) {
    console.error("GET /requests error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// PATCH /requests/:id - mentor responds, or mentee resubmits after "needs_info"
router.patch("/:id", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const uid = req.uid as string;
    const ref = db().collection("mentorshipRequests").doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: { code: "NOT_FOUND" } });
      return;
    }

    const current = doc.data() as MentorshipRequest;
    const { status, mentorResponse } = req.body as { status?: RequestStatus; mentorResponse?: string };
    const now = admin.firestore.Timestamp.now();

    const isMentor = uid === current.mentorId;
    const isMentee = uid === current.menteeId;

    if (isMentor && status && MENTOR_TRANSITIONS.includes(status)) {
      await ref.update({
        status,
        mentorResponse: mentorResponse ?? null,
        updatedAt: now,
      });

      const menteeUserDoc = await db().collection("users").doc(current.menteeId).get();
      sendMentorResponseEmail(
        menteeUserDoc.data()?.email,
        current.menteeName,
        current.mentorName,
        status,
        mentorResponse ?? null
      ).catch((err) => console.error("Failed to send mentor-response email:", err));

      notifyRequestResponse(current.menteeId, current.mentorName, status, req.params.id)
        .catch((err) => console.error("Failed to create request-response notification:", err));

    } else if (isMentee && current.status === "needs_info" && status === "pending") {
      await ref.update({ status: "pending", updatedAt: now });
    } else {
      res.status(403).json({ error: { code: "FORBIDDEN" } });
      return;
    }

    const updated = await ref.get();
    res.json({ id: updated.id, ...updated.data() });
  } catch (err) {
    console.error("PATCH /requests/:id error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

export default router;
