import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mutable mock state – set these in each test before the request    */
/* ------------------------------------------------------------------ */
let mockMentorCount = 5;
let mockMenteeCount = 10;
let mockRequestDocs: Array<{
  id: string;
  data: () => Record<string, unknown>;
}> = [];
let mockMentorDocs: Array<{
  id: string;
  data: () => Record<string, unknown>;
}> = [];
let mockMenteeDocs: Array<{
  id: string;
  data: () => Record<string, unknown>;
}> = [];
let mockUserDoc = { exists: true, data: () => ({ isAdmin: true }) };

/* ------------------------------------------------------------------ */
/*  firebase-admin mock (hoisted by vitest)                           */
/* ------------------------------------------------------------------ */
vi.mock("firebase-admin", () => {
  const collectionStub = (name: string) => {
    if (name === "mentorProfiles") {
      return {
        count: () => ({
          get: () =>
            Promise.resolve({ data: () => ({ count: mockMentorCount }) }),
        }),
        orderBy: () => ({
          get: () =>
            Promise.resolve({ docs: mockMentorDocs }),
        }),
      };
    }
    if (name === "menteeProfiles") {
      return {
        count: () => ({
          get: () =>
            Promise.resolve({ data: () => ({ count: mockMenteeCount }) }),
        }),
        orderBy: () => ({
          get: () =>
            Promise.resolve({ docs: mockMenteeDocs }),
        }),
      };
    }
    if (name === "mentorshipRequests") {
      return {
        get: () =>
          Promise.resolve({
            docs: mockRequestDocs,
            size: mockRequestDocs.length,
          }),
        orderBy: () => ({
          get: () =>
            Promise.resolve({ docs: mockRequestDocs }),
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
    return {};
  };

  const firestoreFn = () => ({
    collection: collectionStub,
  });

  return {
    default: {
      initializeApp: vi.fn(),
      credential: { cert: vi.fn() },
      firestore: firestoreFn,
      auth: () => ({
        verifyIdToken: (token: string) => {
          if (token === "valid-token")
            return Promise.resolve({ uid: "admin-uid" });
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
          return Promise.resolve({ uid: "admin-uid" });
        return Promise.reject(new Error("Invalid token"));
      },
    }),
  };
});

/* ------------------------------------------------------------------ */
/*  Other module mocks (prevent import side-effects)                  */
/* ------------------------------------------------------------------ */
vi.mock("../../src/email", () => ({
  sendVerificationCode: vi.fn().mockResolvedValue(undefined),
  sendNewRequestEmail: vi.fn().mockResolvedValue(undefined),
  sendMentorResponseEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetCode: vi.fn().mockResolvedValue(undefined),
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
  createNotification: vi.fn().mockResolvedValue(undefined),
  notifyNewRequest: vi.fn().mockResolvedValue(undefined),
  notifyRequestResponse: vi.fn().mockResolvedValue(undefined),
  notifyMenteeReply: vi.fn().mockResolvedValue(undefined),
  notifyMenteeCancel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/timeline", () => ({
  addTimelineEvent: vi.fn().mockResolvedValue(undefined),
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
  mockMentorCount = 5;
  mockMenteeCount = 10;
  mockRequestDocs = [];
  mockMentorDocs = [];
  mockMenteeDocs = [];
  mockUserDoc = { exists: true, data: () => ({ isAdmin: true }) };
});

/* ================================================================== */
/*  GET /admin/stats                                                  */
/* ================================================================== */
describe("GET /admin/stats", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/admin/stats");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns 403 when user is not admin", async () => {
    mockUserDoc = { exists: true, data: () => ({ isAdmin: false }) };

    const res = await request(app)
      .get("/admin/stats")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "FORBIDDEN" } });
  });

  it("returns stats with counts and requestsByStatus", async () => {
    mockMentorCount = 3;
    mockMenteeCount = 7;
    mockRequestDocs = [
      { id: "r1", data: () => ({ status: "pending" }) },
      { id: "r2", data: () => ({ status: "approved" }) },
      { id: "r3", data: () => ({ status: "completed" }) },
      { id: "r4", data: () => ({ status: "rejected" }) },
    ];

    const res = await request(app)
      .get("/admin/stats")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      mentorCount: 3,
      menteeCount: 7,
      requestCount: 4,
      answeredRate: 50, // (approved + completed) / total = 2/4 = 50%
      requestsByStatus: {
        pending: 1,
        approved: 1,
        rejected: 1,
        needs_info: 0,
        completed: 1,
        canceled: 0,
      },
    });
  });
});

/* ================================================================== */
/*  GET /admin/users/mentors                                          */
/* ================================================================== */
describe("GET /admin/users/mentors", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/admin/users/mentors");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns 403 when user is not admin", async () => {
    mockUserDoc = { exists: true, data: () => ({ isAdmin: false }) };

    const res = await request(app)
      .get("/admin/users/mentors")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "FORBIDDEN" } });
  });

  it("returns list of mentor profiles", async () => {
    mockMentorDocs = [
      { id: "m1", data: () => ({ name: "Alice", topic: "React" }) },
      { id: "m2", data: () => ({ name: "Bob", topic: "Node" }) },
    ];

    const res = await request(app)
      .get("/admin/users/mentors")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "m1", name: "Alice", topic: "React" },
      { id: "m2", name: "Bob", topic: "Node" },
    ]);
  });
});

/* ================================================================== */
/*  GET /admin/users/mentees                                          */
/* ================================================================== */
describe("GET /admin/users/mentees", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/admin/users/mentees");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns 403 when user is not admin", async () => {
    mockUserDoc = { exists: true, data: () => ({ isAdmin: false }) };

    const res = await request(app)
      .get("/admin/users/mentees")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "FORBIDDEN" } });
  });

  it("returns list of mentee profiles", async () => {
    mockMenteeDocs = [
      { id: "e1", data: () => ({ name: "Charlie", interest: "Backend" }) },
      { id: "e2", data: () => ({ name: "Dana", interest: "Frontend" }) },
    ];

    const res = await request(app)
      .get("/admin/users/mentees")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "e1", name: "Charlie", interest: "Backend" },
      { id: "e2", name: "Dana", interest: "Frontend" },
    ]);
  });
});

/* ================================================================== */
/*  GET /admin/requests                                               */
/* ================================================================== */
describe("GET /admin/requests", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/admin/requests");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns 403 when user is not admin", async () => {
    mockUserDoc = { exists: true, data: () => ({ isAdmin: false }) };

    const res = await request(app)
      .get("/admin/requests")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "FORBIDDEN" } });
  });

  it("returns list of all requests", async () => {
    mockRequestDocs = [
      { id: "r1", data: () => ({ status: "pending", mentorId: "m1" }) },
      { id: "r2", data: () => ({ status: "approved", mentorId: "m2" }) },
    ];

    const res = await request(app)
      .get("/admin/requests")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "r1", status: "pending", mentorId: "m1" },
      { id: "r2", status: "approved", mentorId: "m2" },
    ]);
  });
});
