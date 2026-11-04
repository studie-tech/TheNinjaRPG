/**
 * Seed the MapAsset and MapTerrain tables with the built-in registries, so the content
 * team can browse and edit them in the tilesets manager and new maps can reference them.
 * Idempotent: existing keys are updated with the built-in values, unknown (creator-added)
 * keys are left untouched. The five built-in terrains are marked protected (their keys
 * anchor the globe biomes and combat arenas).
 *
 * Usage (from /app): bun run scripts/seed-map-registry.ts
 */
import { nanoid } from "nanoid";
import { mapAsset, mapTerrain } from "@/drizzle/schema";
import { DECORATION_ASSETS } from "@/libs/sector-map/decorations";
import { BUILTIN_TERRAINS } from "@/libs/sector-map/terrains";
import { drizzleDB } from "@/server/db";

const main = async () => {
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
    await drizzleDB
      .insert(mapAsset)
      .values({ id: nanoid(), ...values })
      .onDuplicateKeyUpdate({ set: values });
  }
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
    await drizzleDB
      .insert(mapTerrain)
      .values({ id: nanoid(), ...values })
      .onDuplicateKeyUpdate({ set: values });
  }
  console.log(
    `Seeded ${DECORATION_ASSETS.length} map assets and ${BUILTIN_TERRAINS.length} terrains`,
  );
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
