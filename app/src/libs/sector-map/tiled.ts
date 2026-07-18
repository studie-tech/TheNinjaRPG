import { z } from "zod";
import type { CombatBiome } from "@/drizzle/constants";
import {
  COMBAT_BIOMES,
  HEX_ASPECT_RATIO,
  SECTOR_MAP_MAX_DIMENSION,
  SECTOR_MAP_VERSION,
} from "@/drizzle/constants";
import { isValidSectorId } from "@/libs/sector-map/sector-ids";
import {
  FALLBACK_TERRAIN_KEY,
  resolveTerrainSpec,
  type TerrainSpec,
} from "@/libs/sector-map/terrains";
import type {
  NormalizedSectorAnchor,
  NormalizedSectorExit,
  NormalizedSectorMap,
  NormalizedSectorObject,
  NormalizedSectorTile,
  SectorMapObjectType,
  SectorMapZone,
} from "@/libs/sector-map/types";
import { SECTOR_MAP_OBJECT_TYPES } from "@/libs/sector-map/types";
import { validateNormalizedSectorMap } from "@/libs/sector-map/validation";
import { clamp } from "@/utils/math";

const TiledPropertySchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  value: z.unknown(),
});

const TiledObjectSchema = z.object({
  id: z.number().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  // Tiled 1.9+ renamed object "type" to "class"; re-exported maps may carry
  // either field, so the importer accepts both
  class: z.string().optional(),
  // Tile-objects (e.g. decorations dragged from the tileset palette) reference
  // their tileset tile by gid; the importer inherits that tile's properties
  gid: z.number().optional(),
  x: z.number(),
  y: z.number(),
  // Tile-object display size; a creator resizing the object in Tiled changes
  // these, and the importer turns that into the rendered sprite size (WYSIWYG)
  width: z.number().optional(),
  height: z.number().optional(),
  properties: z.array(TiledPropertySchema).optional(),
});

// Element-count caps so a crafted upload cannot make the importer do
// unbounded work. Tiled arrays are otherwise attacker-sized: a giant
// tiles[]/objects[] would turn the per-cell property lookup into an O(n^2)
// hang. Bounds are generous vs. any real 64x64 map but reject abusive inputs.
const MAX_CELLS = SECTOR_MAP_MAX_DIMENSION * SECTOR_MAP_MAX_DIMENSION;
const MAX_TILESET_TILES = 4096;
const MAX_OBJECTS = 2 * MAX_CELLS;
const MAX_LAYERS = 16;
const MAX_TILESETS = 64;
const MAX_PROPERTIES = 64;

const TiledLayerSchema = z.object({
  name: z.string(),
  type: z.string(),
  data: z.array(z.number()).max(MAX_CELLS).optional(),
  objects: z.array(TiledObjectSchema).max(MAX_OBJECTS).optional(),
  properties: z.array(TiledPropertySchema).max(MAX_PROPERTIES).optional(),
});

const TiledTilesetTileSchema = z.object({
  id: z.number(),
  type: z.string().optional(),
  // Tiled 1.9+ writes tile "type" as "class" when re-saving
  class: z.string().optional(),
  // Native sprite size of a collection-tileset tile: the baseline for telling
  // an untouched tile-object (renders at the asset's default size) apart from
  // one the creator resized in Tiled (renders at the resized size)
  imageheight: z.number().optional(),
  properties: z.array(TiledPropertySchema).max(MAX_PROPERTIES).optional(),
});

const TiledTilesetSchema = z.object({
  firstgid: z.number(),
  tiles: z.array(TiledTilesetTileSchema).max(MAX_TILESET_TILES).optional(),
});

const TiledMapSchema = z.object({
  version: z.union([z.string(), z.number()]).optional(),
  orientation: z.string(),
  // "odd" (default) = game-native row order; "even" = the WYSIWYG convention
  // the Tiled kit ships, with rows mirrored so Tiled shows the game view
  staggerindex: z.string().optional(),
  infinite: z.boolean().optional(),
  width: z.number().int(),
  height: z.number().int(),
  tilewidth: z.number().positive(),
  tileheight: z.number().positive(),
  layers: z.array(TiledLayerSchema).max(MAX_LAYERS),
  tilesets: z.array(TiledTilesetSchema).max(MAX_TILESETS).optional(),
});

export type TiledProperty = z.infer<typeof TiledPropertySchema>;
type TiledLayer = z.infer<typeof TiledLayerSchema>;
type TiledMap = z.infer<typeof TiledMapSchema>;
type TiledTileset = z.infer<typeof TiledTilesetSchema>;

export interface NormalizeTiledSectorMapInput {
  sector: number;
  name: string;
  sourceHash?: string;
  tiledJson: unknown;
  /** Valid terrain kinds (built-ins merged with the MapTerrain library) */
  terrainRegistry: Map<string, TerrainSpec>;
}

/** Tiled property array -> {name: value} record (last occurrence wins) */
export const propertiesToRecord = (
  properties?: { name: string; value?: unknown }[],
): Record<string, unknown> => {
  return Object.fromEntries((properties ?? []).map((prop) => [prop.name, prop.value]));
};

/** The value if it is a string, else undefined (Tiled property coercion) */
const asString = (value: unknown) => {
  return typeof value === "string" ? value : undefined;
};

/** The value if it is a finite number, else undefined (Tiled property coercion) */
const asNumber = (value: unknown) => {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

/** The value if it is a boolean, else undefined (Tiled property coercion) */
const asBoolean = (value: unknown) => {
  return typeof value === "boolean" ? value : undefined;
};

// A non-decoration object's assetKey is used verbatim as a texture URL by the
// renderer, so an imported map could point every player's browser at an
// arbitrary host (tracking / content injection). Allow only bare registry keys
// and relative paths, or the UploadThing CDN hosts the game already serves from.
const ALLOWED_ASSET_HOSTS = new Set([
  "uploadthing.b-cdn.net",
  "utfs.io",
  "ui0arpl8sm.ufs.sh",
]);

/** Whether an object's assetKey is safe to persist and later fetch as a URL */
const isSafeAssetReference = (value: string | undefined): boolean => {
  if (!value) return true;
  // Protocol-relative "//host/..." could resolve to any origin
  if (value.startsWith("//")) return false;
  // Absolute URL (has a scheme): must be http(s) to an allowlisted CDN host
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        ALLOWED_ASSET_HOSTS.has(url.hostname)
      );
    } catch {
      return false;
    }
  }
  // Bare registry key or relative same-origin path
  return true;
};

/**
 * Terrain keys are open content: any key in the terrain registry (built-ins
 * plus the MapTerrain library) is valid; unknown keys coerce to ground
 */
const toTerrain = (value: unknown, terrainRegistry: Map<string, TerrainSpec>) => {
  const terrain = asString(value);
  return terrain && terrainRegistry.has(terrain) ? terrain : FALLBACK_TERRAIN_KEY;
};

/** Per-tile combat-arena override, else the terrain's configured arena */
const toBattleBiome = (value: unknown, fallback: CombatBiome) => {
  const biome = asString(value);
  if (biome && COMBAT_BIOMES.includes(biome as (typeof COMBAT_BIOMES)[number])) {
    return biome as (typeof COMBAT_BIOMES)[number];
  }
  return fallback;
};

/**
 * Zones are a closed set (unlike terrain keys): only the known zone names are
 * accepted; anything else coerces to the neutral "wilderness"
 */
const toZone = (value: unknown): SectorMapZone => {
  const zone = asString(value);
  if (
    zone === "village" ||
    zone === "safezone" ||
    zone === "water" ||
    zone === "road" ||
    zone === "structure" ||
    zone === "shrine"
  ) {
    return zone;
  }
  return "wilderness";
};

/**
 * Strip Tiled's horizontal/vertical/diagonal-flip and hex-rotation flags from
 * the four high bits of a gid to recover the raw tile id
 */
const stripTileFlipFlags = (gid: number) => {
  return gid & ~(0x80000000 | 0x40000000 | 0x20000000 | 0x10000000);
};

/**
 * Custom properties of the tileset tile a gid refers to, with the tile's
 * type/class merged in under "type". Resolves the owning tileset as the one
 * with the largest firstgid <= gid; gid 0 (empty cell) yields {}.
 */
const getTilesetTileProperties = (
  tilesets: TiledTileset[],
  gid: number,
): Record<string, unknown> => {
  const cleanGid = stripTileFlipFlags(gid);
  if (cleanGid === 0) return {};
  // The owning tileset is the one with the largest firstgid <= cleanGid. Find it
  // in a single pass; this runs ~2x per tile during import, so avoid copying and
  // re-sorting the tilesets array on every call.
  let tileset: TiledTileset | undefined;
  for (const candidate of tilesets) {
    if (
      candidate.firstgid <= cleanGid &&
      (!tileset || candidate.firstgid > tileset.firstgid)
    ) {
      tileset = candidate;
    }
  }
  if (!tileset) return {};
  const tile = tileset.tiles?.find((candidate) => {
    return tileset.firstgid + candidate.id === cleanGid;
  });
  return {
    type: tile?.type ?? tile?.class,
    ...propertiesToRecord(tile?.properties),
  };
};

/** Native sprite height of the tileset tile a gid refers to (undefined if unknown) */
const getTilesetTileNativeHeight = (
  tilesets: TiledTileset[],
  gid: number,
): number | undefined => {
  const cleanGid = stripTileFlipFlags(gid);
  if (cleanGid === 0) return undefined;
  let tileset: TiledTileset | undefined;
  for (const candidate of tilesets) {
    if (
      candidate.firstgid <= cleanGid &&
      (!tileset || candidate.firstgid > tileset.firstgid)
    ) {
      tileset = candidate;
    }
  }
  const tile = tileset?.tiles?.find((candidate) => {
    return (tileset?.firstgid ?? 0) + candidate.id === cleanGid;
  });
  return tile?.imageheight;
};

/**
 * Layer lookup by name, CASE-INSENSITIVE so creator-renamed layers
 * ("Terrain", "TERRAIN") still import
 */
const getLayer = (map: TiledMap, name: string) => {
  return map.layers.find((layer) => layer.name.toLowerCase() === name.toLowerCase());
};

/**
 * Resolved tileset-tile properties for the cell at (x, y), read from the
 * layer's flat row-major data array (index y * width + x). A missing layer or
 * empty cell yields {}.
 */
const getTilePropertiesAt = (
  map: TiledMap,
  layer: TiledLayer | undefined,
  x: number,
  y: number,
) => {
  const gid = layer?.data?.[y * map.width + x] ?? 0;
  return getTilesetTileProperties(map.tilesets ?? [], gid);
};

/**
 * Unknown or missing object types coerce to "landmark" (the safe
 * no-behavior default) rather than erroring
 */
const normalizeObjectType = (value: string | undefined): SectorMapObjectType => {
  return value && (SECTOR_MAP_OBJECT_TYPES as readonly string[]).includes(value)
    ? (value as SectorMapObjectType)
    : "landmark";
};

/** Standard Tiled cell size for sector maps (flat-top hex, odd-q stagger) */
export const TILED_TILE_WIDTH = 64;
export const TILED_TILE_HEIGHT = 56;
export const TILED_HEX_SIDE_LENGTH = TILED_TILE_WIDTH / 2;
/**
 * Cell height of the WYSIWYG kit convention: the game renders flat-top hexes
 * squashed by HEX_ASPECT_RATIO for perspective, giving an on-screen row pitch
 * of width x ratio x sqrt(3)/2 ~ 28px per 64px column. Kits ship with this
 * tileheight so Tiled's proportions match the game exactly.
 */
export const WYSIWYG_TILE_HEIGHT = Math.round(
  TILED_TILE_WIDTH * HEX_ASPECT_RATIO * (Math.sqrt(3) / 2),
);

/**
 * Vertical distance (in tile heights) from a hex's centre DOWN to where the
 * game roots a decoration sprite's base: half a tile minus the renderer's
 * grounding lift of 0.1 x scale (see the sprite placement in
 * threejs/sector.ts). The exporter grounds tile-objects with this same
 * formula and the importer inverts it, so Tiled shows sprites rooted exactly
 * where the game draws them. Clamped so extreme scales stay within the tile.
 */
export const spriteGroundingOffset = (scale: number) =>
  clamp(0.5 - 0.1 * scale, -0.5, 0.5);

/**
 * Hex tile coordinate -> Tiled pixel centre of that hex (flat-top odd-q:
 * column pitch 0.75*tilewidth, odd columns shifted down half a tile). Exact
 * forward counterpart of the inversion in getObjectCoordinate below - change
 * them together.
 */
export const hexTileToPixel = (x: number, y: number) => ({
  x: x * TILED_TILE_WIDTH * 0.75 + TILED_TILE_WIDTH / 2,
  y:
    y * TILED_TILE_HEIGHT +
    (x % 2 === 1 ? TILED_TILE_HEIGHT / 2 : 0) +
    TILED_TILE_HEIGHT / 2,
});

/**
 * Tile coordinate of an object. Authored objects pin their exact tile via
 * gridX/gridY properties; hand-placed objects (e.g. decorations dragged from
 * the tileset palette in Tiled) fall back to inverting the flat-top odd-q
 * stagger pixel layout (column pitch 0.75*tilewidth, odd columns shifted down
 * half a tile). Tile-objects anchor at bottom-center (the tilesets set
 * objectalignment "bottom"), so their pixel y sits half a tile below the hex
 * centre that point objects use.
 */
const getObjectCoordinate = (
  map: TiledMap,
  object: z.infer<typeof TiledObjectSchema>,
  flipped: boolean,
  spriteScale = 1,
) => {
  // Invert the flat-top staggered pixel layout (column pitch 0.75*tilewidth;
  // in the native "odd" convention odd columns shift down half a tile, in the
  // mirrored WYSIWYG "even" convention the even columns do). Tile-objects
  // (gid) anchor at bottom-center, rooted a grounding offset below the hex
  // centre point-objects use. Clamp the column first so the stagger parity is
  // computed from the in-bounds tile.
  const anchorY =
    object.gid !== undefined
      ? object.y - map.tileheight * spriteGroundingOffset(spriteScale)
      : object.y;
  // The kit's collection tilesets declare objectalignment "bottom", so Tiled
  // anchors tile-objects at bottom-CENTER: object.x IS the sprite's centre
  const col = clamp(
    Math.round((object.x - map.tilewidth / 2) / (map.tilewidth * 0.75)),
    0,
    map.width - 1,
  );
  const stagger = (col % 2 === 1) !== flipped ? map.tileheight / 2 : 0;
  const fileRow = clamp(
    Math.round((anchorY - stagger - map.tileheight / 2) / map.tileheight),
    0,
    map.height - 1,
  );
  // Mirrored files store the game's bottom row first; convert to game rows
  const row = flipped ? map.height - 1 - fileRow : fileRow;

  // gridX/gridY pin the exact authored tile and avoid rounding drift on a clean
  // round-trip. But Tiled leaves those custom properties untouched when a
  // creator DRAGS the object, so once the pixel position no longer resolves to
  // the pinned tile, the drag is what the creator sees and it wins (WYSIWYG).
  // New palette-dragged objects carry no pin and use the pixel position.
  const props = propertiesToRecord(object.properties);
  const propX = asNumber(props.gridX ?? props.tileX);
  const propY = asNumber(props.gridY ?? props.tileY);
  if (propX !== undefined && propY !== undefined) {
    const pinX = clamp(propX, 0, map.width - 1);
    const pinY = clamp(propY, 0, map.height - 1);
    if (pinX === col && pinY === row) return { x: pinX, y: pinY };
  }
  return { x: col, y: row };
};

/**
 * The importer entry point: parse arbitrary Tiled hexagonal JSON into a
 * NormalizedSectorMap. Requires a "terrain" tile layer; the "zones" and
 * "objects" layers are optional (zone/blocked/walkCost read from the zones
 * layer with terrain-layer fallback; exits, anchors and objects derive from
 * the objects layer). Returns {map?, errors, warnings} where map is undefined
 * whenever ANY error was produced, including validateNormalizedSectorMap
 * failures on the assembled result.
 */
export const normalizeTiledSectorMap = (
  input: NormalizeTiledSectorMapInput,
): {
  map?: NormalizedSectorMap;
  errors: string[];
  warnings: string[];
} => {
  const parsed = TiledMapSchema.safeParse(input.tiledJson);
  if (!parsed.success) {
    return {
      errors: parsed.error.issues.map((issue) => issue.message),
      warnings: [],
    };
  }

  const tiledMap = parsed.data;
  const errors: string[] = [];

  if (tiledMap.infinite) errors.push("Infinite Tiled maps are not supported");
  if (tiledMap.orientation !== "hexagonal") {
    errors.push(`Unsupported Tiled orientation ${tiledMap.orientation}`);
  }
  if (
    tiledMap.width <= 0 ||
    tiledMap.height <= 0 ||
    tiledMap.width > SECTOR_MAP_MAX_DIMENSION ||
    tiledMap.height > SECTOR_MAP_MAX_DIMENSION
  ) {
    errors.push(
      `Sector maps must be between 1x1 and ${SECTOR_MAP_MAX_DIMENSION}x${SECTOR_MAP_MAX_DIMENSION}`,
    );
  }

  const terrainLayer = getLayer(tiledMap, "terrain");
  if (!terrainLayer || terrainLayer.type !== "tilelayer" || !terrainLayer.data) {
    errors.push("Missing required terrain tile layer");
  }
  if (
    terrainLayer?.data &&
    terrainLayer.data.length !== tiledMap.width * tiledMap.height
  ) {
    errors.push("Terrain layer size does not match map dimensions");
  }
  if (errors.length > 0) return { errors, warnings: [] };

  const zoneLayer = getLayer(tiledMap, "zones");
  const tiles: NormalizedSectorTile[] = [];
  const warnings: string[] = [];
  // Decorations stamped onto the TERRAIN layer (an easy Tiled mistake: the
  // stamp tool paints into whichever layer is active) are rescued as
  // decoration objects instead of being silently dropped
  const rescuedDecorations: NormalizedSectorObject[] = [];

  // "even" staggerindex marks the mirrored WYSIWYG convention the Tiled kit
  // ships (rows reversed so Tiled shows the game view); convert its rows back
  // to game rows on import. Plain "odd" files (the generator, old kits) are
  // already in game convention.
  const flipped = tiledMap.staggerindex === "even";
  for (let fileY = 0; fileY < tiledMap.height; fileY++) {
    const y = flipped ? tiledMap.height - 1 - fileY : fileY;
    for (let x = 0; x < tiledMap.width; x++) {
      const terrainProps = getTilePropertiesAt(tiledMap, terrainLayer, x, fileY);
      const zoneProps = getTilePropertiesAt(tiledMap, zoneLayer, x, fileY);
      const stampedAssetKey =
        terrainProps.type === "decoration"
          ? asString(terrainProps.assetKey)
          : undefined;
      if (stampedAssetKey) {
        if (isSafeAssetReference(stampedAssetKey)) {
          rescuedDecorations.push({
            id: `terrain-decoration-${x}-${y}`,
            type: "decoration",
            x,
            y,
            assetKey: stampedAssetKey,
          });
          warnings.push(
            `Decoration "${stampedAssetKey}" was painted on the TERRAIN layer at (${x}, ${fileY}). ` +
              `It was imported as a decoration object, but the tile itself has no terrain and falls back to ground — ` +
              `in Tiled, place decorations on the "objects" layer (Insert Tile) instead.`,
          );
        } else {
          errors.push(`Decoration at (${x}, ${y}) references a disallowed asset url`);
        }
      }
      const terrain = toTerrain(
        terrainProps.terrain ?? terrainProps.type,
        input.terrainRegistry,
      );
      const zone = toZone(zoneProps.zone ?? terrainProps.zone);
      const blocked = asBoolean(zoneProps.blocked ?? terrainProps.blocked) ?? false;
      const walkCost = asNumber(zoneProps.walkCost ?? terrainProps.walkCost) ?? 1;
      tiles.push({
        x,
        y,
        terrain,
        walkCost,
        blocked,
        zone,
        battleBiome: toBattleBiome(
          terrainProps.battleBiome,
          resolveTerrainSpec(terrain, input.terrainRegistry).battleBiome,
        ),
        assetKey: asString(terrainProps.assetKey),
        decoration: asBoolean(zoneProps.decoration ?? terrainProps.decoration),
      });
    }
  }

  const objectsLayer = getLayer(tiledMap, "objects");
  const objects: NormalizedSectorObject[] = [];
  const anchors: NormalizedSectorAnchor[] = [];
  const exits: NormalizedSectorExit[] = [];

  for (const object of objectsLayer?.objects ?? []) {
    // Tile-objects inherit their tileset tile's class and properties (that is
    // how a decoration dragged straight from the palette knows its assetKey);
    // properties set on the object itself always win
    const tileProps =
      object.gid !== undefined
        ? getTilesetTileProperties(tiledMap.tilesets ?? [], object.gid)
        : {};
    const props = { ...tileProps, ...propertiesToRecord(object.properties) };
    // || not ??: Tiled writes `"type": ""` for objects without an explicit
    // class (e.g. Insert Tile placements), and the empty string must fall
    // through to the tileset tile's class or the object imports as a landmark
    const objectType = normalizeObjectType(
      object.type || object.class || asString(props.type),
    );
    // WYSIWYG size: a tile-object RESIZED in Tiled (height differs from the
    // tileset tile's native sprite height) renders at that size, measured in
    // tile-height units. Untouched objects keep scale undefined so the asset
    // library's default size applies; an explicit scale property (generator
    // maps) always wins. Computed before the coordinate because the sprite's
    // grounding point (and so its hex) depends on the rendered size.
    let scale = asNumber(props.scale);
    if (
      scale === undefined &&
      objectType === "decoration" &&
      object.gid !== undefined &&
      object.height !== undefined
    ) {
      const nativeHeight = getTilesetTileNativeHeight(
        tiledMap.tilesets ?? [],
        object.gid,
      );
      if (nativeHeight !== undefined && Math.abs(object.height - nativeHeight) > 1) {
        scale = Math.round((object.height / tiledMap.tileheight) * 1000) / 1000;
      }
    }
    // Fresh native-size placements have no derivable scale; the renderer will
    // use the asset's default, which the importer cannot see — ground with
    // scale 1 and let the derived offsets absorb the small residual.
    const groundingScale = scale ?? 1;
    const coordinate = getObjectCoordinate(tiledMap, object, flipped, groundingScale);
    const anchorKey = asString(props.anchorKey ?? object.name);
    const objectId = String(object.id ?? `${objectType}-${objects.length}`);
    const assetKey = asString(props.assetKey);
    if (!isSafeAssetReference(assetKey)) {
      errors.push(`Object ${objectId} references a disallowed asset url`);
    }
    // WYSIWYG placement: keep the sub-tile position the creator chose in Tiled
    // as render offsets (fractions of a tile), so the game draws decorations
    // where they sit in the editor instead of snapping them to the hex centre.
    // Explicit offsetX/offsetY properties (generator maps) always win.
    let offsetX = asNumber(props.offsetX);
    let offsetY = asNumber(props.offsetY);
    if (
      objectType === "decoration" &&
      (offsetX === undefined || offsetY === undefined)
    ) {
      const centreX = coordinate.x * tiledMap.tilewidth * 0.75 + tiledMap.tilewidth / 2;
      // The hex centre in FILE pixel space (mirrored files reverse the row
      // order and flip the stagger parity); the vertical remainder then flips
      // sign so stored offsets are always game-convention
      const fileRow = flipped ? tiledMap.height - 1 - coordinate.y : coordinate.y;
      const centreY =
        fileRow * tiledMap.tileheight +
        ((coordinate.x % 2 === 1) !== flipped ? tiledMap.tileheight / 2 : 0) +
        tiledMap.tileheight / 2;
      // Tile-objects root at the renderer's grounding point below the hex
      // centre; inverting with the same formula makes the round trip exact
      const anchorY =
        object.gid !== undefined
          ? object.y - tiledMap.tileheight * spriteGroundingOffset(groundingScale)
          : object.y;
      const derivedX = clamp((object.x - centreX) / tiledMap.tilewidth, -0.5, 0.5);
      const derivedYFile = clamp((anchorY - centreY) / tiledMap.tileheight, -0.5, 0.5);
      const derivedY = flipped ? -derivedYFile : derivedYFile;
      // Skip near-zero remainders so clean hex-centre placements stay unoffset
      if (offsetX === undefined && Math.abs(derivedX) > 0.01) {
        offsetX = Math.round(derivedX * 1000) / 1000;
      }
      if (offsetY === undefined && Math.abs(derivedY) > 0.01) {
        offsetY = Math.round(derivedY * 1000) / 1000;
      }
    }
    const normalizedObject: NormalizedSectorObject = {
      id: objectId,
      type: objectType,
      x: coordinate.x,
      y: coordinate.y,
      route: asString(props.route),
      assetKey,
      anchorKey,
      scale,
      offsetX,
      offsetY,
    };
    objects.push(normalizedObject);

    if (
      anchorKey &&
      (objectType === "anchor" || objectType === "structure" || objectType === "shrine")
    ) {
      anchors.push({ key: anchorKey, x: coordinate.x, y: coordinate.y });
    }
    if (objectType === "exit") {
      const targetSector = asNumber(props.targetSector);
      const targetAnchor = asString(props.targetAnchor) ?? "spawn.default";
      if (anchorKey && targetSector !== undefined && isValidSectorId(targetSector)) {
        anchors.push({ key: anchorKey, x: coordinate.x, y: coordinate.y });
        exits.push({
          fromAnchor: anchorKey,
          targetSector,
          targetAnchor,
          travelCost: asNumber(props.travelCost),
        });
      } else {
        errors.push(
          `Exit object ${normalizedObject.id} has an invalid anchorKey or targetSector`,
        );
      }
    }
  }

  // Rescued terrain-layer decorations join the regular objects so they render
  // and validate exactly like palette-placed ones
  objects.push(...rescuedDecorations);

  // Identical decorations at the SAME rendered position (tile + sub-tile
  // offset, bucketed to 1/20 tile) draw exactly on top of each other and look
  // like a single sprite. Placement is otherwise WYSIWYG via the derived
  // offsets, so this only fires for true pixel-level overlaps in Tiled.
  const stackedDecorations = new Map<string, number>();
  for (const object of objects) {
    if (object.type !== "decoration" || !object.assetKey) continue;
    const bucketX = Math.round((object.offsetX ?? 0) * 20);
    const bucketY = Math.round((object.offsetY ?? 0) * 20);
    const key = `${object.assetKey}@(${object.x}, ${object.y})@${bucketX}:${bucketY}`;
    stackedDecorations.set(key, (stackedDecorations.get(key) ?? 0) + 1);
  }
  for (const [key, count] of stackedDecorations) {
    if (count > 1) {
      const [assetKey, coordinate] = key.split("@");
      warnings.push(
        `${count} "${assetKey}" decorations sit at the same position on tile ${coordinate} ` +
          `and will render as one — move the copies apart in Tiled if they should all be visible`,
      );
    }
  }

  const map: NormalizedSectorMap = {
    formatVersion: SECTOR_MAP_VERSION,
    sector: input.sector,
    name: input.name,
    width: tiledMap.width,
    height: tiledMap.height,
    tiles,
    objects,
    anchors,
    exits,
    metadata: {
      importedAt: new Date().toISOString(),
      source: "tiled",
      sourceHash: input.sourceHash,
      tiledVersion: tiledMap.version?.toString(),
    },
  };

  const validation = validateNormalizedSectorMap(map, input.terrainRegistry);
  // Merge object-level errors (e.g. an exit with an invalid targetSector) with
  // the structural validation errors: BOTH must reject the import, otherwise a
  // malformed exit would be silently dropped and the map saved without it.
  const allErrors = [...errors, ...validation.errors];
  return {
    map: allErrors.length === 0 ? map : undefined,
    errors: allErrors,
    warnings: [...warnings, ...validation.warnings],
  };
};
