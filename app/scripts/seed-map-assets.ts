/**
 * Seed the MapAsset table with the built-in decoration registry, so the
 * content team can browse/edit the current assets in the tilesets manager and
 * new maps can reference them. Idempotent: existing keys are updated with the
 * built-in art/metadata, unknown (creator-added) keys are left untouched.
 *
 * Usage (from /app): bun run scripts/seed-map-assets.ts
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { mapAsset } from "@/drizzle/schema";
import { DECORATION_ASSETS } from "@/libs/sector-map/decorations";
import { drizzleDB } from "@/server/db";

/** Idempotently upsert the built-in decoration sprites into the MapAsset table */
const main = async () => {
  let created = 0;
  let updated = 0;
  for (const asset of DECORATION_ASSETS) {
    const values = {
      key: asset.key,
      // "tree.green.round" -> name "Tree Green Round", category "tree"
      name: asset.key
        .split(".")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
      category: asset.key.split(".")[0] ?? "",
      imageUrl: asset.filepath,
      windAffected: asset.windAffected ?? false,
      small: asset.small ?? false,
      randomRotation: asset.randomRotation ?? false,
    };
    const existing = await drizzleDB.query.mapAsset.findFirst({
      where: eq(mapAsset.key, asset.key),
    });
    if (existing) {
      await drizzleDB
        .update(mapAsset)
        .set(values)
        .where(eq(mapAsset.key, asset.key));
      updated++;
    } else {
      await drizzleDB.insert(mapAsset).values({ id: nanoid(), ...values });
      created++;
    }
  }
  console.log(`Seeded map assets: ${created} created, ${updated} updated`);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
