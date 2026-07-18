/**
 * Seed the MapTerrain table with the built-in terrain registry, so the content
 * team can edit the current terrain kinds in the tilesets manager and add new
 * ones. Idempotent: existing keys are updated with the built-in look, unknown
 * (creator-added) keys are left untouched. The five built-ins are marked
 * protected (their keys anchor the globe biomes and combat arenas).
 *
 * Usage (from /app): bun run scripts/seed-map-terrains.ts
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { mapTerrain } from "@/drizzle/schema";
import { BUILTIN_TERRAINS } from "@/libs/sector-map/terrains";
import { drizzleDB } from "@/server/db";

/** Idempotently upsert the built-in terrains into the MapTerrain table */
const main = async () => {
  let created = 0;
  let updated = 0;
  for (const spec of BUILTIN_TERRAINS) {
    const values = {
      key: spec.key,
      name: spec.name,
      colors: spec.colors,
      textureUrl: spec.textureUrl,
      swatchColor: spec.swatchColor,
      battleBiome: spec.battleBiome,
      isWater: spec.isWater,
      depression: spec.depression,
      defaultWalkCost: spec.defaultWalkCost,
      protected: true,
    };
    const existing = await drizzleDB.query.mapTerrain.findFirst({
      where: eq(mapTerrain.key, spec.key),
    });
    if (existing) {
      await drizzleDB
        .update(mapTerrain)
        .set(values)
        .where(eq(mapTerrain.key, spec.key));
      updated += 1;
    } else {
      await drizzleDB.insert(mapTerrain).values({ id: nanoid(), ...values });
      created += 1;
    }
  }
  console.log(`Seeded terrains: ${created} created, ${updated} updated`);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
