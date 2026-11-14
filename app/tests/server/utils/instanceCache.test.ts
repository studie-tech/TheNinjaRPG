import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import {
  createInstanceCache,
  invalidateInstanceCaches,
} from "@/server/utils/instanceCache";

const start = new Date("2026-11-14T12:00:00Z");
const TTL_MS = 60 * 1000;

/** Cache whose reads resolve to the next queued rows, released by the test when deferred. */
const countingCache = (values: number[][]) => {
  let reads = 0;
  const cache = createInstanceCache(TTL_MS, async (_client: object) => [
    ...(values[reads++] ?? []),
  ]);
  return { cache, reads: () => reads };
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("createInstanceCache", () => {
  beforeEach(() => {
    setSystemTime(start);
  });
  afterEach(() => {
    setSystemTime();
  });

  it("serves repeat reads within the TTL and reads again once it passes", async () => {
    const { cache, reads } = countingCache([[1], [2]]);
    const client = {};
    expect(await cache.read(client)).toEqual([1]);
    setSystemTime(new Date(start.getTime() + TTL_MS - 1));
    expect(await cache.read(client)).toEqual([1]);
    expect(reads()).toBe(1);
    setSystemTime(new Date(start.getTime() + TTL_MS));
    expect(await cache.read(client)).toEqual([2]);
    expect(reads()).toBe(2);
  });

  it("shares one read between concurrent misses and hands each caller its own copy", async () => {
    const { cache, reads } = countingCache([[1, 2]]);
    const client = {};
    const [first, second] = await Promise.all([cache.read(client), cache.read(client)]);
    expect(reads()).toBe(1);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    first.splice(0);
    expect(await cache.read(client)).toEqual([1, 2]);
  });

  it("keeps separate snapshots per database client", async () => {
    const { cache, reads } = countingCache([[1], [2]]);
    expect(await cache.read({})).toEqual([1]);
    expect(await cache.read({})).toEqual([2]);
    expect(reads()).toBe(2);
  });

  it("does not cache a failed read", async () => {
    let calls = 0;
    const cache = createInstanceCache(TTL_MS, async (_client: object) => {
      calls += 1;
      if (calls === 1) throw new Error("connection dropped");
      return [3];
    });
    const client = {};
    await expect(cache.read(client)).rejects.toThrow("connection dropped");
    expect(await cache.read(client)).toEqual([3]);
    expect(calls).toBe(2);
  });

  it("reads again after an invalidation, and an earlier read in flight cannot refill it", async () => {
    const gate = deferred();
    let reads = 0;
    const cache = createInstanceCache(TTL_MS, async (_client: object) => {
      reads += 1;
      const value = reads;
      if (value === 1) await gate.promise;
      return [value];
    });
    const client = {};
    const stale = cache.read(client);
    cache.invalidate();
    const fresh = cache.read(client);
    gate.resolve();
    expect(await stale).toEqual([1]);
    expect(await fresh).toEqual([2]);
    expect(await cache.read(client)).toEqual([2]);
    expect(reads).toBe(2);
  });

  it("invalidates every cache together", async () => {
    const first = countingCache([[1], [2]]);
    const second = countingCache([[3], [4]]);
    const client = {};
    await Promise.all([first.cache.read(client), second.cache.read(client)]);
    invalidateInstanceCaches();
    expect(await first.cache.read(client)).toEqual([2]);
    expect(await second.cache.read(client)).toEqual([4]);
  });
});
