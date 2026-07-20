import type { NormalizedSectorObject } from "@/libs/sector-map/types";

/**
 * The decoration asset registry: every scenery sprite that can appear on a
 * sector map, addressed by a stable semantic key. Authored maps reference
 * these keys (never raw URLs), so art can be swapped without republishing
 * maps and the content team sees meaningful names in the Tiled editor.
 */
export interface DecorationAsset {
  key: string;
  filepath: string;
  /** Sway in the wind shader */
  windAffected?: boolean;
  /** Hidden when the player enables the small-object filter */
  small?: boolean;
  /** Deterministic sprite rotation (used for ice floes) */
  randomRotation?: boolean;
  /** Default rendered height in hex-height units for objects without an
   *  explicit size (a Tiled resize or scale property always wins) */
  renderScale?: number;
}

export const DECORATION_ASSETS: DecorationAsset[] = [
  {
    key: "grass.tuft",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJa55Vc5YYfKMcJ2B5EmWt6VsNgqxpG8OSXAQk.webp",
    windAffected: true,
    small: true,
  },
  {
    key: "grass.sprout",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJlvcZlIrWYxAsuC7ofQn9pM45OD0ERqkdBXJU.webp",
    windAffected: true,
    small: true,
  },
  {
    key: "grass.flower",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJcpFFdRSnxBpQqGNDcTHbLmYz8uXAl3oa54ti.webp",
    windAffected: true,
    small: true,
  },
  {
    key: "grass.pebble",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJxfrF3oWZsq9k0Von5rUfP6OgQ2TyptCKHS4u.webp",
    small: true,
  },
  {
    key: "tree.green.round",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJndYwvrmojJ0EqeDCvBrNmZaXVdY97gSpOWiA.webp",
    windAffected: true,
  },
  {
    key: "tree.green.tall",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJvFn4sIEmSnXwslYEpV1yOeNL8gMtqhjPdf36.webp",
    windAffected: true,
  },
  {
    key: "tree.green.wide",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJHl8NCiQvYURJhgs76VZtf9wxpMa13Cq0iOnr.webp",
    windAffected: true,
  },
  {
    key: "cactus.saguaro",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJe0aIBjyV3OvUJQExAi0bGoIZDF74LqSnHRdp.webp",
    windAffected: true,
  },
  {
    key: "cactus.barrel",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJ7vgcu3XKPBOUWGyFuM4DlL1v5HNTZhkte0z6.webp",
    windAffected: true,
  },
  {
    key: "cactus.cluster",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJvmatJJEmSnXwslYEpV1yOeNL8gMtqhjPdf36.webp",
    windAffected: true,
  },
  {
    key: "rock.sand",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJQlUKaJVjhzBPya1rwfCIqOTU0cV5xgsMeo3u.webp",
    small: true,
  },
  {
    key: "rock.grey",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJzLLsgkemvaQu94EYJs8HpxVzofny6iPtbgCZ.webp",
    small: true,
  },
  {
    key: "rock.slate",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJylERmDukVH2MI5Lo4ehEfAXvZdcmtWqPg7rp.webp",
    small: true,
  },
  {
    key: "ice.floe",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJzJ76QEemvaQu94EYJs8HpxVzofny6iPtbgCZ.webp",
    small: true,
    randomRotation: true,
  },
  {
    key: "tree.snow.pine",
    filepath:
      "https://uploadthing.b-cdn.net/f/Hzww9EQvYURJrtEwSR2huJPmdY8zI2ptZXAoEj1c6BMKvrQO.webp",
    windAffected: true,
  },
];

export const DECORATION_ASSETS_BY_KEY = new Map(
  DECORATION_ASSETS.map((asset) => [asset.key, asset]),
);

/**
 * Per-terrain species tables used by the map GENERATOR to bake decoration
 * placements into the authored Tiled JSON. `chance` gates whether a tile can
 * host the species at all; `scale`/`scaleVariation` produce the stored
 * per-object size; `posVariation` produces the stored horizontal offset.
 * Density and species mix match the legacy runtime scatter.
 */
export interface DecorationSpecies {
  key: string;
  chance: number;
  scale: number;
  scaleVariation: number;
  posVariation: number;
}

export const TERRAIN_DECORATION_SPECIES: Record<string, DecorationSpecies[]> = {
  ground: [
    {
      key: "grass.tuft",
      chance: 0.5,
      scale: 1,
      scaleVariation: 0.2,
      posVariation: 0.25,
    },
    {
      key: "grass.sprout",
      chance: 0.3,
      scale: 1,
      scaleVariation: 0.2,
      posVariation: 0.25,
    },
    {
      key: "grass.flower",
      chance: 0.1,
      scale: 0.7,
      scaleVariation: 0.2,
      posVariation: 0.25,
    },
    {
      key: "grass.pebble",
      chance: 0.1,
      scale: 1,
      scaleVariation: 0.2,
      posVariation: 0.25,
    },
    {
      key: "tree.green.round",
      chance: 0.7,
      scale: 2,
      scaleVariation: 0.7,
      posVariation: 0.25,
    },
    {
      key: "tree.green.tall",
      chance: 0.7,
      scale: 2,
      scaleVariation: 0.7,
      posVariation: 0.25,
    },
    {
      key: "tree.green.wide",
      chance: 0.5,
      scale: 2,
      scaleVariation: 0.7,
      posVariation: 0.25,
    },
  ],
  dessert: [
    {
      key: "cactus.saguaro",
      chance: 0.1,
      scale: 1,
      scaleVariation: 0.2,
      posVariation: 0.25,
    },
    {
      key: "cactus.barrel",
      chance: 0.1,
      scale: 1,
      scaleVariation: 0.2,
      posVariation: 0.25,
    },
    {
      key: "cactus.cluster",
      chance: 0.1,
      scale: 1,
      scaleVariation: 0.2,
      posVariation: 0.25,
    },
    {
      key: "rock.sand",
      chance: 0.2,
      scale: 1,
      scaleVariation: 0.2,
      posVariation: 0.25,
    },
    {
      key: "rock.grey",
      chance: 0.1,
      scale: 1,
      scaleVariation: 0.2,
      posVariation: 0.25,
    },
    {
      key: "rock.slate",
      chance: 0.1,
      scale: 1,
      scaleVariation: 0.2,
      posVariation: 0.25,
    },
  ],
  ice: [
    {
      key: "ice.floe",
      chance: 0.1,
      scale: 0.9,
      scaleVariation: 0.2,
      posVariation: 0.25,
    },
  ],
  snow: [
    {
      key: "rock.grey",
      chance: 0.1,
      scale: 1,
      scaleVariation: 0.2,
      posVariation: 0.25,
    },
    {
      key: "rock.slate",
      chance: 0.1,
      scale: 1,
      scaleVariation: 0.2,
      posVariation: 0.25,
    },
    {
      key: "tree.snow.pine",
      chance: 0.4,
      scale: 2,
      scaleVariation: 0.7,
      posVariation: 0.25,
    },
  ],
  ocean: [],
};

export interface DecorationPlacement {
  x: number;
  y: number;
  assetKey: string;
  scale: number;
  offsetX: number;
}

interface DecorationTileInput {
  x: number;
  y: number;
  terrain: string;
  zone: string;
  blocked: boolean;
  walkCost: number;
  decoration?: boolean;
}

/**
 * Bake decoration placements for a sector (generator-side). Mirrors the
 * legacy runtime scatter: one roll per tile gates the candidate species,
 * the roll's proximity to each species' half-scale picks the winner, and
 * size/offset jitter is stored explicitly so the render is fully authored.
 * Tiles that are blocked, roads, water, or flagged decoration=false stay
 * clear. Iteration is row-major so output is deterministic per prng seed.
 */
export const generateDecorationPlacements = (
  prng: () => number,
  tiles: DecorationTileInput[],
): DecorationPlacement[] => {
  const placements: DecorationPlacement[] = [];
  const sorted = [...tiles].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const tile of sorted) {
    if (tile.blocked || tile.walkCost <= 0) continue;
    if (tile.zone === "road" || tile.zone === "water") continue;
    if (tile.decoration === false) continue;
    const species = TERRAIN_DECORATION_SPECIES[tile.terrain];
    if (!species || species.length === 0) continue;
    const roll = prng();
    const candidates = species.filter((candidate) => roll < candidate.chance);
    if (candidates.length === 0) continue;
    // Pick the species whose size class sits closest to the tile's affinity
    // roll; the jitter breaks ties between same-sized species so all of
    // them appear (mirrors the legacy runtime scatter)
    const affinity = prng();
    const winner = candidates
      .map((candidate) => ({
        candidate,
        distance: Math.abs(candidate.scale / 2 - affinity + prng() / 10),
      }))
      .reduce((best, entry) =>
        entry.distance < best.distance ? entry : best,
      ).candidate;
    placements.push({
      x: tile.x,
      y: tile.y,
      assetKey: winner.key,
      scale:
        Math.round((winner.scale + winner.scaleVariation * (prng() - 0.5)) * 100) / 100,
      offsetX: Math.round(winner.posVariation * (prng() - 0.5) * 100) / 100,
    });
  }
  return placements;
};

/** The art/metadata half of a MapAsset DB row (shared creator asset library) */
export interface MapAssetRecord {
  key: string;
  imageUrl: string;
  windAffected: boolean;
  small: boolean;
  randomRotation: boolean;
  renderScale: number;
}

/**
 * Decoration registry used at render time: the built-in assets overlaid with
 * the MapAsset DB rows (the creator-managed library). DB rows win on key
 * collisions, so the content team can re-skin built-ins without a deploy;
 * new DB keys become placeable assets in the Tiled kit automatically.
 */
export const mergeDecorationAssets = (
  dbAssets: MapAssetRecord[],
): Map<string, DecorationAsset> => {
  const merged = new Map(DECORATION_ASSETS_BY_KEY);
  for (const row of dbAssets) {
    merged.set(row.key, {
      key: row.key,
      filepath: row.imageUrl,
      windAffected: row.windAffected,
      small: row.small,
      randomRotation: row.randomRotation,
      renderScale: row.renderScale,
    });
  }
  return merged;
};

/** Runtime lookup for authored decoration objects */
export const resolveDecorationAsset = (
  object: Pick<NormalizedSectorObject, "assetKey">,
  registry: Map<string, DecorationAsset>,
): DecorationAsset | undefined => {
  return object.assetKey ? registry.get(object.assetKey) : undefined;
};
