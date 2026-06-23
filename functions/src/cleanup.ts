import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

const UNVERIFIED_TTL_MS = 24 * 60 * 60 * 1000;

export const cleanupUnverifiedAccounts = onSchedule(
  {
    schedule: "0 3 * * *",
    timeZone: "UTC",
    region: "europe-west1",
    timeoutSeconds: 300,
  },
  async () => {
    const db = admin.firestore();
    const cutoff = new Date(Date.now() - UNVERIFIED_TTL_MS);
    let pageToken: string | undefined;
    let authDeleted = 0;
    let authErrors = 0;
    let firestoreErrors = 0;

    do {
      const { users, pageToken: next } = await admin.auth().listUsers(1000, pageToken);

      const stale = users.filter(
        (u) => !u.emailVerified && new Date(u.metadata.creationTime) < cutoff
      );

      await Promise.allSettled(
        stale.map(async (user) => {
          // Delete Auth first — if this fails, we leave the account intact and retry tomorrow.
          // If Auth succeeds but Firestore fails, the orphaned docs are harmless (no login possible).
          try {
            await admin.auth().deleteUser(user.uid);
            authDeleted++;
          } catch (err) {
            authErrors++;
            console.error(`cleanup: failed to delete auth user ${user.uid}`, err);
            return;
          }

          try {
            const batch = db.batch();
            batch.delete(db.collection("users").doc(user.uid));
            batch.delete(db.collection("mentorProfiles").doc(user.uid));
            batch.delete(db.collection("menteeProfiles").doc(user.uid));
            await batch.commit();
          } catch (err) {
            firestoreErrors++;
            console.error(`cleanup: failed to delete firestore docs for ${user.uid}`, err);
          }
        })
      );

      pageToken = next;
    } while (pageToken);

    console.log(`cleanup: authDeleted=${authDeleted} authErrors=${authErrors} firestoreErrors=${firestoreErrors} cutoff=${cutoff.toISOString()}`);
  }
);
