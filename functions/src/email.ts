import { google } from "googleapis";
import { RequestStatus } from "./types";

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

const gmail = google.gmail({ version: "v1", auth: oauth2Client });

const SITE_BASE = process.env.SITE_URL ?? "https://maakaf.com";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function mimeWord(text: string) {
  return `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`;
}

function layout(content: string) {
  return `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="text-align:center; margin-bottom:24px; padding-bottom:16px; border-bottom:1px solid #e6e6e6;">
        <img src="https://maakaf.com/images/logo-light.png"
             alt="מעקף"
             width="120"
             style="display:inline-block;" />
      </div>
      ${content}
      <p style="color:#666;font-size:13px;margin-top:24px;">בברכה,<br/>צוות מעקף</p>
    </div>`;
}

function dashboardBtn(url: string, label: string) {
  return `<p><a href="${url}" style="display:inline-block;padding:10px 20px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:5px;">${escapeHtml(label)}</a></p>`;
}

async function send(to: string, subject: string, html: string): Promise<void> {
  if (process.env.DISABLE_EMAILS === "true") {
    console.log(`[email] suppressed → to: ${to} | subject: ${subject}`);
    return;
  }

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

export async function sendVerificationCode(
  to: string,
  fullName: string,
  code: string
): Promise<void> {
  await send(
    to,
    "קוד האימות שלך — מעקף מנטורינג",
    layout(`
      <h2>שלום ${escapeHtml(fullName)},</h2>
      <p>ברוך/ה הבא/ה למערכת המנטורינג של קהילת מעקף!</p>
      <p>קוד האימות שלך:</p>
      <div style="font-size:36px;font-weight:700;letter-spacing:10px;text-align:center;padding:20px;background:#f0f4f8;border-radius:8px;margin:16px 0;">${escapeHtml(code)}</div>
      <p style="color:#666;font-size:13px;">הקוד תקף ל-15 דקות. אם לא נרשמתם, ניתן להתעלם מהודעה זו.</p>
    `)
  );
}

export async function sendNewRequestEmail(
  mentorEmail: string,
  mentorName: string,
  menteeName: string,
  topic: string,
  description: string | null,
  requestId: string
): Promise<void> {
  const descriptionBlock = description
    ? `<blockquote style="border-right:3px solid #0d6efd;margin:16px 0;padding:8px 16px;color:#444;">${escapeHtml(description)}</blockquote>`
    : "";

  await send(
    mentorEmail,
    `בקשת מנטורינג חדשה מ-${escapeHtml(menteeName)}`,
    layout(`
      <h2>שלום ${escapeHtml(mentorName)},</h2>
      <p><strong>${escapeHtml(menteeName)}</strong> שלח/ה לך בקשת מנטורינג חדשה בנושא: <strong>${escapeHtml(topic)}</strong>.</p>
      ${descriptionBlock}
      ${dashboardBtn(`${SITE_BASE}/he/mentorship/mentor-dashboard/#req-${requestId}`, "צפייה בבקשה ומענה")}
    `)
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending:    "בהמתנה",
  approved:   "אושרה",
  rejected:   "נדחתה",
  needs_info: "דורש פרטים נוספים",
  completed:  "הושלמה",
  canceled:   "בוטלה",
};

export async function sendMentorResponseEmail(
  menteeEmail: string,
  menteeName: string,
  mentorName: string,
  status: RequestStatus,
  mentorResponse: string | null,
  requestId: string
): Promise<void> {
  const statusLabel = STATUS_LABELS[status] ?? status;
  const responseBlock = mentorResponse
    ? `<blockquote style="border-right:3px solid #0d6efd;margin:16px 0;padding:8px 16px;color:#444;">${escapeHtml(mentorResponse)}</blockquote>`
    : "";

  await send(
    menteeEmail,
    `עדכון בקשת המנטורינג שלך — ${escapeHtml(statusLabel)}`,
    layout(`
      <h2>שלום ${escapeHtml(menteeName)},</h2>
      <p>${escapeHtml(mentorName)} עדכן/ה את הבקשה שלך לסטטוס: <strong>${statusLabel}</strong>.</p>
      ${responseBlock}
      ${dashboardBtn(`${SITE_BASE}/he/mentorship/mentee-dashboard/#req-${requestId}`, "מעבר לדשבורד שלי")}
    `)
  );
}

export async function sendPasswordResetCode(
  to: string,
  fullName: string,
  code: string
): Promise<void> {
  await send(
    to,
    "קוד לאיפוס סיסמה — מעקף מנטורינג",
    layout(`
      <h2>שלום ${escapeHtml(fullName)},</h2>
      <p>קיבלנו בקשה לאיפוס הסיסמה שלך. קוד האיפוס:</p>
      <div style="font-size:36px;font-weight:700;letter-spacing:10px;text-align:center;padding:20px;background:#f0f4f8;border-radius:8px;margin:16px 0;">${escapeHtml(code)}</div>
      <p style="color:#666;font-size:13px;">הקוד תקף ל-15 דקות. אם לא ביקשת/י לאפס סיסמה, ניתן להתעלם מהודעה זו.</p>
    `)
  );
}
