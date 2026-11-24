import { insertLpcSeedAsset, listGameAssetForGetSceneAssets } from "@/queries/asset";
import type { DrizzleClient } from "@/server/db";
import { invalidateLpcSceneCatalog } from "@/server/utils/caches/lpcSceneCatalog";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { chunkArray } from "@/utils/array";
import { lpcSeedAssets } from "../data/lpc/seed";

/** Import published LPC designs without uploading files or replacing staff edits. */
export const seedLpcAssets = async (client: DrizzleClient) => {
  const assets = lpcSeedAssets();
  const existing = await listGameAssetForGetSceneAssets(client, {
    assetIds: assets.map((asset) => asset.id),
  });
  const collision = existing.find((asset) => asset && asset.type !== "LPC");
  if (collision)
    throw new Error(
      `GameAsset ID ${collision.id} belongs to another media type; LPC sync stopped.`,
    );
  const existingIds = new Set(existing.map((asset) => asset.id));
  const missing = assets.filter((asset) => !existingIds.has(asset.id));
  // Bounded batches keep the seed usable over the HTTP database driver.
  for (const batch of chunkArray(missing, 10))
    await Promise.all(
      batch.map((asset) => retryOnDeadlock(() => insertLpcSeedAsset(client, asset))),
    );
  if (missing.length > 0) await invalidateLpcSceneCatalog();
  return {
    designs: assets.length,
    inserted: missing.length,
    preserved: existing.length,
  };
};
