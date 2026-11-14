import { afterEach, expect, it, vi } from "bun:test";
import { buildLpcCatalog } from "@/libs/lpc/catalog";
import type { DrizzleClient } from "@/server/db";
import { fetchLpcSceneCatalog, invalidateLpcCatalog } from "@/server/utils/lpcCatalog";
import { lpcAssets } from "../../setup/lpc";

afterEach(() => vi.restoreAllMocks());

/** A database whose LPC reads are counted. */
const database = () => {
  const findMany = vi.fn(async () => lpcAssets);
  const client = { query: { gameAsset: { findMany } } } as unknown as DrizzleClient;
  return { client, findMany };
};

it("compiles the library once for concurrent and later scenes", async () => {
  const { client, findMany } = database();
  const [first, second] = await Promise.all([
    fetchLpcSceneCatalog(client),
    fetchLpcSceneCatalog(client),
  ]);
  expect(first).toEqual(buildLpcCatalog(lpcAssets));
  expect(second).toBe(first);
  expect(await fetchLpcSceneCatalog(client)).toBe(first);
  expect(findMany).toHaveBeenCalledTimes(1);
});

it("compiles saved artwork after an LPC write", async () => {
  const { client, findMany } = database();
  await fetchLpcSceneCatalog(client);
  const edited = [{ ...lpcAssets[0]!, id: "saved-artwork" }];
  findMany.mockResolvedValue(edited);
  await invalidateLpcCatalog();
  expect(await fetchLpcSceneCatalog(client)).toEqual(buildLpcCatalog(edited));
  expect(findMany).toHaveBeenCalledTimes(2);
});
