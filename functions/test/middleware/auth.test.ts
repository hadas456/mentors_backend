import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("firebase-admin", () => {
  const verifyIdToken = vi.fn();
  const get = vi.fn();

  return {
    default: {
      auth: () => ({ verifyIdToken }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get }),
        }),
      }),
    },
    auth: () => ({ verifyIdToken }),
    firestore: () => ({
      collection: () => ({
        doc: () => ({ get }),
      }),
    }),
  };
});

import * as admin from "firebase-admin";
import { requireAuth, requireAdmin, AuthedRequest } from "../../src/middleware/auth";
import { Response, NextFunction } from "express";

function createMockRes() {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  return res as Response;
}

function createMockReq(headers: Record<string, string> = {}): AuthedRequest {
  return { headers } as AuthedRequest;
}

describe("requireAuth", () => {
  let verifyIdToken: ReturnType<typeof vi.fn>;
  let getDoc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    verifyIdToken = (admin.auth() as any).verifyIdToken;
    getDoc = (admin.firestore() as any).collection("users").doc("x").get;
  });

  it("returns 401 UNAUTHORIZED when no Authorization header", async () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "UNAUTHORIZED" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 UNAUTHORIZED when header format is wrong", async () => {
    const req = createMockReq({ authorization: "Basic xxx" });
    const res = createMockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "UNAUTHORIZED" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 INVALID_TOKEN when verifyIdToken throws", async () => {
    verifyIdToken.mockRejectedValueOnce(new Error("invalid token"));

    const req = createMockReq({ authorization: "Bearer bad-token" });
    const res = createMockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "INVALID_TOKEN" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("sets req.uid and calls next() on valid token", async () => {
    verifyIdToken.mockResolvedValueOnce({ uid: "test-uid" });
    getDoc.mockResolvedValueOnce({ exists: false, data: () => undefined });

    const req = createMockReq({ authorization: "Bearer valid-token" });
    const res = createMockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(req.uid).toBe("test-uid");
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("sets req.isAdmin = true when user doc has isAdmin: true", async () => {
    verifyIdToken.mockResolvedValueOnce({ uid: "test-uid" });
    getDoc.mockResolvedValueOnce({ exists: true, data: () => ({ isAdmin: true }) });

    const req = createMockReq({ authorization: "Bearer valid-token" });
    const res = createMockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(req.isAdmin).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it("sets req.isAdmin = false when user doc has isAdmin: false", async () => {
    verifyIdToken.mockResolvedValueOnce({ uid: "test-uid" });
    getDoc.mockResolvedValueOnce({ exists: true, data: () => ({ isAdmin: false }) });

    const req = createMockReq({ authorization: "Bearer valid-token" });
    const res = createMockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(req.isAdmin).toBe(false);
    expect(next).toHaveBeenCalled();
  });

  it("sets req.isAdmin = false when user doc doesn't exist", async () => {
    verifyIdToken.mockResolvedValueOnce({ uid: "test-uid" });
    getDoc.mockResolvedValueOnce({ exists: false, data: () => undefined });

    const req = createMockReq({ authorization: "Bearer valid-token" });
    const res = createMockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(req.isAdmin).toBe(false);
    expect(next).toHaveBeenCalled();
  });
});

describe("requireAdmin", () => {
  it("returns 403 FORBIDDEN when req.isAdmin is false", () => {
    const req = createMockReq() as AuthedRequest;
    req.isAdmin = false;
    const res = createMockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "FORBIDDEN" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 FORBIDDEN when req.isAdmin is undefined", () => {
    const req = createMockReq() as AuthedRequest;
    const res = createMockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "FORBIDDEN" } });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when req.isAdmin is true", () => {
    const req = createMockReq() as AuthedRequest;
    req.isAdmin = true;
    const res = createMockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
