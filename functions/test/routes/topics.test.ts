import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mutable mock state – set these in each test before the request    */
/* ------------------------------------------------------------------ */
let mockTopicsDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
let mockUserDoc = { exists: true, data: () => ({ isAdmin: true }) };
let mockGetThrows = false;
let mockAddResult = { id: "new-id" };

/* ------------------------------------------------------------------ */
/*  firebase-admin mock (hoisted by vitest)                           */
/* ------------------------------------------------------------------ */
vi.mock("firebase-admin", () => {
  const collectionStub = (name: string) => {
    if (name === "topics") {
      return {
        orderBy: () => ({
          get: () => {
            if (mockGetThrows) throw new Error("Firestore error");
            return Promise.resolve({ docs: mockTopicsDocs });
          },
        }),
        add: (data: Record<string, unknown>) =>
          Promise.resolve({ ...mockAddResult, ...data }),
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

  return {
    default: {
      initializeApp: vi.fn(),
      credential: { cert: vi.fn() },
      firestore: () => ({ collection: collectionStub }),
      auth: () => ({
        verifyIdToken: (token: string) => {
          if (token === "valid-token") {
            return Promise.resolve({ uid: "admin-uid" });
          }
          return Promise.reject(new Error("Invalid token"));
        },
      }),
    },
    initializeApp: vi.fn(),
    credential: { cert: vi.fn() },
    firestore: () => ({ collection: collectionStub }),
    auth: () => ({
      verifyIdToken: (token: string) => {
        if (token === "valid-token") {
          return Promise.resolve({ uid: "admin-uid" });
        }
        return Promise.reject(new Error("Invalid token"));
      },
    }),
  };
});

/* ------------------------------------------------------------------ */
/*  Other module mocks (prevent import side-effects)                  */
/* ------------------------------------------------------------------ */
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
  createTransport: vi.fn(() => ({ sendMail: vi.fn() })),
}));

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

/* ------------------------------------------------------------------ */
/*  Imports AFTER mocks                                               */
/* ------------------------------------------------------------------ */
import request from "supertest";
import app from "../../src/app";

/* ------------------------------------------------------------------ */
/*  Reset mutable state before each test                              */
/* ------------------------------------------------------------------ */
beforeEach(() => {
  mockTopicsDocs = [];
  mockUserDoc = { exists: true, data: () => ({ isAdmin: true }) };
  mockGetThrows = false;
  mockAddResult = { id: "new-id" };
});

/* ================================================================== */
/*  GET /topics                                                       */
/* ================================================================== */
describe("GET /topics", () => {
  it("returns an empty array when no topics exist", async () => {
    mockTopicsDocs = [];

    const res = await request(app).get("/topics");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns all topics with id and name", async () => {
    mockTopicsDocs = [
      { id: "t1", data: () => ({ name: "React" }) },
      { id: "t2", data: () => ({ name: "TypeScript" }) },
    ];

    const res = await request(app).get("/topics");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "t1", name: "React" },
      { id: "t2", name: "TypeScript" },
    ]);
  });

  it("returns 500 on Firestore error", async () => {
    mockGetThrows = true;

    const res = await request(app).get("/topics");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL_ERROR" } });
  });
});

/* ================================================================== */
/*  POST /topics                                                      */
/* ================================================================== */
describe("POST /topics", () => {
  it("returns 401 without auth token", async () => {
    const res = await request(app).post("/topics").send({ name: "React" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns 403 when user is not admin", async () => {
    mockUserDoc = { exists: true, data: () => ({ isAdmin: false }) };

    const res = await request(app)
      .post("/topics")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "React" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "FORBIDDEN" } });
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(app)
      .post("/topics")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 when name is not a string", async () => {
    const res = await request(app)
      .post("/topics")
      .set("Authorization", "Bearer valid-token")
      .send({ name: 42 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 201 with created topic on success", async () => {
    mockAddResult = { id: "new-id" };

    const res = await request(app)
      .post("/topics")
      .set("Authorization", "Bearer valid-token")
      .send({ name: "React" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: "new-id", name: "React" });
  });
});
