import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mutable mock state -- set these in each test before the request   */
/* ------------------------------------------------------------------ */
let mockUserDocs: Record<string, { exists: boolean; data: () => Record<string, unknown> }> = {};
let mockMentorProfileDoc: { exists: boolean; data: () => Record<string, unknown> } = {
  exists: true,
  data: () => ({ fullName: "Mentor Name", email: "mentor@test.com", availability: "available" }),
};
let mockRequestDoc: { exists: boolean; id: string; data: () => Record<string, unknown> } = {
  exists: false,
  id: "req-1",
  data: () => ({}),
};
let mockMenteeRequestDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
let mockMentorRequestDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
let mockDuplicateCheck: { empty: boolean } = { empty: true };
let mockTimelineDocs: Array<{ id: string; data: () => Record<string, unknown> }> = [];
let mockAddResult: { id: string } = { id: "new-req-id" };
let mockUpdateFn = vi.fn();

const mockTimestamp = { seconds: 1234567890, nanoseconds: 0 };

/* ------------------------------------------------------------------ */
/*  firebase-admin mock (hoisted by vitest)                           */
/* ------------------------------------------------------------------ */
vi.mock("firebase-admin", () => {
  const collectionStub = (name: string) => {
    if (name === "users") {
      return {
        doc: (uid: string) => ({
          get: () =>
            Promise.resolve(
              mockUserDocs[uid] || { exists: false, data: () => ({}) }
            ),
        }),
      };
    }
    if (name === "mentorProfiles") {
      return {
        doc: () => ({
          get: () => Promise.resolve(mockMentorProfileDoc),
        }),
      };
    }
    if (name === "mentorshipRequests") {
      return {
        doc: (_id: string) => ({
          get: () => Promise.resolve(mockRequestDoc),
          update: (...args: unknown[]) => mockUpdateFn(...args),
          collection: (subName: string) => {
            if (subName === "timeline") {
              return {
                orderBy: () => ({
                  get: () => Promise.resolve({ docs: mockTimelineDocs }),
                }),
              };
            }
            return {};
          },
        }),
        add: (_data: Record<string, unknown>) => Promise.resolve(mockAddResult),
        where: (field: string, _op: string, _val: unknown) => {
          if (field === "menteeId") {
            return {
              get: () => Promise.resolve({ docs: mockMenteeRequestDocs }),
              where: () => ({
                where: () => ({
                  limit: () => ({
                    get: () => Promise.resolve(mockDuplicateCheck),
                  }),
                }),
              }),
            };
          }
          if (field === "mentorId") {
            return {
              get: () => Promise.resolve({ docs: mockMentorRequestDocs }),
            };
          }
          return { get: () => Promise.resolve({ docs: [] }) };
        },
      };
    }
    return {};
  };

  const firestoreFn = Object.assign(
    () => ({ collection: collectionStub }),
    { Timestamp: { now: () => mockTimestamp } }
  );

  const authFn = () => ({
    verifyIdToken: (token: string) => {
      if (token === "mentee-token") return Promise.resolve({ uid: "mentee-uid" });
      if (token === "mentor-token") return Promise.resolve({ uid: "mentor-uid" });
      return Promise.reject(new Error("Invalid token"));
    },
  });

  return {
    default: {
      initializeApp: vi.fn(),
      credential: { cert: vi.fn() },
      firestore: firestoreFn,
      auth: authFn,
    },
    initializeApp: vi.fn(),
    credential: { cert: vi.fn() },
    firestore: firestoreFn,
    auth: authFn,
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
  mockUserDocs = {
    "mentee-uid": {
      exists: true,
      data: () => ({
        role: "mentee",
        fullName: "Mentee Name",
        email: "mentee@test.com",
        isAdmin: false,
      }),
    },
    "mentor-uid": {
      exists: true,
      data: () => ({
        role: "mentor",
        fullName: "Mentor User",
        email: "mentor-user@test.com",
        isAdmin: false,
      }),
    },
  };
  mockMentorProfileDoc = {
    exists: true,
    data: () => ({
      fullName: "Mentor Name",
      email: "mentor@test.com",
      availability: "available",
    }),
  };
  mockRequestDoc = {
    exists: false,
    id: "req-1",
    data: () => ({}),
  };
  mockMenteeRequestDocs = [];
  mockMentorRequestDocs = [];
  mockDuplicateCheck = { empty: true };
  mockTimelineDocs = [];
  mockAddResult = { id: "new-req-id" };
  mockUpdateFn = vi.fn();
});

/* ================================================================== */
/*  POST /requests                                                    */
/* ================================================================== */
describe("POST /requests", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app)
      .post("/requests")
      .send({ mentorId: "mentor-uid", topic: "React" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns 403 when user is not a mentee", async () => {
    mockUserDocs["mentee-uid"] = {
      exists: true,
      data: () => ({
        role: "mentor",
        fullName: "Not Mentee",
        email: "x@test.com",
        isAdmin: false,
      }),
    };

    const res = await request(app)
      .post("/requests")
      .set("Authorization", "Bearer mentee-token")
      .send({ mentorId: "mentor-uid", topic: "React" });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "FORBIDDEN" } });
  });

  it("returns 400 MISSING_FIELDS when mentorId or topic missing", async () => {
    const res = await request(app)
      .post("/requests")
      .set("Authorization", "Bearer mentee-token")
      .send({ mentorId: "mentor-uid" }); // topic missing

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 FIELD_TOO_LONG when topic exceeds 200 chars", async () => {
    const res = await request(app)
      .post("/requests")
      .set("Authorization", "Bearer mentee-token")
      .send({ mentorId: "mentor-uid", topic: "x".repeat(201) });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "FIELD_TOO_LONG" } });
  });

  it("returns 404 when mentor profile doesn't exist", async () => {
    mockMentorProfileDoc = { exists: false, data: () => ({}) };

    const res = await request(app)
      .post("/requests")
      .set("Authorization", "Bearer mentee-token")
      .send({ mentorId: "mentor-uid", topic: "React" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND" } });
  });

  it("returns 400 MENTOR_UNAVAILABLE when mentor is unavailable", async () => {
    mockMentorProfileDoc = {
      exists: true,
      data: () => ({
        fullName: "Mentor Name",
        email: "mentor@test.com",
        availability: "unavailable",
      }),
    };

    const res = await request(app)
      .post("/requests")
      .set("Authorization", "Bearer mentee-token")
      .send({ mentorId: "mentor-uid", topic: "React" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MENTOR_UNAVAILABLE" } });
  });

  it("returns 409 DUPLICATE_REQUEST when active request already exists", async () => {
    mockDuplicateCheck = { empty: false };

    const res = await request(app)
      .post("/requests")
      .set("Authorization", "Bearer mentee-token")
      .send({ mentorId: "mentor-uid", topic: "React" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: "DUPLICATE_REQUEST" } });
  });

  it("returns 201 with request data on success", async () => {
    const res = await request(app)
      .post("/requests")
      .set("Authorization", "Bearer mentee-token")
      .send({ mentorId: "mentor-uid", topic: "React", description: "Help me" });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe("new-req-id");
    expect(res.body.menteeId).toBe("mentee-uid");
    expect(res.body.mentorId).toBe("mentor-uid");
    expect(res.body.topic).toBe("React");
    expect(res.body.description).toBe("Help me");
    expect(res.body.status).toBe("pending");
  });
});

/* ================================================================== */
/*  GET /requests                                                     */
/* ================================================================== */
describe("GET /requests", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/requests");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns requests where user is mentee or mentor", async () => {
    mockMenteeRequestDocs = [
      {
        id: "r1",
        data: () => ({ topic: "React", status: "pending", menteeId: "mentee-uid", mentorId: "m1" }),
      },
    ];
    mockMentorRequestDocs = [
      {
        id: "r2",
        data: () => ({ topic: "Node", status: "approved", menteeId: "other", mentorId: "mentee-uid" }),
      },
    ];

    const res = await request(app)
      .get("/requests")
      .set("Authorization", "Bearer mentee-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe("r1");
    expect(res.body[1].id).toBe("r2");
  });

  it("filters by status query param", async () => {
    mockMenteeRequestDocs = [
      { id: "r1", data: () => ({ topic: "React", status: "pending" }) },
      { id: "r2", data: () => ({ topic: "Node", status: "approved" }) },
    ];
    mockMentorRequestDocs = [];

    const res = await request(app)
      .get("/requests?status=pending")
      .set("Authorization", "Bearer mentee-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("r1");
    expect(res.body[0].status).toBe("pending");
  });
});

/* ================================================================== */
/*  GET /requests/:id/timeline                                        */
/* ================================================================== */
describe("GET /requests/:id/timeline", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app).get("/requests/req-1/timeline");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns 404 when request doesn't exist", async () => {
    mockRequestDoc = { exists: false, id: "req-1", data: () => ({}) };

    const res = await request(app)
      .get("/requests/req-1/timeline")
      .set("Authorization", "Bearer mentee-token");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND" } });
  });

  it("returns 403 when user is not mentee or mentor on the request", async () => {
    mockRequestDoc = {
      exists: true,
      id: "req-1",
      data: () => ({ menteeId: "other-uid", mentorId: "another-uid" }),
    };

    const res = await request(app)
      .get("/requests/req-1/timeline")
      .set("Authorization", "Bearer mentee-token");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "FORBIDDEN" } });
  });

  it("returns timeline events on success", async () => {
    mockRequestDoc = {
      exists: true,
      id: "req-1",
      data: () => ({ menteeId: "mentee-uid", mentorId: "mentor-uid" }),
    };
    mockTimelineDocs = [
      { id: "ev1", data: () => ({ type: "created", content: "Request created" }) },
      { id: "ev2", data: () => ({ type: "status_changed", content: "Approved" }) },
    ];

    const res = await request(app)
      .get("/requests/req-1/timeline")
      .set("Authorization", "Bearer mentee-token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe("ev1");
    expect(res.body[1].id).toBe("ev2");
  });
});

/* ================================================================== */
/*  PATCH /requests/:id                                               */
/* ================================================================== */
describe("PATCH /requests/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await request(app)
      .patch("/requests/req-1")
      .send({ status: "approved" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns 404 when request doesn't exist", async () => {
    mockRequestDoc = { exists: false, id: "req-1", data: () => ({}) };

    const res = await request(app)
      .patch("/requests/req-1")
      .set("Authorization", "Bearer mentor-token")
      .send({ status: "approved" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND" } });
  });

  it("allows mentor to approve a pending request", async () => {
    mockRequestDoc = {
      exists: true,
      id: "req-1",
      data: () => ({
        menteeId: "mentee-uid",
        mentorId: "mentor-uid",
        menteeName: "Mentee Name",
        mentorName: "Mentor Name",
        topic: "React",
        status: "pending",
      }),
    };

    const res = await request(app)
      .patch("/requests/req-1")
      .set("Authorization", "Bearer mentor-token")
      .send({ status: "approved", mentorResponse: "Let's do it" });

    expect(res.status).toBe(200);
    expect(mockUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "approved",
        mentorResponse: "Let's do it",
        menteeReply: null,
      })
    );
  });

  it("allows mentor to reject a pending request", async () => {
    mockRequestDoc = {
      exists: true,
      id: "req-1",
      data: () => ({
        menteeId: "mentee-uid",
        mentorId: "mentor-uid",
        menteeName: "Mentee Name",
        mentorName: "Mentor Name",
        topic: "React",
        status: "pending",
      }),
    };

    const res = await request(app)
      .patch("/requests/req-1")
      .set("Authorization", "Bearer mentor-token")
      .send({ status: "rejected", mentorResponse: "Not a good fit" });

    expect(res.status).toBe(200);
    expect(mockUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "rejected",
        mentorResponse: "Not a good fit",
      })
    );
  });

  it("allows mentee to cancel a pending request", async () => {
    mockRequestDoc = {
      exists: true,
      id: "req-1",
      data: () => ({
        menteeId: "mentee-uid",
        mentorId: "mentor-uid",
        menteeName: "Mentee Name",
        mentorName: "Mentor Name",
        topic: "React",
        status: "pending",
      }),
    };

    const res = await request(app)
      .patch("/requests/req-1")
      .set("Authorization", "Bearer mentee-token")
      .send({ status: "canceled" });

    expect(res.status).toBe(200);
    expect(mockUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: "canceled" })
    );
  });

  it("allows mentee to complete an approved request", async () => {
    mockRequestDoc = {
      exists: true,
      id: "req-1",
      data: () => ({
        menteeId: "mentee-uid",
        mentorId: "mentor-uid",
        menteeName: "Mentee Name",
        mentorName: "Mentor Name",
        topic: "React",
        status: "approved",
      }),
    };

    const res = await request(app)
      .patch("/requests/req-1")
      .set("Authorization", "Bearer mentee-token")
      .send({ status: "completed" });

    expect(res.status).toBe(200);
    expect(mockUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed" })
    );
  });

  it("allows mentee to resubmit after needs_info", async () => {
    mockRequestDoc = {
      exists: true,
      id: "req-1",
      data: () => ({
        menteeId: "mentee-uid",
        mentorId: "mentor-uid",
        menteeName: "Mentee Name",
        mentorName: "Mentor Name",
        topic: "React",
        status: "needs_info",
      }),
    };

    const res = await request(app)
      .patch("/requests/req-1")
      .set("Authorization", "Bearer mentee-token")
      .send({ status: "pending", menteeReply: "Here is more info" });

    expect(res.status).toBe(200);
    expect(mockUpdateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending",
        menteeReply: "Here is more info",
      })
    );
  });

  it("returns 403 for invalid status transition", async () => {
    mockRequestDoc = {
      exists: true,
      id: "req-1",
      data: () => ({
        menteeId: "mentee-uid",
        mentorId: "mentor-uid",
        status: "rejected",
      }),
    };

    const res = await request(app)
      .patch("/requests/req-1")
      .set("Authorization", "Bearer mentee-token")
      .send({ status: "approved" }); // mentee cannot approve

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "FORBIDDEN" } });
  });
});
