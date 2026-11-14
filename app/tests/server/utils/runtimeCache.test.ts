import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  vi,
} from "bun:test";
import type { RuntimeCache } from "@vercel/functions";
import {
  createRuntimeCache,
  invalidateRuntimeCaches,
} from "@/server/utils/runtimeCache";
import { deferred } from "../../setup/deferred";

const start = new Date("2026-11-14T12:00:00Z");
const TTL_SECONDS = 60;

/** A Runtime Cache stand-in that serializes like the real one and counts operations. */
const memoryStore = () => {
  const entries = new Map<string, { value: string; tags: string[] }>();
  const store = {
    get: vi.fn(async (key: string) => {
      const entry = entries.get(key);
      return entry ? JSON.parse(entry.value) : null;
    }),
    set: vi.fn(async (key: string, value: unknown, options?: { tags?: string[] }) => {
      entries.set(key, { value: JSON.stringify(value), tags: options?.tags ?? [] });
    }),
    delete: vi.fn(async (key: string) => {
      entries.delete(key);
    }),
    expireTag: vi.fn(async (tag: string | string[]) => {
      const tags = [tag].flat();
      for (const [key, entry] of entries)
        if (entry.tags.some((t) => tags.includes(t))) entries.delete(key);
    }),
  } satisfies RuntimeCache;
  return { store, entries };
};

/** One server instance's cache over `store`, reading the next queued rows from the database. */
const instance = (
  store: RuntimeCache,
  database: { reads: number; rows: unknown[][] },
  name = "test-catalogue",
) =>
  createRuntimeCache({
    name,
    ttlSeconds: TTL_SECONDS,
    load: async (_client: object) => [...(database.rows[database.reads++] ?? [])],
    store,
  });

describe("createRuntimeCache", () => {
  beforeEach(() => setSystemTime(start));
  afterEach(() => {
    setSystemTime();
    vi.restoreAllMocks();
  });

  it("serves repeat reads from memory until the TTL and refreshes once it passes", async () => {
    const { store } = memoryStore();
    const database = { reads: 0, rows: [[1], [2]] };
    const cache = instance(store, database);
    expect(await cache.read({})).toEqual([1]);
    setSystemTime(new Date(start.getTime() + TTL_SECONDS * 1000 - 1));
    expect(await cache.read({})).toEqual([1]);
    expect(database.reads).toBe(1);
    setSystemTime(new Date(start.getTime() + TTL_SECONDS * 1000));
    expect(await cache.read({})).toEqual([2]);
    expect(database.reads).toBe(2);
  });

  it("lets a cold instance read the stored payload instead of the database", async () => {
    const { store } = memoryStore();
    const database = { reads: 0, rows: [[{ at: new Date("2026-01-01T00:00:00Z") }]] };
    await instance(store, database).read({});
    const cold = await instance(store, database).read({});
    expect(database.reads).toBe(1);
    // Rows keep their types through the cache's JSON encoding.
    expect(cold).toEqual([{ at: new Date("2026-01-01T00:00:00Z") }]);
  });

  it("makes a save on one instance visible to every instance's next read", async () => {
    const { store } = memoryStore();
    const database = { reads: 0, rows: [[1], [2]] };
    const editor = instance(store, database);
    const other = instance(store, database);
    expect(await other.read({})).toEqual([1]);
    await editor.invalidate();
    expect(await other.read({})).toEqual([2]);
    expect(await editor.read({})).toEqual([2]);
    expect(database.reads).toBe(2);
  });

  it.each([false, true])(
    "confirms concurrent invalidations without competing with other writers (separate instances: %s)",
    async (separateInstances) => {
      const { store } = memoryStore();
      const database = { reads: 0, rows: [[1], [2]] };
      const reader = instance(store, database);
      expect(await reader.read({})).toEqual([1]);
      const writers = Array.from({ length: 8 }, () =>
        separateInstances ? instance(store, database) : reader,
      );
      await Promise.all(writers.map((writer) => writer.invalidate()));
      expect(await reader.read({})).toEqual([2]);
      expect(database.reads).toBe(2);
    },
  );

  it("retries an unpersisted version write before confirming invalidation", async () => {
    const { store } = memoryStore();
    const database = { reads: 0, rows: [[1], [2]] };
    const editor = instance(store, database);
    const other = instance(store, database);
    expect(await other.read({})).toEqual([1]);
    store.set.mockClear().mockImplementationOnce(async () => undefined);
    await editor.invalidate();
    expect(store.set).toHaveBeenCalledTimes(2);
    expect(new Set(store.set.mock.calls.map(([, version]) => version)).size).toBe(2);
    expect(await other.read({})).toEqual([2]);
  });

  it.each(["resolved", "rejected", "unreadable-baseline"])(
    "rejects an unconfirmed invalidation after %s cache failures and bypasses its stale payload",
    async (failure) => {
      const { store } = memoryStore();
      const database = { reads: 0, rows: [[1], [2], [3]] };
      const cache = instance(store, database);
      expect(await cache.read({})).toEqual([1]);
      const set = store.set.getMockImplementation()!;
      store.set.mockClear();
      if (failure === "rejected")
        store.set.mockRejectedValue(new Error("cache unavailable"));
      else store.set.mockResolvedValue(undefined);
      if (failure === "unreadable-baseline")
        store.get.mockImplementationOnce(async () => null);
      store.expireTag.mockResolvedValue(undefined);
      await expect(cache.invalidate()).rejects.toThrow("Could not invalidate");
      expect(store.set).toHaveBeenCalledTimes(3);
      expect(await cache.read({})).toEqual([2]);
      store.set.mockImplementation(set);
      await cache.invalidate();
      expect(await cache.read({})).toEqual([3]);
    },
  );

  it("shares one read between concurrent misses and hands each caller its own copy", async () => {
    const { store } = memoryStore();
    const database = { reads: 0, rows: [[1, 2]] };
    const cache = instance(store, database);
    const [first, second] = await Promise.all([cache.read({}), cache.read({})]);
    expect(database.reads).toBe(1);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    first.splice(0);
    expect(await cache.read({})).toEqual([1, 2]);
  });

  it("does not cache a failed read", async () => {
    const { store } = memoryStore();
    let calls = 0;
    const cache = createRuntimeCache({
      name: "failing-catalogue",
      ttlSeconds: TTL_SECONDS,
      load: async (_client: object) => {
        calls += 1;
        if (calls === 1) throw new Error("connection dropped");
        return [3];
      },
      store,
    });
    await expect(cache.read({})).rejects.toThrow("connection dropped");
    expect(await cache.read({})).toEqual([3]);
    expect(calls).toBe(2);
  });

  it("reads again after an invalidation, and an earlier read in flight cannot refill it", async () => {
    const { store } = memoryStore();
    const gate = deferred();
    const loading = deferred();
    let reads = 0;
    const cache = createRuntimeCache({
      name: "gated-catalogue",
      ttlSeconds: TTL_SECONDS,
      load: async (_client: object) => {
        reads += 1;
        const value = reads;
        if (value === 1) {
          loading.resolve();
          await gate.promise;
        }
        return [value];
      },
      store,
    });
    const stale = cache.read({});
    await loading.promise;
    await cache.invalidate();
    const fresh = cache.read({});
    gate.resolve();
    expect(await stale).toEqual([1]);
    expect(await fresh).toEqual([2]);
    expect(await cache.read({})).toEqual([2]);
    expect(reads).toBe(2);
  });

  it("reads the database while the Runtime Cache fails", async () => {
    const { store } = memoryStore();
    store.get.mockRejectedValue(new Error("cache unavailable"));
    const database = { reads: 0, rows: [[1], [2]] };
    const cache = instance(store, database);
    expect(await cache.read({})).toEqual([1]);
    expect(await cache.read({})).toEqual([2]);
    store.expireTag.mockRejectedValue(new Error("cache unavailable"));
    await expect(cache.invalidate()).rejects.toThrow("Could not invalidate");
  });

  it("invalidates every Runtime Cache together", async () => {
    const first = { reads: 0, rows: [[1], [2]] };
    const second = { reads: 0, rows: [[3], [4]] };
    const caches = [first, second].map((database, index) =>
      createRuntimeCache({
        name: `reset-catalogue-${index}`,
        ttlSeconds: TTL_SECONDS,
        load: async (_client: object) => [...(database.rows[database.reads++] ?? [])],
      }),
    );
    await Promise.all(caches.map((cache) => cache.read({})));
    await invalidateRuntimeCaches();
    expect(await caches[0]!.read({})).toEqual([2]);
    expect(await caches[1]!.read({})).toEqual([4]);
  });
});
