import type { Grid } from "honeycomb-grid";
import type { TerrainHex } from "@/libs/hexgrid";
import { linearRenderColor } from "@/libs/rendering/color";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import { appendPathShoulder, buildHexTerrainData } from "@/libs/rendering/terrainData";
import { getVillageRoadLayout } from "@/libs/rendering/villageLandscape";
import {
  hasWorldWaterDepth,
  resolveWorldTerrain,
  VILLAGE_ART,
} from "@/libs/rendering/worldArt";
import {
  getWorldForecourtPoint,
  getWorldForecourtSize,
} from "@/libs/rendering/worldStructures";
import {
  getVillageWallFoundationKeys,
  type VillageWallPlan,
} from "@/libs/sector-map/village-walls";

/** Requires resolved tile specs; records tile.asset and consumes the sector PRNG for water phases. */
export const buildSectorTerrainData = (
  grid: Grid<TerrainHex>,
  prng: () => number,
  lightLayout: boolean,
  options: {
    sprites?: WorldSpriteDescription[];
    wall?: VillageWallPlan | null;
    roads?: ReadonlySet<string>;
    sector?: number;
    waterDepthAt?: (point: { x: number; y: number }) => number;
  } = {},
) => {
  const roadColors = VILLAGE_ART[options.sector ?? -1]?.roads ?? ROAD_COLORS;
  const understory =
    VILLAGE_ART[options.sector ?? -1]?.understory?.map(linearRenderColor);
  const groundShade =
    understory && !lightLayout
      ? createGroveShade(grid, options.sprites ?? [])
      : undefined;
  const data = buildHexTerrainData(
    grid,
    (tile) => {
      const authoredSpec = tile.spec;
      const spec = authoredSpec ? resolveWorldTerrain(authoredSpec) : undefined;
      if (!spec) throw new Error("Sector terrain must be resolved before drawing");
      tile.asset = spec.key;
      const shore =
        tile.authored?.terrain === "dessert" && tile.authored.decoration === false;
      const colors = shore ? SHORE_COLORS : spec.colors;
      // Dense terrain keeps its authored shade independently of walkability.
      const isDenseTerrain =
        !tile.hasStructure && (tile.authored?.blocked || tile.authored?.walkCost === 0);
      const variant = shore
        ? tile.level < 0.4
          ? 0
          : tile.level < 0.7
            ? 1
            : 2
        : isDenseTerrain && !spec.isWater
          ? 2
          : tile.level < 0.5
            ? 0
            : 1;
      return {
        color: colors[variant] ?? colors[0],
        texture: shore ? null : spec.textureUrl,
        waveOffset:
          spec.isWater && !lightLayout ? (Math.floor(prng() * 8) * Math.PI) / 4 : -1,
        depression: spec.depression,
        isWater: spec.isWater,
        waterDepth: hasWorldWaterDepth(authoredSpec),
        groundShade:
          !shore && spec.key === "ground" && spec !== authoredSpec
            ? groundShade
            : undefined,
        groundColor: understory?.[variant],
        frost: spec.key === "ice" ? "ice" : spec.key === "snow" ? "snow" : undefined,
      };
    },
    lightLayout,
    options.waterDepthAt,
  );
  const positions: number[] = [],
    colors: number[] = [];
  const roads = grid
    .toArray()
    .filter((tile) =>
      options.roads
        ? options.roads.has(`${tile.col},${tile.row}`)
        : tile.authored?.zone === "road",
    );
  const foundations = options.wall
    ? getVillageWallFoundationKeys(options.wall)
    : new Set<string>();
  // Civic paving stays within the enclosure, including when a court reaches a corner.
  const courtExclusions = new Set(foundations);
  if (options.wall?.interior.length) {
    const interior = new Set(
      options.wall.interior.map((point) => `${point.x},${point.y}`),
    );
    for (const tile of grid) {
      const key = `${tile.col},${tile.row}`;
      if (!interior.has(key)) courtExclusions.add(key);
    }
  }
  const roadKeys = new Set(roads.map((tile) => `${tile.col},${tile.row}`));
  const roadLayout = getVillageRoadLayout(grid, roadKeys);
  const precincts = (options.sprites ?? []).filter(
    (sprite) => sprite.entrance?.hasCourt && sprite.entrance.hasPrecinct,
  );
  for (const sprite of lightLayout ? [] : precincts)
    if (sprite.entrance)
      appendForecourt(
        positions,
        colors,
        grid,
        courtExclusions,
        sprite.entrance,
        VILLAGE_ART[options.sector ?? -1]?.court ?? roadColors,
        "base",
      );
  // Dense authored maps can exceed the engine's argument limit for array spreads.
  for (const value of data.surface) positions.push(value);
  for (const value of data.surfaceColors) colors.push(value);
  // Small rounded junctions join ribbons without painting the underlying hex faces.
  for (const node of roadLayout.nodes) {
    const radius = node.tile.width * (node.bridge ? 0.18 : 0.16);
    const color = linearRenderColor(node.bridge ? "#9c8256" : roadColors[1]);
    const sides = node.bridge ? 4 : 8;
    for (let side = 0; side < sides; side++) {
      const a = (side * Math.PI * 2) / sides,
        b = ((side + 1) * Math.PI * 2) / sides;
      for (const [x, y] of [
        [node.x, node.y],
        [node.x + Math.cos(a) * radius, node.y + Math.sin(a) * radius * 0.5],
        [node.x + Math.cos(b) * radius, node.y + Math.sin(b) * radius * 0.5],
      ] as const) {
        positions.push(Math.round(x / 0.75) * 0.75, Math.round(y / 0.75) * 0.75);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  for (const { a: tile, b: neighbor, bridge, halfWidth } of roadLayout.segments) {
    const dx = neighbor.x - tile.x,
      dy = (neighbor.y - tile.y) * 2,
      length = Math.hypot(dx, dy);
    const px = (-dy / length) * halfWidth,
      py = (dx / length) * halfWidth * 0.5;
    const quad = [
      [tile.x - px, tile.y - py],
      [tile.x + px, tile.y + py],
      [neighbor.x + px, neighbor.y + py],
      [neighbor.x - px, neighbor.y - py],
    ] as const;
    const color = linearRenderColor(bridge ? "#9c8256" : roadColors[1]);
    for (const index of [0, 1, 2, 0, 2, 3] as const) {
      const point = quad[index];
      positions.push(...point.map((value) => Math.round(value / 0.75) * 0.75));
      colors.push(color.r, color.g, color.b);
    }
    if (bridge) {
      const planks = Math.ceil(length / 4),
        grain = linearRenderColor("#77674e");
      // Transverse joints make crossings readable while animated water remains visible beside them.
      for (let plank = 1; plank < planks; plank++) {
        const t = plank / planks,
          x = tile.x + dx * t,
          y = tile.y + (neighbor.y - tile.y) * t;
        const joint = [
          [x - px, y - py],
          [x + px, y + py],
          [x + px + (dx / length) * 0.7, y + py + (dy / length) * 0.35],
          [x - px + (dx / length) * 0.7, y - py + (dy / length) * 0.35],
        ] as const;
        for (const index of [0, 1, 2, 0, 2, 3] as const) {
          positions.push(...joint[index]);
          colors.push(grain.r, grain.g, grain.b);
        }
      }
    } else {
      // Sparse paired gravel pixels give the path material detail without extra textures or draw calls.
      const marks = Math.ceil(length / 7);
      for (let mark = 0; mark < marks; mark++) {
        const seed = Math.abs(tile.tile.col * 37 + tile.tile.row * 17 + mark * 13) % 11;
        const t = (mark + 0.5) / marks,
          shift = (seed / 10 - 0.5) * halfWidth;
        const x = Math.round((tile.x + dx * t - (dy / length) * shift) / 0.75) * 0.75,
          y =
            Math.round(
              (tile.y + (neighbor.y - tile.y) * t + (dx / length) * shift * 0.5) / 0.75,
            ) * 0.75;
        const tint = linearRenderColor(roadColors[seed % 2 ? 0 : 2]);
        positions.push(
          x,
          y,
          x + 1.5,
          y,
          x + 1.5,
          y + 0.75,
          x,
          y,
          x + 1.5,
          y + 0.75,
          x,
          y + 0.75,
        );
        for (let vertex = 0; vertex < 6; vertex++) colors.push(tint.r, tint.g, tint.b);
      }
      const spec = tile.tile.spec;
      if (!spec) continue;
      const grass = resolveWorldTerrain(spec).colors[0];
      appendPathShoulder(
        positions,
        colors,
        { x: quad[0][0], y: quad[0][1] },
        { x: quad[3][0], y: quad[3][1] },
        tile,
        grass,
        1.2,
        0.75,
      );
      appendPathShoulder(
        positions,
        colors,
        { x: quad[1][0], y: quad[1][1] },
        { x: quad[2][0], y: quad[2][1] },
        tile,
        grass,
        1.2,
        0.75,
      );
    }
  }
  for (const sprite of options.sprites ?? []) {
    const start = sprite.entrance;
    if (!start) continue;
    let closest: { x: number; y: number; tile: TerrainHex; distance: number } | null =
      null;
    for (const { a, b, bridge } of roadLayout.segments) {
      if (bridge) continue;
      const dx = b.x - a.x,
        dy = (b.y - a.y) * 2;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((start.x - a.x) * dx + (start.y - a.y) * 2 * dy) / (dx * dx + dy * dy),
        ),
      );
      const x = a.x + dx * t,
        y = a.y + (b.y - a.y) * t;
      const distance = Math.hypot(x - start.x, (y - start.y) * 2);
      if (distance < a.tile.width * 1.5 && (!closest || distance < closest.distance))
        closest = { x, y, tile: a.tile, distance };
    }
    if (!closest || closest.distance < 2) continue;
    const end = closest;
    // Only connect nearby doors; scenery must not imply a route through water or a wall.
    const clear = Array.from({ length: 9 }, (_, index) => {
      const t = index / 8;
      const tile = grid.pointToHex({
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      });
      return (
        tile &&
        !tile.spec?.isWater &&
        !tile.blocked &&
        !foundations.has(`${tile.col},${tile.row}`)
      );
    }).every(Boolean);
    if (!clear) continue;
    const dx = (end.x - start.x) / end.distance,
      dy = ((end.y - start.y) * 2) / end.distance;
    const width = Math.min(start.width / 2, end.tile.width * 0.16);
    const quad = [
      [start.x - dy * width, start.y + dx * width * 0.5],
      [start.x + dy * width, start.y - dx * width * 0.5],
      [end.x + dx * 2 + dy * width, end.y + dy - dx * width * 0.5],
      [end.x + dx * 2 - dy * width, end.y + dy + dx * width * 0.5],
    ];
    const color = linearRenderColor(roadColors[1]);
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const point = quad[index];
      if (!point) continue;
      positions.push(...point.map((value) => Math.round(value / 1.5) * 1.5));
      colors.push(color.r, color.g, color.b);
    }
  }
  for (const sprite of lightLayout ? [] : (options.sprites ?? []))
    if (sprite.entrance?.hasCourt)
      appendForecourt(
        positions,
        colors,
        grid,
        courtExclusions,
        sprite.entrance,
        VILLAGE_ART[options.sector ?? -1]?.court ?? roadColors,
        sprite.entrance.hasPrecinct ? "walk" : undefined,
      );
  return {
    ...data,
    surface: new Float32Array(positions),
    surfaceColors: new Float32Array(colors),
  };
};

/** Overlapping canopy fields form continuous leaf-soil beds, with open ground around landmark courts. */
const createGroveShade = (
  grid: Grid<TerrainHex>,
  sprites: WorldSpriteDescription[],
) => {
  const h = grid.toArray()[0]?.height ?? 1;
  const canopies = sprites.filter(
    (sprite) =>
      sprite.kind === "decoration" &&
      sprite.size > h * 2 &&
      sprite.image === "/world-art/woodland-village.webp",
  );
  const courts = sprites.flatMap((sprite) =>
    sprite.entrance?.hasCourt ? [sprite.entrance] : [],
  );
  const samples = new Map<string, number>();
  return (point: { x: number; y: number }) => {
    const key = `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
    const cached = samples.get(key);
    if (cached !== undefined) return cached;
    let density = 0;
    for (const tree of canopies) {
      const dx = (point.x - tree.x) / (h * 3),
        dy = (point.y - tree.groundY) / (h * 1.9);
      density += Math.min(1, Math.max(0, 1 - dx * dx - dy * dy) * 1.8);
    }
    let shade = Math.min(1, Math.max(0, density - 0.25) * 0.8);
    for (const court of courts) {
      const distance = Math.hypot(
        (point.x - court.x) / (h * (court.hasPrecinct ? 4.5 : 3)),
        (point.y - court.y + h * (court.hasPrecinct ? 1.5 : 0.9)) /
          (h * (court.hasPrecinct ? 3.5 : 2.4)),
      );
      shade = Math.min(shade, distance < 1 ? -0.25 * (1 - distance) : shade);
    }
    samples.set(key, shade);
    return shade;
  };
};

/** Clipped flagstones join a landmark's stairs to its approach without changing the gameplay grid. */
const appendForecourt = (
  positions: number[],
  colors: number[],
  grid: Grid<TerrainHex>,
  foundations: ReadonlySet<string>,
  entrance: NonNullable<WorldSpriteDescription["entrance"]>,
  palette: readonly [string, string, string],
  layer?: "base" | "walk",
) => {
  const h = grid.toArray()[0]?.height;
  if (!h) return;
  const { width, depth } = getWorldForecourtSize(
    h,
    entrance.hasPrecinct,
    entrance.courtScale,
  );
  const gap = h * 0.025,
    columns = entrance.hasPrecinct ? 14 : 12,
    rows = entrance.hasPrecinct ? 10 : 8;
  const point = (x: number, y: number) => getWorldForecourtPoint(entrance, x, y);
  // Rear courses tuck under the foundation; a continuous mortar bed joins the court to its steps.
  for (const inset of [0, gap])
    for (let row = -2; row < rows; row++)
      for (let col = 0; col < columns; col++) {
        const seed = Math.abs(col * 31 + row * 17 + Math.round(entrance.x));
        if (
          !entrance.hasPrecinct &&
          (row === rows - 1 || col === 0 || col === columns - 1) &&
          seed % 7 === 0
        )
          continue;
        const x =
            (col / columns - 0.5) * width +
            (entrance.hasPrecinct ? 0 : (Math.abs(row % 2) * width) / 40),
          y = (row / rows) * depth;
        const isGarden = entrance.hasPrecinct && col < 4 && row >= 3 && row <= 7;
        const isWalk =
          !entrance.hasPrecinct ||
          Math.abs(x + width / columns / 2) < h * 0.8 ||
          row <= 0;
        if (layer && isWalk !== (layer === "walk")) continue;
        const left = isWalk ? inset : col === 0 ? inset * 1.5 : 0;
        const right = isWalk
          ? inset
          : col === columns - 1 || (isGarden && col === 3)
            ? inset * 1.5
            : 0;
        const top = isWalk
          ? inset
          : row === 0 || (isGarden && row === 3)
            ? inset * 1.5
            : 0;
        const bottom = isWalk
          ? inset
          : row === rows - 1 || (isGarden && row === 7)
            ? inset * 1.5
            : 0;
        const quad = [
          point(x + left, y + top),
          point(x + width / columns - right, y + top),
          point(x + width / columns - right, y + depth / rows - bottom),
          point(x + left, y + depth / rows - bottom),
        ].map(([x, y]): [number, number] => [
          Math.round(x / 0.75) * 0.75,
          Math.round(y / 0.75) * 0.75,
        ]);
        if (
          quad.some(([x, y]) => {
            const tile = grid.pointToHex({ x, y });
            return (
              !tile || tile.spec?.isWater || foundations.has(`${tile.col},${tile.row}`)
            );
          })
        )
          continue;
        const color = linearRenderColor(
          inset
            ? isGarden
              ? "#6c7155"
              : isWalk
                ? (palette[seed % 3] ?? palette[0])
                : palette[2]
            : palette[2],
        );
        if (!inset) {
          color.r *= 0.8;
          color.g *= 0.8;
          color.b *= 0.8;
        }
        for (const index of [0, 1, 2, 0, 2, 3]) {
          const vertex = quad[index];
          if (!vertex) continue;
          positions.push(...vertex);
          colors.push(color.r, color.g, color.b);
        }
      }
};

const ROAD_COLORS = ["#b09f74", "#a7966a", "#9d8c61"] as const;
const SHORE_COLORS = ["#c8b58a", "#bfac81", "#b5a177"] as const;
