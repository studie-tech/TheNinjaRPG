import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { createHash } from "node:crypto";
import { buildLpcCatalog } from "@/libs/lpc/catalog";
import * as assetQueries from "@/queries/asset";
import type { DrizzleClient } from "@/server/db";
import {
  fetchLpcSceneCatalog,
  invalidateLpcSceneCatalog,
} from "@/server/utils/caches/lpcSceneCatalog";
import { lpcAssets } from "../../../setup/lpc";

afterEach(() => vi.restoreAllMocks());
beforeEach(() => invalidateLpcSceneCatalog());

/** Definition hashes change on content writes even when a timestamp is left untouched. */
const database = () => {
  let assets = structuredClone(lpcAssets);
  const rows = () =>
    [...assets]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((asset) => ({
        ...asset,
        revision: createHash("sha256")
          .update(JSON.stringify(asset.lpcConfig))
          .digest("hex"),
      }));
  const findMany = vi.fn(async () => rows());
  const client = { query: { gameAsset: { findMany } } } as unknown as DrizzleClient;
  const revisions = vi
    .spyOn(assetQueries, "selectLpcSceneRevisions")
    .mockImplementation(
      () =>
        Promise.resolve(rows().map(({ id, revision }) => ({ id, revision }))) as never,
    );
  const definitions = vi
    .spyOn(assetQueries, "selectLpcSceneDefinitions")
    .mockImplementation(
      (_client, ids) =>
        Promise.resolve(rows().filter((row) => ids.includes(row.id))) as never,
    );
  return {
    client,
    findMany,
    revisions,
    definitions,
    rows,
    set: (value: typeof assets) => {
      assets = value;
    },
  };
};

it("compiles the library once for concurrent and later scenes", async () => {
  const { client, revisions, definitions, rows } = database();
  const [first, second] = await Promise.all([
    fetchLpcSceneCatalog(client),
    fetchLpcSceneCatalog(client),
  ]);
  expect(first).toEqual(buildLpcCatalog(rows()));
  expect(second).toBe(first);
  expect(await fetchLpcSceneCatalog(client)).toBe(first);
  expect(revisions).toHaveBeenCalledTimes(3);
  expect(definitions).toHaveBeenCalledTimes(1);
});

it("compiles saved artwork after an LPC write", async () => {
  const { client, definitions, rows, set } = database();
  await fetchLpcSceneCatalog(client);
  const edited = [{ ...lpcAssets[0]!, id: "saved-artwork" }];
  set(edited);
  await invalidateLpcSceneCatalog();
  expect(await fetchLpcSceneCatalog(client)).toEqual(buildLpcCatalog(rows()));
  expect(definitions).toHaveBeenCalledTimes(2);
});

it("detects external edits and deletions without invalidation and reloads only changed definitions", async () => {
  const { client, definitions, rows, set } = database();
  await fetchLpcSceneCatalog(client);
  const edited = rows().slice(0, 2);
  edited[0]!.lpcConfig.variants[
    Object.keys(edited[0]!.lpcConfig.variants)[0]!
  ]![0]!.image = "https://example.com/edited.webp";
  set(edited);
  const result = await fetchLpcSceneCatalog(client);
  expect(result).toEqual(buildLpcCatalog(rows()));
  expect(definitions.mock.calls.at(-1)?.[1]).toEqual([edited[0]!.id]);
  expect(Object.keys(result.designs)).toHaveLength(2);
});

it("uses a fresh snapshot when a definition changes between its revision and payload reads", async () => {
  const { client, definitions, findMany, rows, set } = database();
  const edited = rows().slice(0, 1);
  edited[0]!.lpcConfig.variants[
    Object.keys(edited[0]!.lpcConfig.variants)[0]!
  ]![0]!.image = "https://example.com/racing-edit.webp";
  definitions.mockImplementationOnce(() => {
    set(edited);
    return Promise.resolve(rows()) as never;
  });
  expect(await fetchLpcSceneCatalog(client)).toEqual(buildLpcCatalog(rows()));
  expect(findMany).toHaveBeenCalledTimes(1);
});

it("keeps each compiled design below the shared cache item limit", () => {
  for (const asset of lpcAssets)
    expect(
      Buffer.byteLength(
        JSON.stringify({ revision: "f".repeat(64), catalog: buildLpcCatalog([asset]) }),
      ),
    ).toBeLessThan(2 * 1024 * 1024);
});
