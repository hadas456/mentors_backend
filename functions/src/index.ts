import * as admin from "firebase-admin";
import { onRequest } from "firebase-functions/v2/https";

import app from "./app";
export { cleanupUnverifiedAccounts } from "./cleanup";

admin.initializeApp();

export const api = onRequest({ region: "europe-west1" }, app);
