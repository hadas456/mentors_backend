import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mutable mock state -- set these in each test before the request   */
/* ------------------------------------------------------------------ */
let mockUserDoc: { exists: boolean; data: () => Record<string, unknown> };
let mockMenteeDocs: Record<
  string,
  { exists: boolean; data: () => Record<string, unknown> }
>;
let mockMenteeSet: ReturnType<typeof vi.fn>;
let mockRequestsSnap: { empty: boolean };
const mockTimestamp = { seconds: 1000, nanoseconds: 0 };

/* ------------------------------------------------------------------ */
/*  firebase-admin mock (hoisted by vitest)                           */
/* ------------------------------------------------------------------ */
vi.mock("firebase-admin", () => {
  const collectionStub = (name: string) => {
    if (name === "menteeProfiles") {
      return {
        doc: (uid: string) => ({
          get: () => {
            const mock = mockMenteeDocs[uid];
            if (mock) return Promise.resolve({ id: uid, ...mock });
            return Promise.resolve({
              id: uid,
              exists: false,
              data: () => undefined,
            });
          },
          set: (...args: unknown[]) => {
            mockMenteeSet(...args);
            return Promise.resolve();
          },
        }),
      };
    }
    if (name === "users") {
      return {
        doc: () => ({
          get: () => Promise.resolve(mockUserDoc),
        }),
      };
    }
    if (name === "mentorshipRequests") {
      return {
        where: () => ({
          where: () => ({
            where: () => ({
              limit: () => ({
                get: () => Promise.resolve(mockRequestsSnap),
              }),
            }),
          }),
        }),
      };
    }
    return {};
  };

  const firestoreFn = Object.assign(
    () => ({ collection: collectionStub }),
    { Timestamp: { now: () => mockTimestamp } },
  );

  return {
    default: {
      initializeApp: vi.fn(),
      credential: { cert: vi.fn() },
      firestore: firestoreFn,
      auth: () => ({
        verifyIdToken: (token: string) => {
          if (token === "valid-token")
            return Promise.resolve({ uid: "test-uid" });
          return Promise.reject(new Error("Invalid token"));
        },
      }),
    },
    initializeApp: vi.fn(),
    credential: { cert: vi.fn() },
    firestore: firestoreFn,
    auth: () => ({
      verifyIdToken: (token: string) => {
        if (token === "valid-token")
          return Promise.resolve({ uid: "test-uid" });
        return Promise.reject(new Error("Invalid token"));
      },
    }),
  };
});

/* ------------------------------------------------------------------ */
/*  Other module mocks (prevent import side-effects)                  */
/* ------------------------------------------------------------------ */
vi.mock("../../src/email", () => ({
  sendVerificationCode: vi.fn(),
  sendNewRequestEmail: vi.fn(),
  sendMentorResponseEmail: vi.fn(),
  sendPasswordResetCode: vi.fn(),
}));

vi.mock("../../src/identityToolkit", () => ({
  signInWithPassword: vi.fn(),
  refreshIdToken: vi.fn(),
  IdentityToolkitError: class extends Error {
    code: string;
    constructor(c: string) {
      super(c);
      this.code = c;
    }
  },
}));

vi.mock("../../src/notifications", () => ({
  createNotification: vi.fn(),
  notifyNewRequest: vi.fn(),
  notifyRequestResponse: vi.fn(),
  notifyMenteeReply: vi.fn(),
  notifyMenteeCancel: vi.fn(),
}));

vi.mock("../../src/timeline", () => ({
  addTimelineEvent: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
  createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
}));

/* ------------------------------------------------------------------ */
/*  Imports AFTER mocks                                               */
/* ------------------------------------------------------------------ */
import request from "supertest";
import app from "../../src/app";

/* ------------------------------------------------------------------ */
/*  Reset mutable state before each test                              */
/* ------------------------------------------------------------------ */
beforeEach(() => {
  mockUserDoc = {
    exists: true,
    data: () => ({ isAdmin: false, role: "mentee" }),
  };
  mockMenteeDocs = {};
  mockMenteeSet = vi.fn();
  mockRequestsSnap = { empty: true };
});

/* ================================================================== */
/*  GET /mentees/me                                                   */
/* ================================================================== */
describe("GET /mentees/me", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/mentees/me");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns 404 when mentee profile does not exist", async () => {
    const res = await request(app)
      .get("/mentees/me")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND" } });
  });

  it("returns mentee profile when authenticated", async () => {
    mockMenteeDocs["test-uid"] = {
      exists: true,
      data: () => ({
        userId: "test-uid",
        fullName: "Test Mentee",
        email: "mentee@example.com",
        experienceLevel: "junior",
        interests: ["React"],
        goals: "Learn frontend",
        createdAt: mockTimestamp,
        updatedAt: mockTimestamp,
      }),
    };

    const res = await request(app)
      .get("/mentees/me")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "test-uid",
      userId: "test-uid",
      fullName: "Test Mentee",
      interests: ["React"],
    });
  });
});

/* ================================================================== */
/*  PUT /mentees/me                                                   */
/* ================================================================== */
describe("PUT /mentees/me", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app)
      .put("/mentees/me")
      .send({ interests: ["React"] });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns 403 when user role is not mentee", async () => {
    mockUserDoc = {
      exists: true,
      data: () => ({ isAdmin: false, role: "mentor" }),
    };

    const res = await request(app)
      .put("/mentees/me")
      .set("Authorization", "Bearer valid-token")
      .send({ interests: ["React"] });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "FORBIDDEN" } });
  });

  it("returns 400 MISSING_INTERESTS when interests is empty", async () => {
    const res = await request(app)
      .put("/mentees/me")
      .set("Authorization", "Bearer valid-token")
      .send({ interests: [] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_INTERESTS" } });
  });

  it("creates profile successfully with 200", async () => {
    mockUserDoc = {
      exists: true,
      data: () => ({
        isAdmin: false,
        role: "mentee",
        fullName: "Test Mentee",
        email: "mentee@example.com",
      }),
    };

    const res = await request(app)
      .put("/mentees/me")
      .set("Authorization", "Bearer valid-token")
      .send({
        experienceLevel: "junior",
        interests: ["React", "TypeScript"],
        goals: "Learn frontend development",
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "test-uid",
      userId: "test-uid",
      fullName: "Test Mentee",
      email: "mentee@example.com",
      experienceLevel: "junior",
      interests: ["React", "TypeScript"],
      goals: "Learn frontend development",
    });
    expect(mockMenteeSet).toHaveBeenCalledOnce();
  });
});

/* ================================================================== */
/*  GET /mentees/:uid                                                 */
/* ================================================================== */
describe("GET /mentees/:uid", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/mentees/some-uid");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns own profile when callerUid equals targetUid", async () => {
    mockMenteeDocs["test-uid"] = {
      exists: true,
      data: () => ({
        userId: "test-uid",
        fullName: "Test Mentee",
        interests: ["React"],
      }),
    };

    const res = await request(app)
      .get("/mentees/test-uid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "test-uid",
      userId: "test-uid",
      fullName: "Test Mentee",
    });
  });

  it("returns 403 ACCESS_DENIED when non-admin, non-self, no active request", async () => {
    mockRequestsSnap = { empty: true };

    const res = await request(app)
      .get("/mentees/other-uid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "ACCESS_DENIED" } });
  });

  it("returns profile when caller is admin", async () => {
    mockUserDoc = { exists: true, data: () => ({ isAdmin: true }) };
    mockMenteeDocs["other-uid"] = {
      exists: true,
      data: () => ({
        userId: "other-uid",
        fullName: "Other Mentee",
        interests: ["Node.js"],
      }),
    };

    const res = await request(app)
      .get("/mentees/other-uid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "other-uid",
      userId: "other-uid",
      fullName: "Other Mentee",
    });
  });

  it("returns 404 when mentee profile does not exist even with access", async () => {
    mockUserDoc = { exists: true, data: () => ({ isAdmin: true }) };

    const res = await request(app)
      .get("/mentees/nonexistent-uid")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND" } });
  });
});
