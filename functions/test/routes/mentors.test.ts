import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mutable mock state -- set these in each test before the request   */
/* ------------------------------------------------------------------ */
let mockUserDoc: { exists: boolean; data: () => Record<string, unknown> };
let mockMentorDocs: Record<
  string,
  { exists: boolean; data: () => Record<string, unknown> }
>;
let mockMentorListDocs: Array<{ id: string; data: () => Record<string, unknown> }>;
let mockMentorSet: ReturnType<typeof vi.fn>;
let mockWhereArgs: Array<unknown[]>;
const mockTimestamp = { seconds: 1000, nanoseconds: 0 };

/* ------------------------------------------------------------------ */
/*  firebase-admin mock (hoisted by vitest)                           */
/* ------------------------------------------------------------------ */
vi.mock("firebase-admin", () => {
  const collectionStub = (name: string) => {
    if (name === "mentorProfiles") {
      // Chainable query for collection-level .where().where().get()
      const buildChain = () => {
        const chain: Record<string, unknown> = {};
        chain.where = (...args: unknown[]) => {
          mockWhereArgs.push(args);
          return chain;
        };
        chain.get = () =>
          Promise.resolve({ docs: mockMentorListDocs });
        return chain;
      };

      const root = buildChain();

      // doc-level access for .doc(id).get() and .doc(id).set()
      root.doc = (docId: string) => ({
        get: () => {
          const mock = mockMentorDocs[docId];
          if (mock) return Promise.resolve({ id: docId, ...mock });
          return Promise.resolve({
            id: docId,
            exists: false,
            data: () => undefined,
          });
        },
        set: (...args: unknown[]) => {
          mockMentorSet(...args);
          return Promise.resolve();
        },
      });

      return root;
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

  const firestoreFn = Object.assign(
    () => ({ collection: collectionStub }),
    {
      Timestamp: { now: () => mockTimestamp },
      FieldValue: { delete: vi.fn(() => "__DELETE__") },
    },
  );

  return {
    default: {
      initializeApp: vi.fn(),
      credential: { cert: vi.fn() },
      firestore: firestoreFn,
      auth: () => ({
        verifyIdToken: (token: string) => {
          if (token === "valid-token")
            return Promise.resolve({ uid: "mentor-uid" });
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
          return Promise.resolve({ uid: "mentor-uid" });
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
    data: () => ({ isAdmin: false, role: "mentor" }),
  };
  mockMentorDocs = {};
  mockMentorListDocs = [];
  mockMentorSet = vi.fn();
  mockWhereArgs = [];
});

/* ================================================================== */
/*  GET /mentors                                                      */
/* ================================================================== */
describe("GET /mentors", () => {
  it("returns all mentor profiles", async () => {
    mockMentorListDocs = [
      {
        id: "m1",
        data: () => ({
          userId: "m1",
          fullName: "Alice",
          expertise: ["React"],
          availability: "available",
        }),
      },
      {
        id: "m2",
        data: () => ({
          userId: "m2",
          fullName: "Bob",
          expertise: ["Node.js"],
          availability: "unavailable",
        }),
      },
    ];

    const res = await request(app).get("/mentors");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "m1", userId: "m1", fullName: "Alice", expertise: ["React"], availability: "available" },
      { id: "m2", userId: "m2", fullName: "Bob", expertise: ["Node.js"], availability: "unavailable" },
    ]);
  });

  it("returns empty array when no mentors exist", async () => {
    mockMentorListDocs = [];

    const res = await request(app).get("/mentors");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("filters by availability query param", async () => {
    mockMentorListDocs = [
      {
        id: "m1",
        data: () => ({
          userId: "m1",
          fullName: "Alice",
          availability: "available",
        }),
      },
    ];

    const res = await request(app).get("/mentors?availability=available");

    expect(res.status).toBe(200);
    expect(mockWhereArgs).toContainEqual([
      "availability",
      "==",
      "available",
    ]);
  });

  it("filters by topic query param", async () => {
    mockMentorListDocs = [
      {
        id: "m1",
        data: () => ({
          userId: "m1",
          fullName: "Alice",
          expertise: ["React"],
        }),
      },
    ];

    const res = await request(app).get("/mentors?topic=React");

    expect(res.status).toBe(200);
    expect(mockWhereArgs).toContainEqual([
      "expertise",
      "array-contains",
      "React",
    ]);
  });
});

/* ================================================================== */
/*  GET /mentors/:id                                                  */
/* ================================================================== */
describe("GET /mentors/:id", () => {
  it("returns a mentor profile by id", async () => {
    mockMentorDocs["some-id"] = {
      exists: true,
      data: () => ({
        userId: "some-id",
        fullName: "Alice",
        expertise: ["React"],
        availability: "available",
      }),
    };

    const res = await request(app).get("/mentors/some-id");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "some-id",
      userId: "some-id",
      fullName: "Alice",
      expertise: ["React"],
    });
  });

  it("returns 404 when mentor not found", async () => {
    const res = await request(app).get("/mentors/nonexistent-id");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND" } });
  });
});

/* ================================================================== */
/*  PUT /mentors/me                                                   */
/* ================================================================== */
describe("PUT /mentors/me", () => {
  it("returns 401 without auth token", async () => {
    const res = await request(app)
      .put("/mentors/me")
      .send({ expertise: ["React"] });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "UNAUTHORIZED" } });
  });

  it("returns 403 when user role is not mentor", async () => {
    mockUserDoc = {
      exists: true,
      data: () => ({ isAdmin: false, role: "mentee" }),
    };

    const res = await request(app)
      .put("/mentors/me")
      .set("Authorization", "Bearer valid-token")
      .send({ expertise: ["React"] });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: { code: "FORBIDDEN" } });
  });

  it("returns 400 when expertise is missing", async () => {
    mockUserDoc = {
      exists: true,
      data: () => ({
        isAdmin: false,
        role: "mentor",
        fullName: "Test Mentor",
        email: "mentor@test.com",
      }),
    };

    const res = await request(app)
      .put("/mentors/me")
      .set("Authorization", "Bearer valid-token")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("returns 400 when expertise is an empty array", async () => {
    mockUserDoc = {
      exists: true,
      data: () => ({
        isAdmin: false,
        role: "mentor",
        fullName: "Test Mentor",
        email: "mentor@test.com",
      }),
    };

    const res = await request(app)
      .put("/mentors/me")
      .set("Authorization", "Bearer valid-token")
      .send({ expertise: [] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: "MISSING_FIELDS" } });
  });

  it("creates/updates profile successfully with 200", async () => {
    mockUserDoc = {
      exists: true,
      data: () => ({
        isAdmin: false,
        role: "mentor",
        fullName: "Test Mentor",
        email: "mentor@test.com",
      }),
    };

    const res = await request(app)
      .put("/mentors/me")
      .set("Authorization", "Bearer valid-token")
      .send({
        currentRole: "Senior Developer",
        company: "Acme Corp",
        expertise: ["React", "TypeScript"],
        yearsExperience: 5,
        availability: "available",
        linkedIn: "https://linkedin.com/in/test",
        calendlyUrl: "https://calendly.com/test",
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: "mentor-uid",
      userId: "mentor-uid",
      fullName: "Test Mentor",
      email: "mentor@test.com",
      currentRole: "Senior Developer",
      company: "Acme Corp",
      expertise: ["React", "TypeScript"],
      yearsExperience: 5,
      availability: "available",
      linkedIn: "https://linkedin.com/in/test",
      calendlyUrl: "https://calendly.com/test",
    });
    expect(mockMentorSet).toHaveBeenCalledOnce();
  });
});
