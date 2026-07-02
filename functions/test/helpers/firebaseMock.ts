import { vi } from "vitest";

// ── Firestore document snapshot ──────────────────────────────────────────────

export function makeDocSnap(
  id: string,
  data: Record<string, unknown> | undefined
) {
  const exists = data !== undefined;
  return {
    id,
    exists,
    data: () => (exists ? data : undefined),
    ref: { id, update: vi.fn().mockResolvedValue(undefined) },
  };
}

// ── Firestore query snapshot ─────────────────────────────────────────────────

export function makeQuerySnap(
  docs: Array<{ id: string; data: Record<string, unknown> }>
) {
  const snaps = docs.map((d) => makeDocSnap(d.id, d.data));
  return {
    docs: snaps,
    empty: snaps.length === 0,
    size: snaps.length,
  };
}

// ── Chainable query / collection ref ─────────────────────────────────────────

export function makeChain(resolvedSnap: unknown) {
  const self: Record<string, unknown> = {};
  for (const method of ["where", "orderBy", "limit"]) {
    self[method] = vi.fn().mockReturnValue(self);
  }
  self.get = vi.fn().mockResolvedValue(resolvedSnap);
  self.count = vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ data: () => resolvedSnap }) });
  return self;
}

// ── Collection / doc routing ─────────────────────────────────────────────────

export type DocResolver = (
  collection: string,
  docId: string
) => ReturnType<typeof makeDocSnap>;

export type CollectionResolver = (
  collection: string
) => ReturnType<typeof makeQuerySnap>;

export type AddResolver = (
  collection: string,
  data: unknown
) => { id: string };

interface SubcollectionHandler {
  snap: ReturnType<typeof makeQuerySnap>;
}

/**
 * Build a mock `admin.firestore()` that delegates to the provided resolvers.
 *
 * - `docResolver(collection, docId)` → returns a doc snapshot for `.doc(id).get()`
 * - `collectionResolver(collection)` → returns a query snapshot for collection-level `.get()`
 * - `addResolver(collection, data)` → returns `{ id }` for `.add(data)`
 * - `subcollections` → nested subcollection data keyed as "parent/docId/child"
 */
export function buildFirestore(opts: {
  docResolver?: DocResolver;
  collectionResolver?: CollectionResolver;
  addResolver?: AddResolver;
  subcollections?: Record<string, SubcollectionHandler>;
  batchUpdates?: Array<{ ref: unknown; data: unknown }>;
}) {
  const {
    docResolver = () => makeDocSnap("x", undefined),
    collectionResolver = () => makeQuerySnap([]),
    addResolver = () => ({ id: "new-id" }),
    subcollections = {},
  } = opts;

  const batchOps: Array<{ ref: unknown; data: unknown }> = [];

  const firestore: Record<string, unknown> = {
    collection: vi.fn((name: string) => {
      const colRef: Record<string, unknown> = {};

      colRef.doc = vi.fn((docId: string) => {
        const snap = docResolver(name, docId);
        const docRef: Record<string, unknown> = {
          id: docId,
          get: vi.fn().mockResolvedValue(snap),
          set: vi.fn().mockResolvedValue(undefined),
          update: vi.fn().mockResolvedValue(undefined),
          collection: vi.fn((subName: string) => {
            const key = `${name}/${docId}/${subName}`;
            const subSnap = subcollections[key]?.snap ?? makeQuerySnap([]);
            return makeChain(subSnap);
          }),
        };
        return docRef;
      });

      const qSnap = collectionResolver(name);
      const chain = makeChain(qSnap);
      colRef.where = chain.where;
      colRef.orderBy = chain.orderBy;
      colRef.limit = chain.limit;
      colRef.get = chain.get;
      colRef.count = chain.count;

      colRef.add = vi.fn((data: unknown) => {
        const result = addResolver(name, data);
        return Promise.resolve(result);
      });

      return colRef;
    }),
    batch: vi.fn(() => ({
      update: vi.fn((ref: unknown, data: unknown) => batchOps.push({ ref, data })),
      commit: vi.fn().mockResolvedValue(undefined),
    })),
  };

  return firestore;
}

// ── Firebase Admin mock builder ──────────────────────────────────────────────

export function buildAdminMock(firestoreInstance: ReturnType<typeof buildFirestore>) {
  const authMock = {
    verifyIdToken: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
  };

  const mock = {
    apps: [{}],
    initializeApp: vi.fn(),
    auth: vi.fn(() => authMock),
    firestore: Object.assign(vi.fn(() => firestoreInstance), {
      Timestamp: {
        now: vi.fn(() => ({ toDate: () => new Date(), seconds: 1000, nanoseconds: 0 })),
        fromDate: vi.fn((d: Date) => ({ toDate: () => d, seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 })),
      },
      FieldValue: {
        delete: vi.fn(() => "__DELETE__"),
      },
    }),
    credential: {
      cert: vi.fn(),
    },
  };

  return { mock, authMock };
}
