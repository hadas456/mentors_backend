import * as dotenv from "dotenv";
dotenv.config();

import * as admin from "firebase-admin";
import app from "./app";

if (admin.apps.length === 0) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      ),
    });
  } else {
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS env var
    admin.initializeApp();
  }
}

const REQUIRED_ENV = [
  "FIREBASE_API_KEY",
  "GMAIL_USER",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  console.error("[FATAL] Missing required environment variables:", missing.join(", "));
  process.exit(1);
}

if (process.env.ENABLE_DEV_ENDPOINTS === "true") {
  console.warn("[WARN] Dev endpoints are active — do not enable in production!");
}

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`mentorship-backend running at http://localhost:${PORT}`);
});
