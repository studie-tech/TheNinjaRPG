import { afterEach, expect, it, vi } from "bun:test";
import { buildLpcCatalog } from "@/libs/lpc/catalog";
import type { DrizzleClient } from "@/server/db";
import { fetchLpcCatalog, invalidateLpcCatalog } from "@/server/utils/lpcCatalog";
import { lpcAssets } from "../../setup/lpc";

afterEach(() => vi.restoreAllMocks());

/** A database whose LPC reads are counted and can be held open or failed. */
const database = () => {
  const findMany = vi.fn(async () => lpcAssets);
  const client = { query: { gameAsset: { findMany } } } as unknown as DrizzleClient;
  return { client, findMany };
};

it("shares one read between concurrent scenes and serves later scenes from the instance", async () => {
  const { client, findMany } = database();
  const [first, second] = await Promise.all([
    fetchLpcCatalog(client),
    fetchLpcCatalog(client),
  ]);
  expect(first.catalog).toEqual(buildLpcCatalog(lpcAssets));
  expect(second).toBe(first);
  expect((await fetchLpcCatalog(client)).catalog).toBe(first.catalog);
  expect(findMany).toHaveBeenCalledTimes(1);
});

it("reloads after the TTL and does not cache a failed read", async () => {
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const { client, findMany } = database();
  findMany.mockRejectedValueOnce(new Error("Database unavailable"));
  await expect(fetchLpcCatalog(client)).rejects.toThrow("Database unavailable");
  await fetchLpcCatalog(client);
  expect(findMany).toHaveBeenCalledTimes(2);
  now += 59_000;
  await fetchLpcCatalog(client);
  expect(findMany).toHaveBeenCalledTimes(2);
  now += 1_000;
  await fetchLpcCatalog(client);
  expect(findMany).toHaveBeenCalledTimes(3);
});

it("lets a save replace the snapshot, even while an older read is still in flight", async () => {
  const { client, findMany } = database();
  let release!: () => void;
  findMany.mockImplementationOnce(
    () => new Promise((resolve) => (release = () => resolve(lpcAssets))),
  );
  const stale = fetchLpcCatalog(client);
  invalidateLpcCatalog();
  const edited = [{ ...lpcAssets[0]!, id: "saved-artwork" }];
  findMany.mockResolvedValue(edited);
  // A request after the save does not join the read that started before it.
  const saved = fetchLpcCatalog(client);
  release();
  expect((await stale).assets).toBe(lpcAssets);
  expect((await saved).assets).toBe(edited);
  expect((await fetchLpcCatalog(client)).assets).toBe(edited);
  expect(findMany).toHaveBeenCalledTimes(2);
});

it("reads past the cache for editors and keeps their newer snapshot", async () => {
  const { client, findMany } = database();
  await fetchLpcCatalog(client);
  const edited = [{ ...lpcAssets[0]!, id: "saved-elsewhere" }];
  findMany.mockResolvedValue(edited);
  expect((await fetchLpcCatalog(client, { fresh: true })).assets).toBe(edited);
  expect((await fetchLpcCatalog(client)).assets).toBe(edited);
  expect(findMany).toHaveBeenCalledTimes(2);
});
