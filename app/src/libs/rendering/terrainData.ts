import type { Grid } from "honeycomb-grid";
import type { TerrainHex } from "@/libs/hexgrid";
import { type LinearColor, linearRenderColor } from "@/libs/rendering/color";
import {
  calculateHexUVCoordinates,
  calculateTileOffset,
  getHexPoints,
} from "@/libs/rendering/hexGeometry";
import {
  applyTerrainField,
  createTerrainField,
  isFlatZone,
  LAND_STEP,
  MAX_SEABED_DEPTH,
  SEABED_STEP,
  type TerrainCell,
  type TerrainField,
} from "@/libs/rendering/terrainElevation";
import { hasWorldWaterDepth, STOCK_OCEAN_DEPRESSION } from "@/libs/rendering/worldArt";
import { parseHexColor } from "@/utils/color";

/**
 * Renderer-free buffers in the grid's Y-up world units, retaining per-tile face
 * offsets for picking. Tiles stand on integer terraces: raised land shows lit
 * cliff walls and dark drop outlines, and stock water is a translucent surface
 * over a stepped seabed whose blocks darken toward deep water with depth. Every
 * piece carries a draw order so painters' order follows elevation, back to front
 * within a level. lightLayout keeps one flat, untextured, unanimated plane.
 * A window-wide terrain field keeps terraces, depth and ice continuous between
 * retained sectors; without one, stock water gets a local field over flat land.
 */
export const buildHexTerrainData = (
  grid: Grid<TerrainHex>,
  look: (tile: TerrainHex) => TerrainLook,
  lightLayout: boolean,
  field?: TerrainField,
) => {
  const materials = new Map(grid.toArray().map((tile) => [tile, look(tile)]));
  const stockWater = (tile: TerrainHex) => !!materials.get(tile)?.waterDepth;
  const terrain = lightLayout
    ? null
    : (field ??
      ([...materials.values()].some((material) => material.waterDepth)
        ? createTerrainField(
            grid,
            new Map(
              [...materials].map(([tile, material]) => [
                tile,
                { isWater: material.isWater, frost: material.frost, flat: true },
              ]),
            ),
          )
        : null));
  if (terrain) applyTerrainField(grid, terrain, stockWater);
  else for (const tile of materials.keys()) tile.frozen = false;
  const surfaceTint = linearRenderColor(WATER_SURFACE),
    sand = linearRenderColor(SEABED_SAND),
    stone = linearRenderColor(SEABED_STONE),
    deep = linearRenderColor(WATER_DEEP);
  const { points } = getHexPoints();
  const tileUVArray = calculateHexUVCoordinates(grid.toArray()[0], points);
  const surface: number[] = [],
    surfaceColors: number[] = [];
  // Every piece of terrain lands in a painter-ordered item; items merge into two meshes.
  const items = new Map<number, TerrainItem>();
  const textures: string[] = [];
  const item = (order: number) => {
    let entry = items.get(order);
    if (!entry) {
      entry = emptyItem();
      items.set(order, entry);
    }
    return entry;
  };
  const slotOf = (texture: string | null) => {
    if (!texture) return 0;
    let index = textures.indexOf(texture);
    if (index < 0) index = textures.push(texture) - 1;
    return index + 1;
  };
  const piece = (order: number): Painter => {
    const target = item(order);
    return (x, y, color, alpha) =>
      pushVertex(target, x, y, 0, 0, color, alpha, KIND.flat, 0, -1, 0, 0);
  };
  const faceOffsets = new Map<string, number>();
  // Each tile's walkable face and solid top (its seabed when under stock water).
  const tops = new Map<TerrainHex, TileTop>();
  let animatedTiles = 0;
  for (const [tile, material] of materials) {
    const { length, offsetLength } = calculateTileOffset(
      tile.corners,
      material.depression,
      lightLayout,
    );
    const terrace = lightLayout ? 0 : (tile.terrace ?? 0);
    const land = !material.isWater && terrace > 0 ? terrace : 0;
    const face = offsetLength + land * LAND_STEP * tile.height;
    const stock = !lightLayout && !!material.waterDepth;
    const depth = stock ? Math.max(1, Math.min(MAX_SEABED_DEPTH, -terrace)) : 0;
    const solid = stock ? face - depth * SEABED_STEP * tile.height : face;
    tops.set(tile, { face, solid, length, land, depth, material });
    faceOffsets.set(`${tile.col},${tile.row}`, face);
    const layer = face < 0 ? -0.5 : land;
    const kind = lightLayout
      ? KIND.solid
      : stock
        ? KIND.water
        : material.texture
          ? KIND.image
          : KIND.noise;
    const slot = lightLayout || stock ? 0 : slotOf(material.texture);
    const batch = item(stock ? WATER_SURFACE_ORDER : faceOrder(layer));
    const linear = linearRenderColor(material.color);
    if (!parseHexColor(material.color))
      throw new Error(`Invalid terrain color ${material.color}`);
    const wave = lightLayout ? -1 : stock ? 0 : material.waveOffset;
    if (wave >= 0) animatedTiles++;
    batch.tiles.push({
      key: `${tile.col},${tile.row}`,
      start: batch.positions.length / 2,
      count: points.length,
    });
    // Higher plateaus catch slightly more light, so stacked terraces separate at a glance.
    const lift = 1 + land * 0.035;
    points.forEach((corner, index) => {
      const point = tile.corners[corner];
      if (!point) return;
      const shade = material.groundShade?.(point) ?? 0;
      const sample = stock ? terrain?.sample(point) : undefined;
      const color = stock
        ? surfaceTint
        : shade > 0 && material.groundColor
          ? mix(linear, material.groundColor, shade, lift)
          : mix(linear, linear, 0, (1 - shade * 0.2) * lift);
      pushVertex(
        batch,
        point.x,
        point.y + face,
        stock ? point.x / (tile.height * 4) : (tileUVArray?.[index * 2] ?? 0),
        stock ? point.y / (tile.height * 4) : (tileUVArray?.[index * 2 + 1] ?? 0),
        color,
        1,
        kind,
        slot,
        wave,
        sample?.depth ?? 0,
        sample?.frozen ?? 0,
      );
    });
    if (!stock) continue;
    // The seabed block: sand darkening toward deep water in proportion to its depth.
    const fade = Math.min(1, depth * DEPTH_FADE);
    const variation = 0.96 + tile.level * 0.08;
    // Icy basins have cold stone beds, so clear ice reads blue rather than sandy.
    const seabed = mix(tile.frozen ? stone : sand, deep, fade, variation);
    const floor = item(seabedOrder(depth) + 0.02);
    points.forEach((corner, index) => {
      const point = tile.corners[corner];
      if (!point) return;
      pushVertex(
        floor,
        point.x,
        point.y + solid,
        tileUVArray?.[index * 2] ?? 0,
        tileUVArray?.[index * 2 + 1] ?? 0,
        seabed,
        1,
        KIND.seabed,
        0,
        -1,
        depth / MAX_SEABED_DEPTH,
        tile.frozen ? 1 : 0,
      );
    });
    if (!tile.frozen && !material.frost)
      appendSeagrass(piece(seabedOrder(depth) + 0.04), tile, solid, depth, deep);
  }
  const floor =
    Math.min(...[...tops.values()].map((top) => top.solid)) -
    ([...tops.values()][0]?.length ?? 0);
  // Pair every hex edge with its neighbour to raise walls, outlines, shores and joins.
  const shared = new Map<
    string,
    { tile: TerrainHex; a: { x: number; y: number }; b: { x: number; y: number } }[]
  >();
  for (const tile of materials.keys())
    tile.corners.forEach((a, index) => {
      const b = tile.corners[(index + 1) % tile.corners.length];
      if (!b) return;
      const key = [a, b]
        .map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`)
        .sort()
        .join(":");
      const list = shared.get(key) ?? [];
      list.push({ tile, a, b });
      shared.set(key, list);
    });
  const boundary: number[] = [];
  const gridLine = linearRenderColor(GRID_LINE);
  for (const sides of shared.values()) {
    const [first, second] = sides;
    if (!first) continue;
    // A faint hex grid on the higher face of every edge, drawn once per edge.
    const upper =
      second && (tops.get(second.tile)?.face ?? 0) > (tops.get(first.tile)?.face ?? 0)
        ? second
        : first;
    const upperTop = tops.get(upper.tile);
    if (upperTop) {
      const layer = upperTop.face < 0 ? -0.5 : upperTop.land;
      appendLine(
        piece(faceOrder(layer) + 0.045),
        upper.a,
        upper.b,
        upperTop.face,
        gridLine,
        0.03,
      );
    }
    if (!second) {
      const top = tops.get(first.tile);
      if (!top) continue;
      boundary.push(first.a.x, first.a.y + top.face, first.b.x, first.b.y + top.face);
      const middle = (first.a.y + first.b.y) / 2;
      if (lightLayout || middle >= first.tile.y) continue;
      // Across a sector border the window field knows the neighbouring tile, so the real drop is drawn.
      const across = terrain?.at({
        x: first.a.x + first.b.x - first.tile.x,
        y: first.a.y + first.b.y - first.tile.y,
      });
      if (across) {
        appendDrops(
          first,
          first,
          top,
          neighbourTop(first.tile, top, across),
          piece,
          sand,
          deep,
        );
        continue;
      }
      // The rim shows the cut through land, seabed and water like a diorama. It paints beneath
      // every sector's terrain, so at a border the neighbouring sector covers it.
      appendWall(
        piece(RIM_ORDER),
        first,
        top.solid,
        floor,
        top.material.waterDepth
          ? mix(sand, deep, Math.min(1, top.depth * DEPTH_FADE), 0.7)
          : cliffColor(top.material),
      );
      if (top.material.waterDepth)
        appendWall(
          piece(RIM_ORDER + 0.1),
          first,
          top.face,
          top.solid,
          mix(surfaceTint, deep, 0.55, 0.9),
        );
      continue;
    }
    const one = tops.get(first.tile),
      two = tops.get(second.tile);
    if (!one || !two) continue;
    const [back, front] =
      first.tile.y > second.tile.y ? [first, second] : [second, first];
    const high = tops.get(back.tile),
      low = tops.get(front.tile);
    if (!high || !low) continue;
    if (!lightLayout) {
      appendDrops(back, front, high, low, piece, sand, deep);
      appendJoins(first, one, second, two, surface, surfaceColors);
    }
  }
  const ordered = [...items].sort(([a], [b]) => a - b);
  return {
    // The rim paints first, then underwater, then the water surface and banks; land, cliffs and outlines follow.
    segments: [
      mergeItems(
        RIM_SEGMENT,
        ordered.filter(([order]) => order < UNDERWATER_FROM),
      ),
      mergeItems(
        UNDERWATER_SEGMENT,
        ordered.filter(([order]) => order >= UNDERWATER_FROM && order < SURFACE_FROM),
      ),
      mergeItems(
        SURFACE_SEGMENT,
        ordered.filter(([order]) => order >= SURFACE_FROM && order < LAND_FROM),
      ),
      mergeItems(
        LAND_SEGMENT,
        ordered.filter(([order]) => order >= LAND_FROM),
      ),
    ].filter((segment) => segment.positions.length > 0),
    textures,
    surface: new Float32Array(surface),
    surfaceColors: new Float32Array(surfaceColors),
    boundary: new Float32Array(boundary),
    faceOffsets,
    animatedTiles,
  };
};

/** Draw order of the faces on one terrace; recessed faces sit below land and its cliffs. */
const faceOrder = (layer: number) => (layer < 0 ? 2 : 4 + layer * 0.1);
const wallOrder = (land: number) => (land > 0 ? 3.95 + land * 0.1 : 2.65);
/** Deeper seabed terraces paint first, so shallower blocks in front overlap them. */
const seabedOrder = (depth: number) => 1 + (MAX_SEABED_DEPTH - depth) * 0.1;
const WATER_SURFACE_ORDER = 2.6;
const UNDERWATER_WALL_ORDER = 1.55;
const DEPTH_FADE = 0.19;

type TileTop = {
  face: number;
  solid: number;
  length: number;
  land: number;
  depth: number;
  material: TerrainLook;
};
type TileEdge = {
  tile: TerrainHex;
  a: { x: number; y: number };
  b: { x: number; y: number };
};
/** Appends one vertex of a flat-coloured piece: walls, outlines and seabed flora. */
type Painter = (x: number, y: number, color: LinearColor, alpha: number) => void;

/** Per-vertex material kinds read by the terrain shader. */
export const KIND = {
  solid: 0,
  noise: 1,
  image: 2,
  water: 3,
  seabed: 4,
  flat: 5,
  grain: 6,
} as const;
/**
 * Segment draw orders: the rim, then everything below the water surface, then the
 * surface with its pads and banks, then land. Each layer of every sector paints before
 * the next layer of any sector, so a seabed step hanging across a sector border sits
 * under the neighbour's water and rims only show at the window's outer edge.
 */
const RIM_SEGMENT = 1;
const UNDERWATER_SEGMENT = 2;
const SURFACE_SEGMENT = 2.6;
export const LAND_SEGMENT = 4;
const RIM_ORDER = 0.5;
const UNDERWATER_FROM = 1;
const SURFACE_FROM = 2.6;
const LAND_FROM = 3;
const GRID_LINE = "#324b36";
/** World-unit width of drawn outlines: one scenery pixel. */
const LINE_WIDTH = 0.75;

type TerrainItem = {
  positions: number[];
  uvs: number[];
  colors: number[];
  kinds: number[];
  slots: number[];
  waves: number[];
  relief: number[];
  tiles: { key: string; start: number; count: number }[];
};

const emptyItem = (): TerrainItem => ({
  positions: [],
  uvs: [],
  colors: [],
  kinds: [],
  slots: [],
  waves: [],
  relief: [],
  tiles: [],
});

const pushVertex = (
  target: TerrainItem,
  x: number,
  y: number,
  u: number,
  v: number,
  color: LinearColor,
  alpha: number,
  kind: number,
  slot: number,
  wave: number,
  depth: number,
  frozen: number,
) => {
  target.positions.push(x, y);
  target.uvs.push(u, v);
  target.colors.push(color.r, color.g, color.b, alpha);
  target.kinds.push(kind);
  target.slots.push(slot);
  target.waves.push(wave);
  target.relief.push(depth, frozen);
};

/** A segment with no vertices, for geometry added after the terrain is built. */
export const emptySegment = (order: number) => mergeItems(order, []);

/** Concatenates painter-ordered items into one vertex stream, rebasing tile ranges. */
const mergeItems = (order: number, entries: [number, TerrainItem][]) => {
  // Each stream is sized once and copied into directly; vertex counts reach the hundreds of thousands.
  const merged = (key: Exclude<keyof TerrainItem, "tiles">) => {
    const values = new Float32Array(
      entries.reduce((total, [, entry]) => total + entry[key].length, 0),
    );
    let offset = 0;
    for (const [, entry] of entries) {
      // Streams are built by push, so they hold no holes for a native copy to read as NaN.
      values.set(entry[key], offset);
      offset += entry[key].length;
    }
    return values;
  };
  const tiles: TerrainItem["tiles"] = [];
  let base = 0;
  for (const [, entry] of entries) {
    for (const tile of entry.tiles) tiles.push({ ...tile, start: tile.start + base });
    base += entry.positions.length / 2;
  }
  return {
    order,
    positions: merged("positions"),
    uvs: merged("uvs"),
    colors: merged("colors"),
    kinds: merged("kinds"),
    slots: merged("slots"),
    waves: merged("waves"),
    relief: merged("relief"),
    tiles,
  };
};

const mix = (a: LinearColor, b: LinearColor, t: number, scale = 1): LinearColor => ({
  r: (a.r * (1 - t) + b.r * t) * scale,
  g: (a.g * (1 - t) + b.g * t) * scale,
  b: (a.b * (1 - t) + b.b * t) * scale,
});

/**
 * The solid top of a tile in a neighbouring sector, from its field cell and the stock
 * materials: recessed stock water over its seabed, or land on its terrace.
 */
const neighbourTop = (
  tile: TerrainHex,
  own: TileTop,
  across: { water: boolean; level: number },
): TileTop => {
  const material = {
    ...own.material,
    isWater: across.water,
    waterDepth: across.water,
    frost: undefined,
  };
  if (!across.water) {
    const land = Math.max(0, across.level);
    const face = land * LAND_STEP * tile.height;
    return { ...own, face, solid: face, land, depth: 0, material };
  }
  const depth = Math.max(1, Math.min(MAX_SEABED_DEPTH, -across.level));
  const face = -own.length * STOCK_OCEAN_DEPRESSION;
  return {
    ...own,
    face,
    solid: face - depth * SEABED_STEP * tile.height,
    land: 0,
    depth,
    material,
  };
};

/** Earthy rock for temperate cliffs; frost keeps a cold grey face and sand stays sandy. */
const cliffColor = (material: TerrainLook) => {
  const own = linearRenderColor(material.color);
  return material.frost
    ? mix(own, linearRenderColor("#7d8c95"), 0.5, 0.85)
    : material.isRoad
      ? mix(own, linearRenderColor(CLIFF_DIRT), 0.5, 0.75)
      : mix(own, linearRenderColor(CLIFF_DIRT), 0.6, 0.8);
};

/**
 * A vertical face from top down to bottom along one hex edge. Faces turned toward
 * the upper-left light are brighter, and every face darkens toward its foot.
 */
const appendWall = (
  paint: Painter,
  edge: TileEdge,
  top: number,
  bottom: number,
  color: LinearColor,
) => {
  if (top - bottom < 1e-4) return;
  const { a, b } = edge;
  const normal = (a.x + b.x) / 2 - edge.tile.x;
  const facing = 1 - Math.sign(normal) * 0.14 * Math.min(1, Math.abs(normal) / 10);
  const upper = mix(color, color, 0, facing * 1.05),
    lower = mix(color, color, 0, facing * 0.82);
  const quad = [
    [a.x, a.y + top, upper],
    [b.x, b.y + top, upper],
    [b.x, b.y + bottom, lower],
    [a.x, a.y + bottom, lower],
  ] as const;
  for (const index of [0, 1, 2, 0, 2, 3] as const) {
    const [x, y, tint] = quad[index];
    paint(x, y, tint, 1);
  }
};

/** A one-pixel band along an edge, so outlines share the terrain's single draw. */
const appendLine = (
  paint: Painter,
  a: { x: number; y: number },
  b: { x: number; y: number },
  offset: number,
  color: LinearColor,
  alpha: number,
) => {
  const half = LINE_WIDTH / 2;
  const quad = [
    [a.x, a.y + offset + half],
    [b.x, b.y + offset + half],
    [b.x, b.y + offset - half],
    [a.x, a.y + offset - half],
  ] as const;
  for (const index of [0, 1, 2, 0, 2, 3] as const)
    paint(quad[index][0], quad[index][1], color, alpha);
};

/**
 * Where the back tile stands higher, its front edge drops as a cliff, split at the
 * water surface so the submerged part is seen through the water. Each drop is traced
 * by a dark outline on the higher face, and tall cliffs show a stratum per terrace.
 */
const appendDrops = (
  back: TileEdge,
  front: TileEdge,
  high: TileTop,
  low: TileTop,
  piece: (order: number) => Painter,
  sand: LinearColor,
  deep: LinearColor,
) => {
  const ink = linearRenderColor(DROP_OUTLINE);
  if (high.solid > low.solid) {
    const backWater = !!high.material.waterDepth;
    const frontWater = !!low.material.waterDepth;
    const step = back.tile.height * (backWater ? SEABED_STEP : LAND_STEP);
    if (backWater) {
      const color = mix(sand, deep, Math.min(1, high.depth * DEPTH_FADE), 0.6);
      appendWall(piece(seabedOrder(high.depth)), back, high.solid, low.solid, color);
      appendLine(
        piece(seabedOrder(high.depth) + 0.05),
        back.a,
        back.b,
        high.solid,
        ink,
        0.3,
      );
    } else {
      const cliff = cliffColor(high.material);
      const surface = frontWater ? low.face : low.solid;
      appendWall(piece(wallOrder(high.land)), back, high.solid, surface, cliff);
      if (frontWater) {
        const submerged = mix(cliff, deep, Math.min(1, low.depth * DEPTH_FADE), 0.85);
        appendWall(piece(UNDERWATER_WALL_ORDER), back, surface, low.solid, submerged);
      }
      for (let level = 1; high.solid - level * step > surface + 1e-4; level++)
        appendLine(
          piece(wallOrder(high.land) + 0.01),
          back.a,
          back.b,
          high.solid - level * step,
          ink,
          0.16,
        );
      appendLine(
        piece(faceOrder(high.land) + 0.04),
        back.a,
        back.b,
        high.solid,
        ink,
        0.5,
      );
    }
  } else if (low.solid > high.solid) {
    // A higher block in front shows its back rim against the lower ground behind it.
    const order = low.material.waterDepth
      ? seabedOrder(low.depth) + 0.05
      : faceOrder(low.land) + 0.04;
    appendLine(
      piece(order),
      front.a,
      front.b,
      low.solid,
      ink,
      low.material.waterDepth ? 0.18 : 0.35,
    );
  }
};

/** Shore lines, lily pads, road shoulders and frost drifts where two materials meet. */
const appendJoins = (
  first: TileEdge,
  one: TileTop,
  second: TileEdge,
  two: TileTop,
  surface: number[],
  surfaceColors: number[],
) => {
  const { a, b } = first;
  if (!!one.material.isWater !== !!two.material.isWater) {
    const [water, coast] = one.material.isWater ? [first, two] : [second, one];
    const top = one.material.isWater ? one : two;
    appendShoreline(
      surface,
      surfaceColors,
      a,
      b,
      water.tile,
      top.face,
      !!water.tile.frozen,
    );
    if (top.material.waterDepth && !water.tile.frozen && !coast.material.frost)
      appendLilyPads(surface, surfaceColors, water.tile, top.face, a, b);
  }
  if (
    !!one.material.isRoad !== !!two.material.isRoad &&
    one.face === 0 &&
    two.face === 0
  ) {
    const [road, grass] = one.material.isRoad ? [first, two] : [second, one];
    appendPathShoulder(surface, surfaceColors, a, b, road.tile, grass.material.color);
  }
  if (
    one.material.frost &&
    two.material.frost &&
    one.material.frost !== two.material.frost &&
    one.face === two.face &&
    one.face >= 0
  ) {
    const [ice, snow] = one.material.frost === "ice" ? [first, two] : [second, one];
    appendPathShoulder(
      surface,
      surfaceColors,
      a,
      b,
      ice.tile,
      snow.material.color,
      4,
      1.5,
      one.face,
    );
  }
};

/** Deterministic per-tile hash in [0, 1) for scattering details without consuming the sector PRNG. */
const tileHash = (tile: TerrainHex, salt: number) => {
  let value = Math.imul(
    (tile.col * 73856093) ^ (tile.row * 19349663) ^ salt,
    0x5bd1e995,
  );
  value ^= value >>> 13;
  value = Math.imul(value, 0x5bd1e995);
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
};

/** Seagrass on shallow sand and kelp in deeper water, tinted toward the deep like the seabed. */
const appendSeagrass = (
  paint: Painter,
  tile: TerrainHex,
  offset: number,
  depth: number,
  deep: LinearColor,
) => {
  if (depth >= MAX_SEABED_DEPTH) return;
  const kelp = depth >= 3;
  const clumps = Math.floor(tileHash(tile, 1) * (kelp ? 2.5 : 4));
  const color = mix(
    linearRenderColor(kelp ? "#5c7a44" : "#78a052"),
    deep,
    Math.min(1, depth * DEPTH_FADE),
  );
  for (let clump = 0; clump < clumps; clump++) {
    const angle = tileHash(tile, 10 + clump) * Math.PI * 2;
    const radius = 0.25 + tileHash(tile, 20 + clump) * 0.45;
    const x = snap(tile.x + Math.cos(angle) * radius * tile.width * 0.32);
    const y = snap(
      tile.y + offset - Math.abs(Math.sin(angle)) * radius * tile.height * 0.3,
    );
    const blades = 2 + Math.floor(tileHash(tile, 30 + clump) * 2);
    for (let blade = 0; blade < blades; blade++) {
      const height = snap(
        (kelp ? 3 : 1.5) + tileHash(tile, 40 + clump * 3 + blade) * 2.25,
      );
      const left = x + (blade - (blades - 1) / 2) * 1.5,
        lean = (blade - (blades - 1) / 2) * 0.75;
      const shade = mix(color, color, 0, blade % 2 ? 0.85 : 1);
      const quad = [
        [left, y],
        [left + 0.75, y],
        [left + 0.75 + lean, y + height],
        [left + lean, y + height],
      ] as const;
      for (const index of [0, 1, 2, 0, 2, 3] as const)
        paint(quad[index][0], quad[index][1], shade, 1);
    }
  }
};

/** Lily pads drift on calm shallow water along temperate shores. */
const appendLilyPads = (
  positions: number[],
  colors: number[],
  tile: TerrainHex,
  offset: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
) => {
  const seed = Math.abs(Math.round(a.x * 7 + a.y * 13 + b.x * 3 + b.y));
  if (tileHash(tile, seed) > 0.32) return;
  const pad = linearRenderColor("#6d9a4b"),
    rim = linearRenderColor("#4d7536"),
    bloom = linearRenderColor("#e7b6c9");
  const t = 0.3 + tileHash(tile, seed + 1) * 0.4;
  const inward = 0.22 + tileHash(tile, seed + 2) * 0.18;
  const cx = snap(a.x + (b.x - a.x) * t + (tile.x - (a.x + b.x) / 2) * inward);
  const cy = snap(a.y + (b.y - a.y) * t + (tile.y - (a.y + b.y) / 2) * inward + offset);
  const rx = 2.25 + tileHash(tile, seed + 3) * 1.5,
    ry = rx * 0.5;
  const notch = Math.floor(tileHash(tile, seed + 4) * 8);
  for (let side = 0; side < 8; side++) {
    if (side === notch) continue;
    const from = (side / 8) * Math.PI * 2,
      to = ((side + 1) / 8) * Math.PI * 2;
    const color = side >= 4 ? rim : pad;
    for (const [x, y] of [
      [cx, cy],
      [cx + Math.cos(from) * rx, cy + Math.sin(from) * ry],
      [cx + Math.cos(to) * rx, cy + Math.sin(to) * ry],
    ] as const) {
      positions.push(snap(x), snap(y));
      colors.push(color.r, color.g, color.b);
    }
  }
  if (tileHash(tile, seed + 5) < 0.3)
    for (const [x, y] of [
      [cx, cy],
      [cx + 1.5, cy],
      [cx + 1.5, cy + 0.75],
      [cx, cy],
      [cx + 1.5, cy + 0.75],
      [cx, cy + 0.75],
    ] as const) {
      positions.push(x, y);
      colors.push(bloom.r, bloom.g, bloom.b);
    }
};

const snap = (value: number) => Math.round(value / 0.75) * 0.75;

/**
 * A sector tile as the terrain field sees it. Only the stock ocean has a seabed; any other
 * water is drawn as a flat surface, so the field holds it level instead of sinking it.
 */
export const sectorFieldCell = (
  tile: TerrainHex,
  options: {
    settled: boolean;
    footprints: ReadonlySet<TerrainHex>;
    relief: (col: number, row: number) => number;
  },
): TerrainCell => {
  const seabed = hasWorldWaterDepth(tile.spec);
  return {
    isWater: seabed,
    frost: terrainFrost(tile.spec?.key ?? ""),
    flat:
      options.settled ||
      !!tile.hasStructure ||
      isFlatZone(tile.zone) ||
      options.footprints.has(tile) ||
      (!seabed && !!tile.spec?.isWater),
    relief: options.relief(tile.col, tile.row),
  };
};

/** Frost class of a stock terrain key; snow and ice coasts freeze their stock water. */
export const terrainFrost = (key: string): TerrainLook["frost"] =>
  key === "ice" ? "ice" : key === "snow" ? "snow" : undefined;

/** Picks an inclusive recessed face in grid-local Y-up units; misses return null. */
export const hexTerrainAt = (
  grid: Grid<TerrainHex>,
  offsets: ReadonlyMap<string, number>,
  x: number,
  y: number,
) => {
  const nearest = grid.pointToHex({ x, y }, { allowOutside: true });
  if (!nearest) return null;
  const candidates: TerrainHex[] = [];
  for (let col = nearest.col - 1; col <= nearest.col + 1; col++)
    for (let row = nearest.row - 1; row <= nearest.row + 1; row++) {
      const tile = grid.getHex({ col, row });
      if (tile) candidates.push(tile);
    }
  candidates.sort(
    (a, b) =>
      (offsets.get(`${b.col},${b.row}`) ?? 0) - (offsets.get(`${a.col},${a.row}`) ?? 0),
  );
  for (const tile of candidates) {
    const dy = offsets.get(`${tile.col},${tile.row}`) ?? 0;
    const corners = tile.corners;
    let sign = 0,
      inside = true;
    for (let index = 0; index < corners.length; index++) {
      const a = corners[index],
        b = corners[(index + 1) % corners.length];
      if (!a || !b) continue;
      const cross = (b.x - a.x) * (y - a.y - dy) - (b.y - a.y) * (x - a.x);
      if (Math.abs(cross) < 1e-7) continue;
      const next = Math.sign(cross);
      if (sign !== 0 && sign !== next) {
        inside = false;
        break;
      }
      sign = next;
    }
    if (inside) return tile;
  }
  return null;
};

export type TerrainLook = {
  color: string;
  texture: string | null;
  waveOffset: number;
  depression: number;
  isRoad?: boolean;
  isWater?: boolean;
  /** Stock coastal water uses a shore-connected shallow shelf with shared, continuous vertex colors. */
  waterDepth?: boolean;
  /** Static canopy/clearing field sampled at shared vertices; the authored material and navigation stay intact. */
  groundShade?: (point: { x: number; y: number }) => number;
  /** Warm leaf-earth material blended through the canopy field. */
  groundColor?: LinearColor;
  /** Flat snow/ice joins use grouped drifts rather than elevated foundation rims; icy coasts freeze stock water. */
  frost?: "snow" | "ice";
};

/** Stock water palette in display sRGB: a translucent surface over sand that fades toward the deep. */
const WATER_SURFACE = "#3a9c9b";
const SEABED_SAND = "#d3c58f";
const SEABED_STONE = "#7f98a2";
const WATER_DEEP = "#11304a";
const CLIFF_DIRT = "#6b5842";
const DROP_OUTLINE = "#1b2618";

/** A shallow two-tone tidal edge grounds island foundations in the same static surface batch. */
const appendShoreline = (
  positions: number[],
  colors: number[],
  a: { x: number; y: number },
  b: { x: number; y: number },
  water: { x: number; y: number },
  offset: number,
  frozen: boolean,
) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy);
  const direction =
    (water.x - (a.x + b.x) / 2) * -dy + (water.y - (a.y + b.y) / 2) * dx > 0 ? 1 : -1;
  const nx = (-dy / length) * direction,
    ny = (dx / length) * direction;
  // Frozen coasts trade the tidal line for a packed-snow lip on the ice.
  for (const [near, far, tint] of frozen
    ? ([
        [0, 0.75, "#e6eff0"],
        [0.75, 2.5, "#c7dadf"],
      ] as const)
    : ([
        [0, 0.75, "#9fb8ad"],
        [0.75, 2.5, "#6b918b"],
      ] as const)) {
    const color = linearRenderColor(tint);
    const count = near === 0 ? 4 : 1;
    for (let segment = 0; segment < count; segment++) {
      if (near === 0 && (Math.round(a.x + a.y) + segment) % 3 === 0) continue;
      const start = segment / count,
        end = (segment + (near === 0 ? 0.7 : 1)) / count;
      const ax = a.x + dx * start,
        ay = a.y + dy * start + offset,
        bx = a.x + dx * end,
        by = a.y + dy * end + offset;
      const quad = [
        [ax + nx * near, ay + ny * near],
        [bx + nx * near, by + ny * near],
        [bx + nx * far, by + ny * far],
        [ax + nx * far, ay + ny * far],
      ];
      for (const index of [0, 1, 2, 0, 2, 3]) {
        const point = quad[index];
        if (!point) continue;
        positions.push(...point);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
};

/** Static pixel clumps break road shoulders without changing the navigable hex faces. */
export const appendPathShoulder = (
  positions: number[],
  colors: number[],
  a: { x: number; y: number },
  b: { x: number; y: number },
  center: { x: number; y: number },
  grass: string,
  depth = 2.8,
  step = 1.5,
  offset = 0,
) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy);
  const direction =
    (center.x - (a.x + b.x) / 2) * -dy + (center.y - (a.y + b.y) / 2) * dx > 0 ? 1 : -1;
  const color = linearRenderColor(grass);
  const count = Math.ceil(length / 2);
  for (let index = 0; index < count; index++) {
    const t = (index + 0.5) / count;
    const seed = Math.abs(index * 13 + Math.round(a.x * 3 + a.y)) % 7;
    const inset = (seed / 7) * depth - 0.5;
    const x =
      Math.round((a.x + dx * t - (dy / length) * inset * direction) / step) * step;
    const y =
      Math.round((a.y + dy * t + (dx / length) * inset * direction) / step) * step +
      offset;
    const size = seed % 3 === 0 ? step * 2 : step;
    positions.push(
      x,
      y,
      x + size,
      y,
      x + size,
      y + step,
      x,
      y,
      x + size,
      y + step,
      x,
      y + step,
    );
    for (let vertex = 0; vertex < 6; vertex++) colors.push(color.r, color.g, color.b);
  }
};
export type HexTerrainData = ReturnType<typeof buildHexTerrainData>;
