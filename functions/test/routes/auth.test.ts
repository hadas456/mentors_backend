import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mutable mock state -- configure per test before the request       */
/* ------------------------------------------------------------------ */

// Firebase Auth mock state
let mockCreateUserResult: { uid: string } = { uid: "test-uid" };
let mockCreateUserError: { code: string } | null = null;
let mockGetUserResult: { emailVerified: boolean } = { emailVerified: false };
let mockGetUserError: Error | null = null;
let mockGetUserByEmailResult: { uid: string; emailVerified: boolean } = {
  uid: "test-uid",
  emailVerified: true,
};
let mockGetUserByEmailError: Error | null = null;
const mockUpdateUser = vi.fn().mockResolvedValue(undefined);
const mockDeleteUser = vi.fn().mockResolvedValue(undefined);

// Firestore mock state
let mockUserDocData: Record<string, unknown> | undefined = {
  fullName: "Test User",
  role: "mentor",
  isAdmin: false,
};
let mockUserDocExists = true;
const mockDocSet = vi.fn().mockResolvedValue(undefined);
const mockDocUpdate = vi.fn().mockResolvedValue(undefined);

// Identity toolkit mock state
const mockSignInWithPassword = vi.fn();
const mockRefreshIdToken = vi.fn();

/* ------------------------------------------------------------------ */
/*  firebase-admin mock (hoisted by vitest)                           */
/* ------------------------------------------------------------------ */
vi.mock("firebase-admin", () => {
  const collectionStub = () => ({
    doc: () => ({
      set: mockDocSet,
      get: () =>
        Promise.resolve({
          exists: mockUserDocExists,
          data: () => mockUserDocData,
        }),
      update: mockDocUpdate,
    }),
    // admin routes use .count().get(), .orderBy().get(), .where().get() etc.
    count: () => ({ get: () => Promise.resolve({ data: () => ({ count: 0 }) }) }),
    orderBy: () => ({ get: () => Promise.resolve({ docs: [] }) }),
    where: () => ({
      get: () => Promise.resolve({ docs: [], empty: true }),
      orderBy: () => ({
        limit: () => ({ get: () => Promise.resolve({ docs: [] }) }),
        get: () => Promise.resolve({ docs: [] }),
      }),
      where: () => ({
        get: () => Promise.resolve({ docs: [], empty: true }),
      }),
      limit: () => ({ get: () => Promise.resolve({ docs: [] }) }),
    }),
  });

  const authFn = () => ({
    createUser: () => {
      if (mockCreateUserError) return Promise.reject(mockCreateUserError);
      return Promise.resolve(mockCreateUserResult);
    },
    updateUser: (...args: unknown[]) => mockUpdateUser(...args),
    deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
    getUser: () => {
      if (mockGetUserError) return Promise.reject(mockGetUserError);
      return Promise.resolve(mockGetUserResult);
    },
    getUserByEmail: () => {
      if (mockGetUserByEmailError) return Promise.reject(mockGetUserByEmailError);
      return Promise.resolve(mockGetUserByEmailResult);
    },
    verifyIdToken: vi.fn().mockRejectedValue(new Error("no token")),
  });

  const firestoreFn = Object.assign(
    () => ({ collection: collectionStub }),
    {
      Timestamp: {
        now: () => ({ toDate: () => new Date(), seconds: 0, nanoseconds: 0 }),
        fromDate: (d: Date) => ({
          toDate: () => d,
          seconds: Math.floor(d.getTime() / 1000),
          nanoseconds: 0,
        }),
      },
      FieldValue: {
        delete: () => "__FIELD_DELETE__",
      },
    }
  );

  return {
    default: {
      initializeApp: vi.fn(),
      credential: { cert: vi.fn() },
      auth: authFn,
      firestore: firestoreFn,
    },
    initializeApp: vi.fn(),
    credential: { cert: vi.fn() },
    auth: authFn,
    firestore: firestoreFn,
  };
});

/* ------------------------------------------------------------------ */
/*  identityToolkit mock                                              */
/* ------------------------------------------------------------------ */
vi.mock("../../src/identityToolkit", () => ({
  signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
  refreshIdToken: (...args: unknown[]) => mockRefreshIdToken(...args),
  IdentityToolkitError: class IdentityToolkitError extends Error {
    code: string;
    constructor(c: string) {
      super(c);
      this.code = c;
    }
  },
}));

/* ------------------------------------------------------------------ */
/*  Other module mocks (prevent import side-effects)                  */
/* ------------------------------------------------------------------ */
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
  createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
}));

vi.mock("../../src/email", () => ({
  sendVerificationCode: vi.fn().mockResolvedValue(undefined),
  sendNewRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendMentorResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetCode: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
  notifyNewRequest: vi.fn().mockResolvedValue(undefined),
  notifyRequestResponse: vi.fn().mockResolvedValue(undefined),
  notifyMenteeReply: vi.fn().mockResolvedValue(undefined),
  notifyMenteeCancel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/timeline", () => ({
  addTimelineEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/utils", () => ({
  generateOTP: () => "123456",
  getOTPExpiry: () => ({
    toDate: () => new Date(Date.now() + 15 * 60 * 1000),
  }),
  timingSafeEqual: (a: string, b: string) => a === b,
  parseAvailability: (v: unknown) => (v === "unavailable" ? "unavailable" : "available"),
}));

vi.mock("../../src/rateLimiter", () => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
  clearRateLimit: vi.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Imports AFTER mocks                                               */
/* ------------------------------------------------------------------ */
import request from "supertest";
import app from "../../src/app";
import { IdentityToolkitError } from "../../src/identityToolkit";

/* ------------------------------------------------------------------ */
/*  Reset mutable state before each test                              */
/* ------------------------------------------------------------------ */
beforeEach(() => {
  mockCreateUserResult = { uid: "test-uid" };
  mockCreateUserError = null;
  mockGetUserResult = { emailVerified: false };
  mockGetUserError = null;
  mockGetUserByEmailResult = { uid: "test-uid", emailVerified: true };
  mockGetUserByEmailError = null;
  mockUpdateUser.mockReset().mockResolvedValue(undefined);
  mockDeleteUser.mockReset().mockResolvedValue(undefined);

  mockUserDocData = { fullName: "Test User", role: "mentor", isAdmin: false };
  mockUserDocExists = true;
  mockDocSet.mockReset().mockResolvedValue(undefined);
  mockDocUpdate.mockReset().mockResolvedValue(undefined);

  mockSignInWithPassword.mockReset();
  mockRefreshIdToken.mockReset();
});

/* ================================================================== */
/*  POST /auth/register                                               */
/* ================================================================== */
describe("POST /auth/register", () => {
  const validMentor = {
    role: "mentor",
    fullName: "Test Mentor",
    email: "mentor@test.com",
    password: "Password123",
    expertise: ["React", "TypeScript"],
  };

  it("returns 400 INVALID_ROLE for missing role", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ fullName: "Test", email: "a@b.com", password: "pass" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "INVALID_ROLE" } });
  });

  it("returns 400 INVALID_ROLE for invalid role value", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ role: "superuser", fullName: "Test", email: "a@b.com", password: "pass" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "INVALID_ROLE" } });
  });

  it("returns 400 MISSING_FIELDS when fullName is missing", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ role: "mentor", email: "a@b.com", password: "pass", expertise: ["React"] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 MISSING_FIELDS when email is missing", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ role: "mentor", fullName: "Test", password: "pass", expertise: ["React"] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 MISSING_FIELDS when password is missing", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ role: "mentor", fullName: "Test", email: "a@b.com", expertise: ["React"] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 MISSING_EXPERTISE for mentor with no expertise", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ role: "mentor", fullName: "Test", email: "a@b.com", password: "pass" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_EXPERTISE" } });
  });

  it("returns 400 MISSING_EXPERTISE for mentor with empty expertise array", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ role: "mentor", fullName: "Test", email: "a@b.com", password: "pass", expertise: [] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_EXPERTISE" } });
  });

  it("returns 400 MISSING_INTERESTS for mentee with no interests", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ role: "mentee", fullName: "Test", email: "a@b.com", password: "pass" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_INTERESTS" } });
  });

  it("returns 400 MISSING_INTERESTS for mentee with empty interests array", async () => {
    const res = await request(app)
      .post("/auth/register")
      .send({ role: "mentee", fullName: "Test", email: "a@b.com", password: "pass", interests: [] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_INTERESTS" } });
  });

  it("returns 400 with Firebase error code when createUser fails", async () => {
    mockCreateUserError = { code: "auth/email-already-exists" };

    const res = await request(app)
      .post("/auth/register")
      .send(validMentor);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "auth/email-already-exists" } });
  });

  it("returns 201 with uid, email, role, pendingVerification for successful mentor registration", async () => {
    mockCreateUserResult = { uid: "mentor-uid-1" };

    const res = await request(app)
      .post("/auth/register")
      .send(validMentor);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      uid: "mentor-uid-1",
      email: "mentor@test.com",
      role: "mentor",
      pendingVerification: true,
    });
    // User doc and mentor profile should have been created
    expect(mockDocSet).toHaveBeenCalled();
  });

  it("returns 201 with uid, email, role for successful mentee registration", async () => {
    mockCreateUserResult = { uid: "mentee-uid-1" };

    const res = await request(app)
      .post("/auth/register")
      .send({
        role: "mentee",
        fullName: "Test Mentee",
        email: "mentee@test.com",
        password: "Password123",
        interests: ["Node.js"],
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      uid: "mentee-uid-1",
      email: "mentee@test.com",
      role: "mentee",
      pendingVerification: true,
    });
  });

  it("returns 201 for admin registration with emailVerified set and no pendingVerification", async () => {
    mockCreateUserResult = { uid: "admin-uid-1" };

    const res = await request(app)
      .post("/auth/register")
      .send({
        role: "admin",
        fullName: "Admin User",
        email: "admin@test.com",
        password: "AdminPass123",
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      uid: "admin-uid-1",
      email: "admin@test.com",
      role: "admin",
      pending: true,
    });
    // Admin should have emailVerified set to true
    expect(mockUpdateUser).toHaveBeenCalledWith("admin-uid-1", { emailVerified: true });
    // Response should NOT contain pendingVerification
    expect(res.body).not.toHaveProperty("pendingVerification");
  });
});

/* ================================================================== */
/*  POST /auth/login                                                  */
/* ================================================================== */
describe("POST /auth/login", () => {
  it("returns 400 MISSING_FIELDS when email is missing", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ password: "pass" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 MISSING_FIELDS when password is missing", async () => {
    const res = await request(app)
      .post("/auth/login")
      .send({ email: "a@b.com" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 403 EMAIL_NOT_VERIFIED when user email is not verified", async () => {
    mockGetUserByEmailResult = { uid: "unverified-uid", emailVerified: false };

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "unverified@test.com", password: "pass" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("EMAIL_NOT_VERIFIED");
    expect(res.body.uid).toBe("unverified-uid");
  });

  it("returns 401 with identity toolkit error code on wrong credentials", async () => {
    // getUserByEmail succeeds with verified user, then signInWithPassword fails
    mockGetUserByEmailResult = { uid: "test-uid", emailVerified: true };
    mockSignInWithPassword.mockRejectedValue(new IdentityToolkitError("INVALID_PASSWORD"));

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "user@test.com", password: "wrongpass" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "INVALID_PASSWORD" } });
  });

  it("returns 401 when user not found in Auth and signInWithPassword fails", async () => {
    // getUserByEmail throws (user not found), falls through to signInWithPassword which also fails
    mockGetUserByEmailError = new Error("auth/user-not-found");
    mockSignInWithPassword.mockRejectedValue(new IdentityToolkitError("EMAIL_NOT_FOUND"));

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "noone@test.com", password: "pass" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "EMAIL_NOT_FOUND" } });
  });

  it("returns 200 with session data on successful login", async () => {
    mockGetUserByEmailResult = { uid: "logged-in-uid", emailVerified: true };
    mockSignInWithPassword.mockResolvedValue({
      idToken: "id-token-123",
      refreshToken: "refresh-token-456",
      expiresIn: "3600",
      localId: "logged-in-uid",
      email: "user@test.com",
    });
    mockUserDocData = { fullName: "Logged In User", role: "mentor", isAdmin: false };

    const res = await request(app)
      .post("/auth/login")
      .send({ email: "user@test.com", password: "correctpass" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      idToken: "id-token-123",
      refreshToken: "refresh-token-456",
      expiresIn: "3600",
      uid: "logged-in-uid",
      email: "user@test.com",
      fullName: "Logged In User",
      role: "mentor",
      isAdmin: false,
    });
  });
});

/* ================================================================== */
/*  POST /auth/verify-code                                            */
/* ================================================================== */
describe("POST /auth/verify-code", () => {
  it("returns 400 MISSING_FIELDS when uid is missing", async () => {
    const res = await request(app)
      .post("/auth/verify-code")
      .send({ code: "123456", email: "a@b.com", password: "pass" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 MISSING_FIELDS when code is missing", async () => {
    const res = await request(app)
      .post("/auth/verify-code")
      .send({ uid: "test-uid", email: "a@b.com", password: "pass" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 MISSING_FIELDS when email is missing", async () => {
    const res = await request(app)
      .post("/auth/verify-code")
      .send({ uid: "test-uid", code: "123456", password: "pass" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 MISSING_FIELDS when password is missing", async () => {
    const res = await request(app)
      .post("/auth/verify-code")
      .send({ uid: "test-uid", code: "123456", email: "a@b.com" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 INVALID_CODE when code does not match", async () => {
    mockUserDocData = {
      verificationCode: "999999",
      verificationCodeExpiry: { toDate: () => new Date(Date.now() + 60_000) },
      fullName: "Test",
      role: "mentor",
      isAdmin: false,
    };

    const res = await request(app)
      .post("/auth/verify-code")
      .send({ uid: "test-uid", code: "123456", email: "a@b.com", password: "pass" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "INVALID_CODE" } });
  });

  it("returns 400 INVALID_CODE when no code is stored", async () => {
    mockUserDocData = {
      fullName: "Test",
      role: "mentor",
      isAdmin: false,
    };

    const res = await request(app)
      .post("/auth/verify-code")
      .send({ uid: "test-uid", code: "123456", email: "a@b.com", password: "pass" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "INVALID_CODE" } });
  });

  it("returns 400 CODE_EXPIRED when OTP has expired", async () => {
    mockUserDocData = {
      verificationCode: "123456",
      verificationCodeExpiry: { toDate: () => new Date(Date.now() - 60_000) },
      fullName: "Test",
      role: "mentor",
      isAdmin: false,
    };

    const res = await request(app)
      .post("/auth/verify-code")
      .send({ uid: "test-uid", code: "123456", email: "a@b.com", password: "pass" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "CODE_EXPIRED" } });
  });

  it("returns 200 with session data on valid code", async () => {
    mockUserDocData = {
      verificationCode: "123456",
      verificationCodeExpiry: { toDate: () => new Date(Date.now() + 600_000) },
      fullName: "Verified User",
      role: "mentee",
      isAdmin: false,
    };
    mockSignInWithPassword.mockResolvedValue({
      idToken: "verified-id-token",
      refreshToken: "verified-refresh-token",
      expiresIn: "3600",
      localId: "test-uid",
      email: "verified@test.com",
    });

    const res = await request(app)
      .post("/auth/verify-code")
      .send({ uid: "test-uid", code: "123456", email: "verified@test.com", password: "pass" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      idToken: "verified-id-token",
      refreshToken: "verified-refresh-token",
      expiresIn: "3600",
      uid: "test-uid",
      email: "verified@test.com",
      fullName: "Verified User",
      role: "mentee",
      isAdmin: false,
    });
    // emailVerified should have been set to true
    expect(mockUpdateUser).toHaveBeenCalledWith("test-uid", { emailVerified: true });
  });
});

/* ================================================================== */
/*  POST /auth/resend-verification                                    */
/* ================================================================== */
describe("POST /auth/resend-verification", () => {
  it("returns 400 MISSING_FIELDS when email is missing", async () => {
    const res = await request(app)
      .post("/auth/resend-verification")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 200 ok:true even for non-existent email (does not leak info)", async () => {
    mockGetUserByEmailError = new Error("auth/user-not-found");

    const res = await request(app)
      .post("/auth/resend-verification")
      .send({ email: "nobody@test.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 200 ok:true for existing unverified user", async () => {
    mockGetUserByEmailResult = { uid: "unverified-uid", emailVerified: false };
    mockUserDocData = { fullName: "Unverified User" };

    const res = await request(app)
      .post("/auth/resend-verification")
      .send({ email: "unverified@test.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

/* ================================================================== */
/*  POST /auth/forgot-password                                        */
/* ================================================================== */
describe("POST /auth/forgot-password", () => {
  it("returns 400 MISSING_FIELDS when email is missing", async () => {
    const res = await request(app)
      .post("/auth/forgot-password")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 404 USER_NOT_FOUND when user does not exist", async () => {
    mockGetUserByEmailError = new Error("auth/user-not-found");

    const res = await request(app)
      .post("/auth/forgot-password")
      .send({ email: "nobody@test.com" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "USER_NOT_FOUND" } });
  });

  it("returns 200 with ok:true and uid on success", async () => {
    mockGetUserByEmailResult = { uid: "forgot-uid", emailVerified: true };
    mockUserDocData = { fullName: "Forgot User" };

    const res = await request(app)
      .post("/auth/forgot-password")
      .send({ email: "forgot@test.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, uid: "forgot-uid" });
  });
});

/* ================================================================== */
/*  POST /auth/reset-password                                         */
/* ================================================================== */
describe("POST /auth/reset-password", () => {
  it("returns 400 MISSING_FIELDS when uid is missing", async () => {
    const res = await request(app)
      .post("/auth/reset-password")
      .send({ code: "123456", newPassword: "NewPass123" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 MISSING_FIELDS when code is missing", async () => {
    const res = await request(app)
      .post("/auth/reset-password")
      .send({ uid: "test-uid", newPassword: "NewPass123" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 MISSING_FIELDS when newPassword is missing", async () => {
    const res = await request(app)
      .post("/auth/reset-password")
      .send({ uid: "test-uid", code: "123456" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 INVALID_CODE on wrong code", async () => {
    mockUserDocData = {
      resetCode: "999999",
      resetCodeExpiry: { toDate: () => new Date(Date.now() + 60_000) },
    };

    const res = await request(app)
      .post("/auth/reset-password")
      .send({ uid: "test-uid", code: "123456", newPassword: "NewPass123" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "INVALID_CODE" } });
  });

  it("returns 400 CODE_EXPIRED on expired code", async () => {
    mockUserDocData = {
      resetCode: "123456",
      resetCodeExpiry: { toDate: () => new Date(Date.now() - 60_000) },
    };

    const res = await request(app)
      .post("/auth/reset-password")
      .send({ uid: "test-uid", code: "123456", newPassword: "NewPass123" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "CODE_EXPIRED" } });
  });

  it("returns 200 ok:true on success", async () => {
    mockUserDocData = {
      resetCode: "123456",
      resetCodeExpiry: { toDate: () => new Date(Date.now() + 600_000) },
    };

    const res = await request(app)
      .post("/auth/reset-password")
      .send({ uid: "test-uid", code: "123456", newPassword: "NewPass123" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Password should have been updated
    expect(mockUpdateUser).toHaveBeenCalledWith("test-uid", { password: "NewPass123" });
  });
});

/* ================================================================== */
/*  GET /auth/verify-status/:uid                                      */
/* ================================================================== */
describe("GET /auth/verify-status/:uid", () => {
  it("returns 404 USER_NOT_FOUND for non-existent user", async () => {
    mockGetUserError = new Error("auth/user-not-found");

    const res = await request(app).get("/auth/verify-status/nonexistent-uid");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "USER_NOT_FOUND" } });
  });

  it("returns verified:true for verified user", async () => {
    mockGetUserError = null;
    mockGetUserResult = { emailVerified: true };

    const res = await request(app).get("/auth/verify-status/verified-uid");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ verified: true });
  });

  it("returns verified:false for unverified user", async () => {
    mockGetUserError = null;
    mockGetUserResult = { emailVerified: false };

    const res = await request(app).get("/auth/verify-status/unverified-uid");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ verified: false });
  });
});

/* ================================================================== */
/*  POST /auth/refresh                                                */
/* ================================================================== */
describe("POST /auth/refresh", () => {
  it("returns 400 MISSING_FIELDS when refreshToken is missing", async () => {
    const res = await request(app)
      .post("/auth/refresh")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 401 on invalid refresh token", async () => {
    mockRefreshIdToken.mockRejectedValue(new IdentityToolkitError("TOKEN_EXPIRED"));

    const res = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: "invalid-token" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "TOKEN_EXPIRED" } });
  });

  it("returns 200 with refreshed session", async () => {
    mockRefreshIdToken.mockResolvedValue({
      idToken: "new-id-token",
      refreshToken: "new-refresh-token",
      expiresIn: "3600",
    });

    const res = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken: "valid-refresh-token" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      idToken: "new-id-token",
      refreshToken: "new-refresh-token",
      expiresIn: "3600",
    });
  });
});
