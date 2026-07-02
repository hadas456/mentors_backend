import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mutable mock state – set these in each test before the request    */
/* ------------------------------------------------------------------ */
let mockNotifDocs: Array<{
  id: string;
  data: () => Record<string, unknown>;
}> = [];
let mockNotifDocSnapshot: {
  exists: boolean;
  data: () => Record<string, unknown>;
} = { exists: true, data: () => ({ read: false, message: "hello" }) };
let mockUnreadDocs: Array<{
  id: string;
  data: () => Record<string, unknown>;
  ref: { id: string; update: ReturnType<typeof vi.fn> };
}> = [];
let mockUserDoc = { exists: true, data: () => ({ isAdmin: false }) };
let mockUpdateFn = vi.fn().mockResolvedValue(undefined);
let mockBatchUpdate = vi.fn();
let mockBatchCommit = vi.fn().mockResolvedValue(undefined);

/* ------------------------------------------------------------------ */
/*  firebase-admin mock (hoisted by vitest)                           */
/* ------------------------------------------------------------------ */
vi.mock("firebase-admin", () => {
  const collectionStub = (name: string) => {
    if (name === "notifications") {
      return {
        doc: (_uid: string) => ({
          collection: (subName: string) => {
            if (subName === "items") {
              return {
                orderBy: () => ({
                  limit: () => ({
                    get: () =>
                      Promise.resolve({ docs: mockNotifDocs }),
                  }),
                }),
                doc: (notifId: string) => ({
                  get: () => Promise.resolve(mockNotifDocSnapshot),
                  update: (...args: unknown[]) => mockUpdateFn(...args),
                }),
                where: () => ({
                  get: () =>
                    Promise.resolve({
                      empty: mockUnreadDocs.length === 0,
                      size: mockUnreadDocs.length,
                      docs: mockUnreadDocs,
                    }),
                }),
              };
            }
            return {};
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
    return {};
  };

  const firestoreFn = () => ({
    collection: collectionStub,
    batch: () => ({
      update: (...args: unknown[]) => mockBatchUpdate(...args),
      commit: () => mockBatchCommit(),
    }),
  });

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
  mockNotifDocs = [];
  mockNotifDocSnapshot = {
    exists: true,
    data: () => ({ read: false, message: "hello" }),
  };
  mockUnreadDocs = [];
  mockUserDoc = { exists: true, data: () => ({ isAdmin: false }) };
  mockUpdateFn = vi.fn().mockResolvedValue(undefined);
  mockBatchUpdate = vi.fn();
  mockBatchCommit = vi.fn().mockResolvedValue(undefined);
});

/* ================================================================== */
/*  GET /notifications                                                */
/* ================================================================== */
describe("GET /notifications", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/notifications");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns notification items for authenticated user", async () => {
    mockNotifDocs = [
      {
        id: "n1",
        data: () => ({ message: "Welcome", read: false, createdAt: 1000 }),
      },
      {
        id: "n2",
        data: () => ({ message: "New request", read: true, createdAt: 900 }),
      },
    ];

    const res = await request(app)
      .get("/notifications")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "n1", message: "Welcome", read: false, createdAt: 1000 },
      { id: "n2", message: "New request", read: true, createdAt: 900 },
    ]);
  });
});

/* ================================================================== */
/*  PATCH /notifications/:id/read                                     */
/* ================================================================== */
describe("PATCH /notifications/:id/read", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).patch("/notifications/n1/read");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns 404 when notification does not exist", async () => {
    mockNotifDocSnapshot = {
      exists: false,
      data: () => ({}),
    };

    const res = await request(app)
      .patch("/notifications/missing-id/read")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND" } });
  });

  it("returns ok:true on success", async () => {
    mockNotifDocSnapshot = {
      exists: true,
      data: () => ({ read: false, message: "hello" }),
    };

    const res = await request(app)
      .patch("/notifications/n1/read")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockUpdateFn).toHaveBeenCalledWith({ read: true });
  });
});

/* ================================================================== */
/*  POST /notifications/read-all                                      */
/* ================================================================== */
describe("POST /notifications/read-all", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).post("/notifications/read-all");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns ok:true with updated count 0 when no unread notifications", async () => {
    mockUnreadDocs = [];

    const res = await request(app)
      .post("/notifications/read-all")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, updated: 0 });
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it("batch-updates unread notifications", async () => {
    const ref1 = { id: "n1", update: vi.fn() };
    const ref2 = { id: "n2", update: vi.fn() };
    mockUnreadDocs = [
      { id: "n1", data: () => ({ read: false }), ref: ref1 },
      { id: "n2", data: () => ({ read: false }), ref: ref2 },
    ];

    const res = await request(app)
      .post("/notifications/read-all")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, updated: 2 });
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});
