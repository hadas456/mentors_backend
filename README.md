# mentorship-backend

Backend (Firestore + Authentication + Express REST API) for the MAAKAF mentorship
system. Consumed by the מנטורינג pages in
[maakaf_home](https://github.com/Maakaf/maakaf_home) (`/he/mentorship/...`).
`maakaf_home` is a frontend-only client: it never calls Firebase directly, only this API.

> **Status:** DEV only. The API runs locally via `npm run dev` (plain Express on
> `localhost:3000`). Firebase project: `mentorship-backend-bf63b` (Firestore + Auth).

## Stack

- Express API — TypeScript, Node 20 (`functions/src/`)
- Firestore — data storage + security rules (`firestore.rules`)
- Firebase Authentication (email/password) — accounts are created and signed in
  **server-side** via `/auth/register` and `/auth/login`, using the Admin SDK and
  the Identity Toolkit REST API. The frontend never uses the Firebase SDK; it stores
  the returned ID token and sends it as `Authorization: Bearer <token>`.
- Gmail API (OAuth2) — transactional emails (verification, mentorship requests, password reset)
- Helmet — HTTP security headers (X-Content-Type-Options, Strict-Transport-Security, etc.)

### Shared utilities (`functions/src/`)

| File | Purpose |
| --- | --- |
| `utils.ts` | `generateOTP()` (crypto-random 6-digit code), `getOTPExpiry()`, `timingSafeEqual()` (constant-time comparison), `parseAvailability()` |
| `rateLimiter.ts` | In-memory per-key rate limiter with auto-pruning; used on login, OTP and reset endpoints |

### Dev/test code (`functions/src/dev/`)

Only loaded when `ENABLE_DEV_ENDPOINTS=true`. Never registered in production.

| File | Purpose |
| --- | --- |
| `routes.ts` | `DELETE /auth/dev/cleanup` — wipe test users; `GET /auth/dev/peek-otp/:uid` — read OTP from Firestore for automated Postman tests |

`functions/src/index.ts` is a dormant Firebase Cloud Functions entry kept for future
use if the project moves to the Firebase Blaze billing plan.

## Data model (Firestore)

```text
users/{uid}
  role: "mentor" | "mentee" | "admin"
  fullName
  email
  isAdmin
  createdAt
  verificationCode         (temporary — present only while email is unverified)
  verificationCodeExpiry   (Timestamp — code valid for 15 minutes)
  resetCode                (temporary — present only during an active password reset)
  resetCodeExpiry          (Timestamp — code valid for 15 minutes)

mentorProfiles/{uid}
  userId
  fullName
  email
  currentRole          (optional)
  company              (optional)
  expertise: string[]  (required)
  availability: "available" | "unavailable"
  linkedIn             (optional)
  calendlyUrl          (optional)
  createdAt
  updatedAt

menteeProfiles/{uid}
  userId
  fullName
  email
  experienceLevel      (optional)
  interests: string[]  (required)
  goals                (optional)
  createdAt
  updatedAt

mentorshipRequests/{id}
  menteeId
  mentorId
  menteeName      # denormalized for the mentor's dashboard
  mentorName      # denormalized for the mentee's dashboard
  topic
  description
  status: "pending" | "approved" | "rejected" | "needs_info" | "completed" | "canceled"
  mentorResponse  # mentor's last message (overwritten on each response)
  menteeReply     # mentee's reply after needs_info (overwritten on resubmit)
  createdAt
  updatedAt

  timeline/{eventId}   # subcollection — full conversation history
    type: "created" | "status_changed"
    authorId
    authorRole: "mentor" | "mentee"
    content           # message text, if any
    fromStatus        # null for the initial "created" event
    toStatus
    createdAt

topics/{id}
  name

notifications/{uid}/items/{notifId}
  type: "new_request" | "request_response"
  title
  body
  read
  requestId    # links to the specific mentorshipRequests doc
  createdAt
```

The required/optional split for `mentorProfiles` and `menteeProfiles` matches the
registration forms at `/he/mentorship/register/` in maakaf_home (mentor: שם מלא,
אימייל, סיסמה, תחומי התמחות required; mentee: שם מלא, אימייל, סיסמה, תחומי עניין
required). The `status` values match the badges shown on the dashboards:

| status | Hebrew badge | Who can set it |
| --- | --- | --- |
| `pending` | בהמתנה | system (on create or mentee resubmit) |
| `approved` | אושרה | mentor |
| `rejected` | נדחתה | mentor (response text required) |
| `needs_info` | דורש פרטים נוספים | mentor (response text required) |
| `completed` | הושלמה | mentor or mentee |
| `canceled` | בוטלה | mentee (only from `pending`) |

`users/{uid}` and the matching `mentorProfiles/{uid}`/`menteeProfiles/{uid}` doc are
created server-side by `POST /auth/register` using the Admin SDK (`role` and
`isAdmin: false` are set by the server, not the client).

## API

All endpoints listen directly on the Express server (no path prefix in dev).
Authenticated endpoints expect `Authorization: Bearer <Firebase ID token>`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/auth/register` | — | Create account, send 6-digit OTP to email, return `uid` + `pendingVerification: true` |
| POST | `/auth/verify-code` | — | Validate OTP (`uid`, `code`, `email`, `password`), mark email verified, auto-login — returns full session |
| POST | `/auth/resend-verification` | — | Generate + send a fresh OTP to the given email |
| POST | `/auth/login` | — | Sign in; if email unverified, sends fresh OTP and returns `403 EMAIL_NOT_VERIFIED` + `uid` |
| POST | `/auth/forgot-password` | — | Check email is registered (`USER_NOT_FOUND` if not), send 6-digit reset code, return `{ ok, uid }` |
| POST | `/auth/reset-password` | — | Validate reset code, set new password via Admin SDK, clear code from Firestore |
| GET | `/auth/verify-status/:uid` | — | Check whether a user's email has been verified |
| POST | `/auth/refresh` | — | Exchange a refresh token for a new ID token |
| GET | `/topics` | — | List shared mentorship topics |
| POST | `/topics` | admin | Add a topic |
| GET | `/mentors` | — | Public mentor directory. Query: `?topic=`, `?availability=` |
| GET | `/mentors/:id` | — | A single mentor profile |
| PUT | `/mentors/me` | mentor | Create/update the signed-in user's mentor profile |
| GET | `/mentees/me` | mentee | The signed-in user's mentee profile |
| GET | `/mentees/:uid` | mentor/admin/self | A mentee's profile |
| PUT | `/mentees/me` | mentee | Create/update the signed-in user's mentee profile |
| POST | `/requests` | mentee | Create a mentorship request (returns `409 DUPLICATE_REQUEST` if an active request with the same mentor already exists) |
| GET | `/requests` | any | List requests where the caller is the mentee or mentor |
| PATCH | `/requests/:id` | mentor/mentee | Update request status. Mentor: `approved`, `rejected`, `needs_info`, `completed`. Mentee: resubmit (`pending` + optional `menteeReply` after `needs_info`), `canceled` (from `pending`), `completed` (from `approved`) |
| GET | `/requests/:id/timeline` | mentor/mentee | Full chronological event history for a request |
| GET | `/admin/stats` | admin | Counts + status breakdown for the admin dashboard |
| GET | `/admin/requests` | admin | All mentorship requests ordered by date |
| GET | `/admin/users/mentors` | admin | All mentor profiles |
| GET | `/admin/users/mentees` | admin | All mentee profiles |
| GET | `/notifications` | any | The signed-in user's recent notifications (last 50) |
| PATCH | `/notifications/:id/read` | any | Mark a single notification as read |
| POST | `/notifications/read-all` | any | Mark all notifications as read |

## Local development

### 1. Credentials

Place your Firebase Admin service account key at `functions/serviceAccountKey.json`
(gitignored). Generate it from the Firebase Console → Project settings → Service
accounts → "Generate new private key".

Create `functions/.env` (see `functions/.env.example` for all variables and comments):

```env
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
FIREBASE_API_KEY=your-firebase-web-api-key
SITE_URL=http://localhost:1313

# Allowed CORS origin (defaults to SITE_URL; set to production domain in prod)
CORS_ORIGIN=http://localhost:1313

# Gmail API OAuth2 (console.cloud.google.com → Gmail API → OAuth2)
GMAIL_USER=donotreplymkf@gmail.com
GMAIL_CLIENT_ID=xxxx.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=xxxx
GMAIL_REFRESH_TOKEN=xxxx

# Suppress outgoing emails in local dev (do NOT set in production)
DISABLE_EMAILS=true
```

Alternatively, paste the entire service account JSON inline:

```env
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```

`FIREBASE_API_KEY` — Firebase Web API key from Firebase Console → Project settings → General.  
`GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` — Gmail API OAuth2 credentials. Create an OAuth2 client at [console.cloud.google.com](https://console.cloud.google.com) with the Gmail API enabled, then generate a refresh token via the OAuth2 Playground.  
`DISABLE_EMAILS=true` — set in `.env` to suppress outgoing emails during local development. Emails log to the console instead. Do not set this in production.  
`SITE_URL` — base URL of the frontend. Used in email links. Set to the production domain when deploying.

### 2. Run

```sh
# in mentorship-backend repo root
npm run dev
# → mentorship-backend running at http://localhost:3000
```

First time only: `cd functions && npm install`.

`maakaf_home` must also be running — from the `maakaf_home` repo root, run `hugo server`.

## Security

| Mechanism | Detail |
| --- | --- |
| **HTTP security headers** | Helmet sets `X-Content-Type-Options`, `Strict-Transport-Security`, `X-Frame-Options`, and 10+ others on every response. |
| **Startup validation** | Server exits on startup if any required env var is missing; logs a loud warning if `ENABLE_DEV_ENDPOINTS=true`. |
| **Rate limiting** | Login: 10/15 min per email. OTP verify & reset: 5/15 min per UID. Forgot-password & resend: 3/10 min per email. Blocked → `429 TOO_MANY_ATTEMPTS`. Counter cleared on success. |
| **Timing-safe OTP** | Code comparisons use `crypto.timingSafeEqual()` to prevent timing-based enumeration. |
| **Crypto-random OTP** | `crypto.randomInt()` — uniform distribution, no modulo bias. |
| **CORS** | Restricted to `CORS_ORIGIN` env var; all other origins rejected. |
| **Body size limit** | `express.json({ limit: "50kb" })` — oversized payloads rejected. |
| **Input validation** | `mentorId` and `topic` type-checked as non-empty strings before DB access. |
| **Error format** | All routes return `{ error: { code: "..." } }` — no plain-string errors. |
| **Privilege gating** | `requireAuth` + `requireAdmin` on all protected routes; `isAdmin` is server-set only. |
| **Mentee profile access** | Mentor can only view a mentee's profile while an active request (`pending`/`approved`/`needs_info`) exists between them. |

## Email notifications

Handled by `functions/src/email.ts` via the Gmail API (OAuth2). All sends are fire-and-forget — email failures are logged but never block the API response. Set `DISABLE_EMAILS=true` in `.env` to suppress emails locally.

All emails share a common `layout()` wrapper that includes the Maakaf logo (`https://maakaf.com/images/logo-light.png`) at the top and a sign-off at the bottom.

| Trigger | Recipient | Subject |
| --- | --- | --- |
| New user registers (mentor/mentee) | The new user | קוד האימות שלך — מעקף מנטורינג |
| Unverified user tries to log in | The user | קוד האימות שלך — מעקף מנטורינג |
| User requests a new OTP code | The user | קוד האימות שלך — מעקף מנטורינג |
| Mentee submits a request | The mentor | בקשת מנטורינג חדשה מ-{menteeName} (includes description + deep-link to request) |
| Mentor responds to a request | The mentee | עדכון בקשת המנטורינג שלך — {status} (includes response text + deep-link to request) |
| User requests password reset | The user | קוד לאיפוס סיסמה — מעקף מנטורינג |

Admin accounts (`role: "admin"`) are created without email verification and without sending an email. They require manual activation (`isAdmin: true`) in Firestore before they can access admin endpoints.

Email CTAs link directly to the specific request card via `#req-{requestId}` anchors on the dashboard pages.

## Firestore rules

Deploy rules independently of the API:

```sh
firebase deploy --only firestore:rules
```

## Testing

Manual API tests are in `tests/`. See [`tests/README_TESTS.md`](tests/README_TESTS.md) for full setup instructions.

**Quick start:**
1. Add `ENABLE_DEV_ENDPOINTS=true` to `functions/.env`
2. Start the backend: `cd functions && npm run dev`
3. In Postman: **Import** → `tests/Maakaf Mentorship API.postman_collection.json`
4. **Run collection** with 400 ms delay

The first request cleans up previous test data automatically.

## Firebase Cloud Functions (dormant)

`functions/src/index.ts` exports the same Express app as a Firebase Cloud Function.
To deploy it (requires the Blaze billing plan):

```sh
cd functions
npm run build
firebase deploy --only functions
```
