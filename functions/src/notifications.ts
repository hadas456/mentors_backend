import * as admin from "firebase-admin";
import { NotificationDoc, NotificationType, RequestStatus } from "./types";

const db = () => admin.firestore();

const STATUS_LABELS: Record<string, string> = {
  approved:   "אושרה",
  rejected:   "נדחתה",
  needs_info: "דורש פרטים נוספים",
  completed:  "הושלמה",
};

export async function createNotification(
  uid: string,
  type: NotificationType,
  title: string,
  body: string,
  requestId?: string
): Promise<void> {
  const doc: NotificationDoc = {
    type,
    title,
    body,
    read: false,
    createdAt: admin.firestore.Timestamp.now(),
    ...(requestId ? { requestId } : {}),
  };
  await db().collection("notifications").doc(uid).collection("items").add(doc);
}

export function notifyNewRequest(
  mentorId: string,
  menteeName: string,
  topic: string,
  requestId: string
): Promise<void> {
  return createNotification(
    mentorId,
    "new_request",
    "בקשת מנטורינג חדשה",
    `${menteeName} שלח/ה לך בקשת מנטורינג בנושא: ${topic}`,
    requestId
  );
}

export function notifyRequestResponse(
  menteeId: string,
  mentorName: string,
  status: RequestStatus,
  requestId: string
): Promise<void> {
  const statusLabel = STATUS_LABELS[status] ?? status;
  return createNotification(
    menteeId,
    "request_response",
    `עדכון בקשת המנטורינג שלך — ${statusLabel}`,
    `${mentorName} עדכן/ה את הבקשה שלך לסטטוס: ${statusLabel}`,
    requestId
  );
}
