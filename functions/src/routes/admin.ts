import { Router } from "express";
import * as admin from "firebase-admin";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { RequestStatus } from "../types";

const router = Router();
const db = () => admin.firestore();

const STATUSES: RequestStatus[] = ["pending", "approved", "rejected", "needs_info", "completed", "canceled"];

// GET /admin/stats - counts + request status breakdown for the admin page
router.get("/stats", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [mentors, mentees, requests] = await Promise.all([
      db().collection("mentorProfiles").count().get(),
      db().collection("menteeProfiles").count().get(),
      db().collection("mentorshipRequests").get(),
    ]);

    const requestsByStatus = STATUSES.reduce((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {} as Record<RequestStatus, number>);

    requests.docs.forEach((d) => {
      const status = d.data().status as RequestStatus;
      if (status in requestsByStatus) {
        requestsByStatus[status] += 1;
      }
    });

    const total = requests.size;
    const answered = requestsByStatus.approved + requestsByStatus.completed;

    res.json({
      mentorCount: mentors.data().count,
      menteeCount: mentees.data().count,
      requestCount: total,
      answeredRate: total === 0 ? 0 : Math.round((answered / total) * 100),
      requestsByStatus,
    });
  } catch (err) {
    console.error("GET /admin/stats error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// GET /admin/users/mentors
router.get("/users/mentors", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const snapshot = await db().collection("mentorProfiles").orderBy("createdAt", "desc").get();
    res.json(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error("GET /admin/users/mentors error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// GET /admin/users/mentees
router.get("/users/mentees", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const snapshot = await db().collection("menteeProfiles").orderBy("createdAt", "desc").get();
    res.json(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error("GET /admin/users/mentees error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// GET /admin/requests - all requests for the admin table
router.get("/requests", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const snapshot = await db()
      .collection("mentorshipRequests")
      .orderBy("createdAt", "desc")
      .get();

    const requests = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json(requests);
  } catch (err) {
    console.error("GET /admin/requests error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

export default router;
