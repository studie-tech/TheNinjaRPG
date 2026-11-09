import { insertLpcSeedAsset, listGameAssetForGetSceneAssets } from "@/queries/asset";
import type { DrizzleClient } from "@/server/db";
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
  // Bounded batches keep the seed usable over the HTTP database driver.
  for (const batch of chunkArray(assets, 10))
    await Promise.all(
      batch.map((asset) => retryOnDeadlock(() => insertLpcSeedAsset(client, asset))),
    );
  return {
    designs: assets.length,
    inserted: assets.length - existing.length,
    preserved: existing.length,
  };
};
