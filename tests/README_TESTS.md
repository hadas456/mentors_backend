# Maakaf Mentorship API — Test Suite

Manual API tests using [Postman](https://www.postman.com/).
The collection covers all 26 endpoints across 6 domains and is fully automated —
no manual copy-paste of tokens or OTP codes required.

---

## Prerequisites

| Requirement | Details |
|---|---|
| Backend running | `cd functions && npm run dev` (port 3000) |
| `ENABLE_DEV_ENDPOINTS=true` | Must be set in `functions/.env` |
| Postman desktop app | [Download](https://www.postman.com/downloads/) |

---

## Setup

1. Open Postman → **File → Import** → select `Maakaf Mentorship API.postman_collection.json`
2. The collection includes all variables pre-configured (`baseUrl = http://localhost:3000`)

---

## Running the tests

1. In Postman, open the collection → click **Run collection**
2. Set **Delay** to `400 ms`
3. Leave all other settings at their defaults
4. Click **Start run**

The runner executes all requests in order. Tokens, UIDs, and IDs are saved
automatically between requests — no manual steps needed.

---

## How it works

### Test users

The collection creates three fictional test users and deletes them from the start:

| Role | Name | Email | Password |
|---|---|---|---|
| Mentor | דניאל כהן | test.mentor@maakaf-test.dev | Test1234! |
| Mentee | מיה לוי | test.mentee@maakaf-test.dev | Test1234! |
| Admin | מנהל מערכת | test.admin@maakaf-test.dev | Test1234! |

The first request (`⚙️ Cleanup Test Users`) deletes any leftover data from a
previous run, making the suite fully **idempotent** — safe to run repeatedly.

### OTP automation

Email verification and password reset normally require reading a code from an
inbox. When `ENABLE_DEV_ENDPOINTS=true`, two test-only endpoints are available:

| Endpoint | Purpose |
|---|---|
| `DELETE /auth/dev/cleanup` | Wipe test users from Firebase Auth + Firestore |
| `GET /auth/dev/peek-otp/:uid` | Read the current OTP code for a user from Firestore |

Postman pre-request scripts call `peek-otp` automatically before each OTP
submission step, so the full verification flow runs without any human input.

> **These endpoints return 404 in production.** They are only registered when
> `ENABLE_DEV_ENDPOINTS=true` and that variable must never be set on the
> production server.

### Request flow (Requests folder)

The mentorship request lifecycle is tested in this order to avoid conflicts:

```
Create Request → Duplicate (expect 409) → Needs Info → Reply →
Approve → Timeline → Complete → Create #2 → Cancel
```

---

## Folder structure

| Folder | What it tests |
|---|---|
| 🔐 Auth | Register, OTP verify, login, refresh, forgot/reset password, edge cases |
| 👨‍💼 Mentors | Public directory, filters, single profile, update profile |
| 👩‍🎓 Mentees | Get/update own profile |
| 📋 Requests | Full lifecycle: pending → needs_info → approved → completed + cancel path |
| 📚 Topics | List topics, add topic (non-admin expect 403) |
| 🔔 Notifications | List, mark read, mark all read |
| 🛡️ Admin | Access control (expect 401/403 without admin token) |

---

## After testing

The test users are cleaned up at the **start** of each run, not the end —
so they remain in Firebase after the last run. To remove them manually:

```
DELETE http://localhost:3000/auth/dev/cleanup
```

Or delete them directly from the [Firebase console](https://console.firebase.google.com)
under **Authentication → Users**.
