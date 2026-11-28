import { buildLpcCatalog, type LpcCatalog, mergeLpcCatalogs } from "@/libs/lpc/catalog";
import {
  listLpcAssets,
  selectLpcSceneDefinitions,
  selectLpcSceneRevisions,
} from "@/queries/asset";
import type { DrizzleClient } from "@/server/db";
import { createRuntimeEntryCache } from "@/server/utils/caches/runtimeCache";

// Complete scenes exceed the Runtime Cache item limit. Compiled individual designs share
// layouts and omit editor metadata, reducing cache reads relative to the full JSON rows.
const lpcSceneCatalog = createRuntimeEntryCache<{
  revision: string;
  catalog: LpcCatalog;
}>({
  name: "lpc-scene-catalog",
  ttlSeconds: 24 * 60 * 60,
  scope: "deployment",
  memoryLimit: 128,
});
let held: { signature: string; catalog: LpcCatalog } | undefined;
let generation = 0;
const pending = new Map<string, Promise<LpcCatalog>>();

/** Reuse only definitions whose content hash matches the revision read from the database. */
export const fetchLpcSceneCatalog = async (
  client: DrizzleClient,
): Promise<LpcCatalog> => {
  const revisions = await selectLpcSceneRevisions(client);
  const signature = JSON.stringify(revisions);
  if (held?.signature === signature) return held.catalog;
  const key = `${generation}:${signature}`;
  const current = pending.get(key);
  if (current) return current;
  const started = generation;
  const compile = async () => {
    const entryKey = (row: { id: string; revision: string }) =>
      `${row.id}:${row.revision}`;
    const stored = await lpcSceneCatalog.read(revisions.map(entryKey));
    const missing = revisions.filter(
      (row) => stored.get(entryKey(row))?.revision !== row.revision,
    );
    if (missing.length) {
      const rows = await selectLpcSceneDefinitions(
        client,
        missing.map((row) => row.id),
      );
      const expected = new Set(missing.map(entryKey));
      // An edit or deletion between the revision and definition reads needs one fresh snapshot.
      if (
        rows.length !== missing.length ||
        rows.some((row) => !expected.has(entryKey(row)))
      )
        return buildLpcCatalog(await listLpcAssets(client));
      await Promise.all(
        rows.map(async (row) => {
          const value = { revision: row.revision, catalog: buildLpcCatalog([row]) };
          stored.set(entryKey(row), value);
          await lpcSceneCatalog.write(entryKey(row), value);
        }),
      );
    }
    const catalog = mergeLpcCatalogs(
      revisions.map((row) => {
        const definition = stored.get(entryKey(row));
        if (!definition)
          throw new Error("Missing character design after revision hydration");
        return definition.catalog;
      }),
    );
    if (generation === started) held = { signature, catalog };
    return catalog;
  };
  const request = compile().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
};

/** Reclaim held definitions after staff writes; fresh revision reads also detect external edits. */
export const invalidateLpcSceneCatalog = async () => {
  generation++;
  held = undefined;
  await lpcSceneCatalog.clear();
};
