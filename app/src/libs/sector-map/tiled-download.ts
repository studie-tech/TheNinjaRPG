import JSZip from "jszip";
import type { DecorationAsset } from "@/libs/sector-map/decorations";
import type { TerrainSpec } from "@/libs/sector-map/terrains";
import {
  propertiesToRecord,
  spriteGroundingOffset,
  TILED_TILE_HEIGHT,
  TILED_TILE_WIDTH,
  type TiledProperty,
  WYSIWYG_TILE_HEIGHT,
} from "@/libs/sector-map/tiled";
import { buildTiledProject, TILED_KIT_README } from "@/libs/sector-map/tiled-project";
import { sleep } from "@/utils/time";

/**
 * Client-side export of a stored sector map into a Tiled-editable .zip.
 *
 * The maps we store are valid hexagonal Tiled JSON, but their embedded "terrain"
 * tileset carries only gameplay data (one tile per unique terrain/zone/blocked
 * combination) and has NO image - so opening the raw JSON in the Tiled editor
 * shows a blank terrain layer. This exporter paints a small color-swatch PNG
 * (one cell per tileset tile, colored by its terrain/zone) and points the
 * embedded tileset at it, so terrain becomes VISIBLE and paintable in Tiled.
 *
 * It is lossless: the tile ids, custom properties, and object layer are left
 * untouched, and the importer (normalizeTiledSectorMap) ignores the image and
 * still reads terrain from the tile properties - so a downloaded map can be
 * edited in Tiled and re-uploaded with no data loss.
 */

interface TiledTile {
  id: number;
  type?: string;
  properties?: TiledProperty[];
}

const ROAD_COLOR = "#8a6a45";
const SHORE_COLOR = "#efe1bf";
const FALLBACK_COLOR = "#8a8a8a";

/** Darken a #rrggbb color toward black by `amount` in [0,1] */
const darken = (hex: string, amount: number): string => {
  const value = Number.parseInt(hex.slice(1), 16);
  const scale = (channel: number) => Math.max(0, Math.round(channel * (1 - amount)));
  const r = scale((value >> 16) & 255);
  const g = scale((value >> 8) & 255);
  const b = scale(value & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
};

/** Swatch color for one tileset tile from its terrain/zone/blocked properties */
const colorForTile = (tile: TiledTile, terrains: Map<string, TerrainSpec>): string => {
  const props = propertiesToRecord(tile.properties);
  const terrain = String(tile.type ?? props.terrain ?? "ground");
  const zone = String(props.zone ?? "wilderness");
  if (zone === "road") return ROAD_COLOR;
  if (terrain === "dessert" && props.decoration === false) return SHORE_COLOR;
  const spec = terrains.get(terrain);
  const base = spec?.swatchColor ?? FALLBACK_COLOR;
  return props.blocked === true && !spec?.isWater ? darken(base, 0.4) : base;
};

/** Paint one horizontal strip PNG, cell k = color of the tileset tile with id k */
const buildTerrainImage = (
  tiles: TiledTile[],
  tileWidth: number,
  tileHeight: number,
  terrains: Map<string, TerrainSpec>,
): { base64: string; width: number; height: number; columns: number } => {
  const columns = tiles.reduce((max, tile) => Math.max(max, tile.id), 0) + 1;
  const canvas = document.createElement("canvas");
  canvas.width = columns * tileWidth;
  canvas.height = tileHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context");
  const byId = new Map(tiles.map((tile) => [tile.id, tile] as const));
  for (let id = 0; id < columns; id++) {
    const tile = byId.get(id);
    ctx.fillStyle = tile ? colorForTile(tile, terrains) : FALLBACK_COLOR;
    ctx.fillRect(id * tileWidth, 0, tileWidth, tileHeight);
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.strokeRect(id * tileWidth + 0.5, 0.5, tileWidth - 1, tileHeight - 1);
  }
  const base64 = canvas.toDataURL("image/png").split(",")[1] ?? "";
  return { base64, width: canvas.width, height: canvas.height, columns };
};

/**
 * The paintable terrain palette, derived from the terrain library. Every
 * terrain gets its regular tile plus a variant: land kinds an impassable
 * "blocked" rock/thicket, water kinds an impassable lake (their regular tile
 * is swimmable). The built-in ground/dessert keys additionally carry the road
 * and beach/shoreline looks. Every download's terrain tileset is topped up
 * with all of these, so a creator can paint ANY terrain in ANY sector.
 */
const buildTerrainPalette = (terrains: Map<string, TerrainSpec>) => {
  const palette: {
    terrain: string;
    zone: string;
    blocked: boolean;
    walkCost: number;
    battleBiome?: string;
    decoration?: boolean;
  }[] = [];
  for (const spec of terrains.values()) {
    // Carry each entry's combat biome so its signature matches the tiles the
    // generator/importer bake (they always write battleBiome). Without it the
    // dedup never matches and the whole palette is appended as a duplicate.
    const battleBiome = spec.battleBiome;
    if (spec.isWater) {
      // Impassable water (lakes/ponds in land sectors)
      palette.push({
        terrain: spec.key,
        zone: "water",
        blocked: true,
        walkCost: 0,
        battleBiome,
      });
      // Swimmable open water
      palette.push({
        terrain: spec.key,
        zone: "wilderness",
        blocked: false,
        walkCost: spec.defaultWalkCost,
        battleBiome,
      });
    } else {
      palette.push({
        terrain: spec.key,
        zone: "wilderness",
        blocked: false,
        walkCost: spec.defaultWalkCost,
        battleBiome,
      });
      palette.push({
        terrain: spec.key,
        zone: "wilderness",
        blocked: true,
        walkCost: 0,
        battleBiome,
      });
    }
  }
  if (terrains.has("ground")) {
    palette.push({
      terrain: "ground",
      zone: "road",
      blocked: false,
      walkCost: 1,
      battleBiome: terrains.get("ground")?.battleBiome ?? "ground",
    });
  }
  if (terrains.has("dessert")) {
    // Beach/shoreline: sand look, ground combat biome, no decorations
    palette.push({
      terrain: "dessert",
      zone: "wilderness",
      blocked: false,
      walkCost: 1,
      battleBiome: "ground",
      decoration: false,
    });
  }
  return palette;
};

/**
 * Dedup key for the palette top-up in ensureFullTerrainPalette. The field set
 * (terrain/zone/blocked/walkCost/battleBiome/decoration) must exactly mirror
 * the properties the generator and importer write - if it drifts, existing
 * tiles never match and the whole palette gets appended as duplicates.
 */
const paletteSignature = (props: Record<string, unknown>) => {
  return [
    props.terrain ?? "",
    props.zone ?? "",
    props.blocked === true,
    Number(props.walkCost ?? 1),
    props.battleBiome ?? "",
    props.decoration === false ? "false" : "",
  ].join("|");
};

/**
 * Append any standard palette entries the sector's terrain tileset is missing,
 * so the full terrain range is paintable. Purely additive: existing tiles (and
 * therefore the painted map data) are untouched, and unused palette tiles are
 * ignored by the importer.
 */
export const ensureFullTerrainPalette = (
  tiles: TiledTile[],
  terrains: Map<string, TerrainSpec>,
) => {
  const existing = new Set(
    tiles.map((tile) => paletteSignature(propertiesToRecord(tile.properties))),
  );
  let nextId = tiles.reduce((max, tile) => Math.max(max, tile.id), -1) + 1;
  for (const entry of buildTerrainPalette(terrains)) {
    const signature = paletteSignature(entry);
    if (existing.has(signature)) continue;
    existing.add(signature);
    const properties: TiledProperty[] = [
      { name: "terrain", type: "string", value: entry.terrain },
      { name: "zone", type: "string", value: entry.zone },
      { name: "blocked", type: "bool", value: entry.blocked },
      { name: "walkCost", type: "int", value: entry.walkCost },
    ];
    if (entry.battleBiome !== undefined) {
      properties.push({
        name: "battleBiome",
        type: "string",
        value: entry.battleBiome,
      });
    }
    if (entry.decoration !== undefined) {
      properties.push({ name: "decoration", type: "bool", value: entry.decoration });
    }
    tiles.push({ id: nextId++, type: entry.terrain, properties });
  }
};

/**
 * Save a Blob client-side via a temporary anchor click; the object URL is
 * revoked afterwards so the blob memory can be released
 */
const triggerDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export interface SpriteFile {
  key: string;
  fileName: string;
  bytes: ArrayBuffer;
  width: number;
  height: number;
  /** The asset library's default size (hex-height units); sizes kit objects */
  renderScale: number;
}

/**
 * A sprite URL plus its canonical-host fallback: the art is served from the
 * bunny CDN mirror, but the uploadthing origin hosts the same file - if a CDN
 * edge misbehaves (stale CORS cache, transient 5xx), the origin still works.
 */
const spriteUrlCandidates = (filepath: string) => {
  const candidates = [filepath];
  const mirrored = filepath.match(/uploadthing\.b-cdn\.net\/(.+)$/);
  if (mirrored?.[1]) candidates.push(`https://utfs.io/${mirrored[1]}`);
  return candidates;
};

const SPRITE_FETCH_ATTEMPTS = 3;

/**
 * Sprites are normalized to at most this edge length in the kit. Source art
 * resolution varies wildly (75px shrubs next to 1024px rocks); the game scales
 * sprites to the hex anyway, but Tiled shows collection tiles at NATIVE size,
 * so one huge source image would dwarf the whole palette.
 */
const MAX_SPRITE_EDGE = 128;

/**
 * Re-encode a decoded sprite as a real PNG, downscaled to the palette-friendly
 * size cap. The CDN content-negotiates and may serve WebP/AVIF bytes for the
 * same URL; the bundled files are named .png and Tiled loads them by
 * extension, so the bytes must actually BE PNG.
 */
const toPngSprite = async (
  bitmap: ImageBitmap,
): Promise<{ bytes: ArrayBuffer; width: number; height: number }> => {
  const scale = Math.min(1, MAX_SPRITE_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D canvas context");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) throw new Error("PNG encoding failed");
  return { bytes: await blob.arrayBuffer(), width, height };
};

/** Fetch + decode + PNG-encode one sprite, retrying with backoff across both hosts */
const fetchSpriteFile = async (asset: DecorationAsset): Promise<SpriteFile> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < SPRITE_FETCH_ATTEMPTS; attempt++) {
    for (const url of spriteUrlCandidates(asset.filepath)) {
      try {
        const response = await fetch(url, {
          cache: attempt === 0 ? "default" : "reload",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.arrayBuffer();
        const bitmap = await createImageBitmap(new Blob([raw]));
        const { bytes, width, height } = await toPngSprite(bitmap);
        bitmap.close();
        return {
          key: asset.key,
          fileName: `decorations/${asset.key}.png`,
          bytes,
          width,
          height,
          renderScale: asset.renderScale ?? 1,
        };
      } catch (error) {
        lastError = error;
      }
    }
    await sleep(400 * (attempt + 1));
  }
  throw lastError;
};

/**
 * Fetch the sprite images of the decoration library so they can be bundled in
 * the zip and shown by Tiled. Failures are retried across both hosts; anything
 * still unreachable is reported back so the creator KNOWS the kit is missing
 * art (those decorations stay editable point markers).
 */
const fetchDecorationSprites = async (
  assets: DecorationAsset[],
): Promise<{ sprites: SpriteFile[]; failedKeys: string[] }> => {
  const results = await Promise.allSettled(assets.map(fetchSpriteFile));
  const sprites: SpriteFile[] = [];
  const failedKeys: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      sprites.push(result.value);
    } else {
      const key = assets[index]?.key ?? "unknown";
      failedKeys.push(key);
      console.warn(`Decoration sprite ${key} unreachable: ${String(result.reason)}`);
    }
  });
  return { sprites, failedKeys };
};

/**
 * Turn the map's decoration point-objects into Tiled tile-objects backed by a
 * bundled collection-of-images tileset, so every tree and rock is VISIBLE in
 * the editor. Purely cosmetic for the game: the importer keeps reading the
 * assetKey/gridX/gridY properties and ignores gid/width/height, so the
 * round-trip stays lossless. Creators can also drag NEW decorations straight
 * from the tileset palette (the tileset tile carries the assetKey property).
 */
export const addDecorationTileset = (
  map: Record<string, unknown>,
  tilesets: Record<string, unknown>[],
  sprites: SpriteFile[],
  tileHeight: number,
) => {
  if (sprites.length === 0) return;
  // First gid above every existing tileset's id range
  const firstgid = tilesets.reduce((max, set) => {
    const setFirst = Number(set.firstgid) || 1;
    const setCount =
      Number(set.tilecount) ||
      (Array.isArray(set.tiles) ? (set.tiles as unknown[]).length : 1);
    return Math.max(max, setFirst + setCount);
  }, 1);
  const gidByKey = new Map(
    sprites.map((sprite, index) => [sprite.key, firstgid + index]),
  );
  tilesets.push({
    firstgid,
    name: "decorations",
    // Collection-of-images tileset: no top-level image; per-tile image files
    columns: 0,
    margin: 0,
    spacing: 0,
    tilewidth: Math.max(...sprites.map((sprite) => sprite.width)),
    tileheight: Math.max(...sprites.map((sprite) => sprite.height)),
    tilecount: sprites.length,
    // Anchor tile-objects at bottom-center, matching how the game grounds
    // sprites on their hex
    objectalignment: "bottom",
    grid: { orientation: "orthogonal", width: 1, height: 1 },
    tiles: sprites.map((sprite, index) => ({
      id: index,
      // Class + assetKey make palette-dragged objects self-describing: the
      // importer inherits them from the tileset tile, so a creator can drop a
      // NEW tree on the map without typing any properties ("type" is the
      // pre-1.9 spelling of "class"; both are set for compatibility)
      type: "decoration",
      class: "decoration",
      image: sprite.fileName,
      imagewidth: sprite.width,
      imageheight: sprite.height,
      properties: [{ name: "assetKey", type: "string", value: sprite.key }],
    })),
  });

  // Point decorations -> visible tile-objects sized like the game renders them
  // (height = scale x hex height, width from the sprite's aspect ratio)
  const spriteByKey = new Map(sprites.map((sprite) => [sprite.key, sprite]));
  const layers = Array.isArray(map.layers)
    ? (map.layers as Record<string, unknown>[])
    : [];
  const objectsLayer = layers.find((layer) => layer.type === "objectgroup");
  const objects = Array.isArray(objectsLayer?.objects)
    ? (objectsLayer.objects as Record<string, unknown>[])
    : [];
  for (const object of objects) {
    if (object.type !== "decoration" && object.class !== "decoration") continue;
    const props = Array.isArray(object.properties)
      ? (object.properties as { name: string; value: unknown }[])
      : [];
    const assetKey = props.find((prop) => prop.name === "assetKey")?.value;
    const sprite = typeof assetKey === "string" ? spriteByKey.get(assetKey) : undefined;
    const gid = typeof assetKey === "string" ? gidByKey.get(assetKey) : undefined;
    if (!sprite || !gid) continue;
    // The object's own scale is its TOTAL size in tile-height units; absent
    // that, the asset library's default applies (mirrors the game renderer)
    const scaleProp = props.find((prop) => prop.name === "scale")?.value;
    const scale = Number(scaleProp) || sprite.renderScale || 1;
    const height = scale * tileHeight;
    // The game draws decoration sprites square on screen, so the kit does too
    const width = height;
    // Stored sub-tile offsets shift the exported position so Tiled shows the
    // decoration exactly where the game renders it (WYSIWYG round-trip)
    const offsetX = Number(props.find((prop) => prop.name === "offsetX")?.value) || 0;
    const offsetY = Number(props.find((prop) => prop.name === "offsetY")?.value) || 0;
    const tileWidth = Number(map.tilewidth) || 64;
    delete object.point;
    object.gid = gid;
    object.width = Math.round(width * 100) / 100;
    object.height = Math.round(height * 100) / 100;
    // The stored point is the sprite's visual centre; the tileset declares
    // objectalignment "bottom", so Tiled anchors at bottom-CENTER: keep x and
    // drop the object to the renderer's grounding point (half a tile minus
    // the 0.1 x scale lift), so Tiled roots it exactly where the game does
    object.x = Math.round(((Number(object.x) || 0) + offsetX * tileWidth) * 100) / 100;
    object.y =
      Math.round(
        ((Number(object.y) || 0) +
          offsetY * tileHeight +
          tileHeight * spriteGroundingOffset(scale)) *
          100,
      ) / 100;
  }
};

/**
 * Build and download a `sector-<n>.zip`: the Tiled map (terrain tileset pointed
 * at a generated swatch image, decorations as visible tile-objects), the
 * bundled decoration sprites, the .tiled-project (object classes + assetKey
 * dropdown built from the shared asset library) and a README. Unzip and open
 * the .json in Tiled.
 */
/**
 * Convert a game-convention Tiled map (staggerindex "odd": row 0 is the row
 * the game renders at the BOTTOM of the screen) into the WYSIWYG convention
 * the kit ships: rows reversed and staggerindex "even", which is the exact
 * vertical mirror of a flat-top staggered hex grid — so the map looks in
 * Tiled precisely as it does in game. The cell height also rescales to
 * WYSIWYG_TILE_HEIGHT so Tiled shows the game's squashed-hex proportions.
 * Object anchors mirror around the grid's full pixel height (tile-objects
 * around their hex CENTRE, hence the gid branch), sprite sizes rescale with
 * the cell height, and game-convention offsetY properties flip sign for
 * display. Already-mirrored maps pass through unchanged.
 */
/** Native sprite height of the tileset tile a gid points at, from raw JSON */
const nativeTileHeightOf = (
  map: Record<string, unknown>,
  gid: number,
): number | undefined => {
  const tilesets = Array.isArray(map.tilesets)
    ? (map.tilesets as { firstgid?: number; tiles?: Record<string, unknown>[] }[])
    : [];
  let owner: (typeof tilesets)[number] | undefined;
  for (const candidate of tilesets) {
    const firstgid = Number(candidate.firstgid) || 0;
    if (firstgid <= gid && (!owner || firstgid > (Number(owner.firstgid) || 0))) {
      owner = candidate;
    }
  }
  const tile = owner?.tiles?.find(
    (candidate) => (Number(owner?.firstgid) || 0) + (Number(candidate.id) || 0) === gid,
  );
  const imageheight = tile ? Number(tile.imageheight) : Number.NaN;
  return Number.isFinite(imageheight) ? imageheight : undefined;
};

export const toWysiwygTiledJson = (rawTiledJson: unknown): Record<string, unknown> => {
  const map = JSON.parse(JSON.stringify(rawTiledJson)) as Record<string, unknown>;
  if (map.staggerindex === "even") return map;
  const width = Number(map.width) || 0;
  const height = Number(map.height) || 0;
  const oldTileHeight = Number(map.tileheight) || TILED_TILE_HEIGHT;
  // Rescale the cell height to the game's squashed-hex proportions so Tiled
  // shows the exact aspect the game renders; every vertical pixel quantity
  // (positions, sizes) scales by the same factor
  const tileHeight = WYSIWYG_TILE_HEIGHT;
  const factor = tileHeight / oldTileHeight;
  map.tileheight = tileHeight;
  map.staggerindex = "even";
  const layers = Array.isArray(map.layers)
    ? (map.layers as Record<string, unknown>[])
    : [];
  const mirrorY = height * tileHeight + tileHeight / 2;
  for (const layer of layers) {
    if (layer.type === "tilelayer" && Array.isArray(layer.data)) {
      const data = layer.data as number[];
      const reversed: number[] = [];
      for (let row = height - 1; row >= 0; row--) {
        reversed.push(...data.slice(row * width, (row + 1) * width));
      }
      layer.data = reversed;
    }
    if (layer.type === "objectgroup" && Array.isArray(layer.objects)) {
      for (const object of layer.objects as Record<string, unknown>[]) {
        // Point objects mirror directly (they mark hex centres). Tile-objects
        // are bottom-anchored and rooted a grounding offset below their hex
        // centre, so the mirror repositions them around that centre:
        // y' = M + 2*G*H - y*factor keeps the base grounded on the mirrored
        // hex. Native-size placements (height == the tile's native sprite
        // height) keep their pixel size so the importer still applies the
        // asset default; resized ones rescale with the cell height.
        let anchorFix = 0;
        const gid = Number(object.gid);
        if (Number.isFinite(gid) && typeof object.height === "number") {
          const native = nativeTileHeightOf(map, gid);
          const isNative =
            native !== undefined && Math.abs(object.height - native) <= 1;
          const spriteScale = isNative ? 1 : object.height / oldTileHeight;
          if (!isNative) {
            const newHeight = Math.round(object.height * factor * 100) / 100;
            object.height = newHeight;
            object.width = newHeight;
          }
          anchorFix = 2 * spriteGroundingOffset(spriteScale) * tileHeight;
        }
        const scaledY = (Number(object.y) || 0) * factor;
        object.y = Math.round((mirrorY + anchorFix - scaledY) * 1000) / 1000;
        if (Array.isArray(object.properties)) {
          for (const prop of object.properties as { name: string; value: unknown }[]) {
            if (prop.name === "offsetY" && typeof prop.value === "number") {
              prop.value = -prop.value;
            }
          }
        }
      }
    }
  }
  return map;
};

export const downloadSectorForTiled = async (
  rawTiledJson: unknown,
  sector: number,
  assets: DecorationAsset[],
  terrains: Map<string, TerrainSpec>,
) => {
  // Ship the kit in the WYSIWYG convention so Tiled shows the game view
  const map = toWysiwygTiledJson(rawTiledJson);
  const tileWidth = Number(map.tilewidth) || TILED_TILE_WIDTH;
  const tileHeight = Number(map.tileheight) || TILED_TILE_HEIGHT;

  const tilesets = Array.isArray(map.tilesets)
    ? (map.tilesets as Record<string, unknown>[])
    : [];
  const terrainSet =
    tilesets.find((set) => set?.name === "terrain") ?? tilesets[0] ?? null;

  const zip = new JSZip();
  const imageName = "terrain.png";
  const tiles =
    terrainSet && Array.isArray(terrainSet.tiles)
      ? (terrainSet.tiles as TiledTile[])
      : [];
  if (terrainSet && tiles.length > 0) {
    ensureFullTerrainPalette(tiles, terrains);
    const image = buildTerrainImage(tiles, tileWidth, tileHeight, terrains);
    terrainSet.image = imageName;
    // The tileset's own tile size must match the swatch image's cell size, or
    // Tiled cannot slice the image and renders every terrain tile blank (the
    // raw map's embedded tileset carries the game-convention 56px height)
    terrainSet.tilewidth = tileWidth;
    terrainSet.tileheight = tileHeight;
    terrainSet.imagewidth = image.width;
    terrainSet.imageheight = image.height;
    terrainSet.columns = image.columns;
    terrainSet.tilecount = image.columns;
    terrainSet.margin = 0;
    terrainSet.spacing = 0;
    zip.file(imageName, image.base64, { base64: true });
  }

  // Decoration sprites: bundled images + a collection tileset + gid objects,
  // so the map is WYSIWYG in Tiled
  const { sprites, failedKeys } = await fetchDecorationSprites(assets);
  addDecorationTileset(map, tilesets, sprites, tileHeight);
  sprites.forEach((sprite) => {
    zip.file(sprite.fileName, sprite.bytes);
  });

  zip.file(`sector-${sector}.json`, JSON.stringify(map, null, 2));
  // The Tiled project (object classes + the decoration assetKey dropdown) and a
  // short how-to, so the download is a self-contained, validated editing kit.
  zip.file(
    "tnr-sectors.tiled-project",
    JSON.stringify(buildTiledProject(assets), null, 2),
  );
  zip.file("README.txt", TILED_KIT_README);
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, `sector-${sector}.zip`);
  // Sprites that stayed unreachable after retries: the kit still works, but
  // these decorations show as point markers - the caller should tell the
  // creator so they can re-download instead of authoring with a partial palette
  return { missingSprites: failedKeys };
};
