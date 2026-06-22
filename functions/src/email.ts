import { google } from "googleapis";
import { RequestStatus } from "./types";

const auth = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);
auth.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

const gmail = google.gmail({ version: "v1", auth });

function base() {
  return process.env.SITE_URL ?? "https://maakaf.com";
}

function mimeWord(text: string) {
  return `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`;
}

function layout(content: string) {
  return `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      ${content}
      <p style="color:#666;font-size:13px;margin-top:24px;">בברכה,<br/>צוות מעקף</p>
    </div>`;
}

function dashboardBtn(url: string, label: string) {
  return `<p><a href="${url}" style="display:inline-block;padding:10px 20px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:5px;">${label}</a></p>`;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  const raw = [
    `From: ${mimeWord("מעקף")} <${process.env.GMAIL_USER}>`,
    `To: ${to}`,
    `Subject: ${mimeWord(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "",
    html,
  ].join("\r\n");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: Buffer.from(raw).toString("base64url") },
  });
}

export async function sendWelcomeEmail(
  to: string,
  fullName: string,
  role: "mentor" | "mentee"
): Promise<void> {
  const isMentor = role === "mentor";
  const roleLabel = isMentor ? "מנטור/ית" : "מנטי";
  const dashboardUrl = isMentor
    ? `${base()}/he/mentorship/mentor-dashboard/`
    : `${base()}/he/mentorship/mentee-dashboard/`;

  await send(
    to,
    "ברוך/ה הבא/ה למערכת המנטורינג של מעקף!",
    layout(`
      <h2>שלום ${fullName},</h2>
      <p>החשבון שלך כ<strong>${roleLabel}</strong> במערכת המנטורינג של קהילת מעקף נוצר בהצלחה.</p>
      ${dashboardBtn(dashboardUrl, "כניסה לדשבורד שלי")}
    `)
  );
}

export async function sendNewRequestEmail(
  mentorEmail: string,
  mentorName: string,
  menteeName: string,
  topic: string
): Promise<void> {
  await send(
    mentorEmail,
    `בקשת מנטורינג חדשה מ-${menteeName}`,
    layout(`
      <h2>שלום ${mentorName},</h2>
      <p><strong>${menteeName}</strong> שלח/ה לך בקשת מנטורינג חדשה בנושא: <strong>${topic}</strong>.</p>
      ${dashboardBtn(`${base()}/he/mentorship/mentor-dashboard/`, "צפייה בבקשה ומענה")}
    `)
  );
}

const STATUS_LABELS: Record<string, string> = {
  approved:   "אושרה",
  rejected:   "נדחתה",
  needs_info: "דורש פרטים נוספים",
  completed:  "הושלמה",
};

export async function sendMentorResponseEmail(
  menteeEmail: string,
  menteeName: string,
  mentorName: string,
  status: RequestStatus,
  mentorResponse: string | null
): Promise<void> {
  const statusLabel = STATUS_LABELS[status] ?? status;
  const responseBlock = mentorResponse
    ? `<blockquote style="border-right:3px solid #0d6efd;margin:16px 0;padding:8px 16px;color:#444;">${mentorResponse}</blockquote>`
    : "";

  await send(
    menteeEmail,
    `עדכון בקשת המנטורינג שלך — ${statusLabel}`,
    layout(`
      <h2>שלום ${menteeName},</h2>
      <p>${mentorName} עדכן/ה את הבקשה שלך לסטטוס: <strong>${statusLabel}</strong>.</p>
      ${responseBlock}
      ${dashboardBtn(`${base()}/he/mentorship/mentee-dashboard/`, "מעבר לדשבורד שלי")}
    `)
  );
}

export async function sendPasswordResetEmail(
  to: string,
  resetLink: string
): Promise<void> {
  await send(
    to,
    "איפוס סיסמה — מעקף מנטורינג",
    layout(`
      <h2>איפוס סיסמה</h2>
      <p>קיבלנו בקשה לאיפוס הסיסמה שלך. לחצו על הכפתור כדי לאפס:</p>
      ${dashboardBtn(resetLink, "איפוס סיסמה")}
      <p style="color:#666;font-size:13px;">אם לא ביקשתם לאפס את הסיסמה, ניתן להתעלם מהודעה זו.</p>
    `)
  );
}
