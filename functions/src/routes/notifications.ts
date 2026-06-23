import { Router } from "express";
import * as admin from "firebase-admin";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { NotificationDoc } from "../types";

const router = Router();
const db = () => admin.firestore();

const MAX_NOTIFICATIONS = 50;

// GET /notifications — fetch the signed-in user's recent notifications
router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const uid = req.uid as string;
    const snap = await db()
      .collection("notifications")
      .doc(uid)
      .collection("items")
      .orderBy("createdAt", "desc")
      .limit(MAX_NOTIFICATIONS)
      .get();

    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json(items);
  } catch (err) {
    console.error("GET /notifications error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// PATCH /notifications/:id/read — mark a single notification as read
router.patch("/:id/read", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const uid = req.uid as string;
    const ref = db()
      .collection("notifications")
      .doc(uid)
      .collection("items")
      .doc(req.params.id);

    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: { code: "NOT_FOUND" } });
      return;
    }

    await ref.update({ read: true } as Partial<NotificationDoc>);
    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /notifications/:id/read error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

// POST /notifications/read-all — mark all notifications as read
router.post("/read-all", requireAuth, async (req: AuthedRequest, res) => {
  try {
    const uid = req.uid as string;
    const snap = await db()
      .collection("notifications")
      .doc(uid)
      .collection("items")
      .where("read", "==", false)
      .get();

    if (!snap.empty) {
      const batch = db().batch();
      snap.docs.forEach((d) => batch.update(d.ref, { read: true }));
      await batch.commit();
    }

    res.json({ ok: true, updated: snap.size });
  } catch (err) {
    console.error("POST /notifications/read-all error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
  }
});

export default router;
