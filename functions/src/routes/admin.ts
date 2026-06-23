import { Router } from "express";
import * as admin from "firebase-admin";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { RequestStatus } from "../types";

const router = Router();
const db = () => admin.firestore();

const STATUSES: RequestStatus[] = ["pending", "approved", "rejected", "needs_info", "completed"];

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

export default router;
