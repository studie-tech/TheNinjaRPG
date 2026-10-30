import { type Grid, ring } from "honeycomb-grid";
import type { TerrainHex } from "@/libs/hexgrid";
import { type LinearColor, linearRenderColor } from "@/libs/rendering/color";
import {
  calculateHexUVCoordinates,
  calculateTileOffset,
  createGroundCorners,
  getHexPoints,
} from "@/libs/rendering/hexGeometry";
import { parseHexColor } from "@/utils/color";

/**
 * Renderer-free buffers in the grid's Y-up world units, retaining per-tile face
 * offsets for picking. lightLayout omits ground depth, textures and wave animation.
 * Surface outlines share their face layer so higher faces cover lower outlines.
 * A window-wide water sampler keeps coastal color continuous between retained sectors.
 */
export const buildHexTerrainData = (
  grid: Grid<TerrainHex>,
  look: (tile: TerrainHex) => TerrainLook,
  lightLayout: boolean,
  waterDepthAt?: (point: { x: number; y: number }) => number,
) => {
  const materials = new Map(grid.toArray().map((tile) => [tile, look(tile)]));
  const shelf =
    !lightLayout && [...materials.values()].some((material) => material.waterDepth)
      ? (waterDepthAt ?? createWaterShelf(grid, materials))
      : null;
  const shallow = linearRenderColor("#8a9f88"),
    deep = linearRenderColor("#3c6476");
  const { points, groundPoints, groundEdges: groundEdgeIndices } = getHexPoints();
  const tileUVArray = calculateHexUVCoordinates(grid.toArray()[0], points);
  const groups = new Map<string, TerrainBatchBuilder>();
  const ground: number[] = [],
    groundEdges: number[] = [];
  const surface: number[] = [],
    surfaceColors: number[] = [];
  const edges = new Map<number, number[]>();
  const perimeter = new Map<
    string,
    {
      count: number;
      points: number[];
      material: TerrainLook;
      center: { x: number; y: number };
      offset: number;
    }
  >();
  const faceOffsets = new Map<string, number>();
  let animatedTiles = 0;
  for (const [tile, material] of materials) {
    const { length, offsetLength, offsetLayer } = calculateTileOffset(
      tile.corners,
      material.depression,
      lightLayout,
    );
    faceOffsets.set(`${tile.col},${tile.row}`, offsetLength);
    let faceEdges = edges.get(offsetLayer);
    if (!faceEdges) {
      faceEdges = [];
      edges.set(offsetLayer, faceEdges);
    }
    const kind = lightLayout
      ? "solid"
      : material.texture && !material.waterDepth
        ? "image"
        : "noise";
    const texture = lightLayout || material.waterDepth ? null : material.texture;
    const key = `${offsetLayer}:${kind}:${texture ?? ""}`;
    let batch = groups.get(key);
    if (!batch) {
      batch = {
        kind,
        texture,
        layer: offsetLayer,
        positions: [],
        uvs: [],
        colors: [],
        rawColors: [],
        waves: [],
        tiles: [],
      };
      groups.set(key, batch);
    }
    const linear = linearRenderColor(material.color),
      raw = parseHexColor(material.color);
    if (!raw) throw new Error(`Invalid terrain color ${material.color}`);
    const wave = lightLayout ? -1 : material.waterDepth ? 0 : material.waveOffset;
    if (wave >= 0) animatedTiles++;
    batch.tiles.push({
      key: `${tile.col},${tile.row}`,
      start: batch.positions.length / 2,
      count: points.length,
    });
    points.forEach((corner, index) => {
      const point = tile.corners[corner];
      if (!point) return;
      batch.positions.push(point.x, point.y + offsetLength);
      batch.uvs.push(
        material.waterDepth
          ? point.x / (tile.height * 4)
          : (tileUVArray?.[index * 2] ?? 0),
        material.waterDepth
          ? point.y / (tile.height * 4)
          : (tileUVArray?.[index * 2 + 1] ?? 0),
      );
      const shade = material.groundShade?.(point) ?? 0;
      const depth = material.waterDepth ? shelf?.(point) : undefined;
      for (const channel of ["r", "g", "b"] as const)
        batch.colors.push(
          depth !== undefined
            ? shallow[channel] * (1 - depth) + deep[channel] * depth
            : shade > 0 && material.groundColor
              ? linear[channel] * (1 - shade) + material.groundColor[channel] * shade
              : linear[channel] * (1 - shade * 0.2),
        );
      batch.rawColors.push(raw.r, raw.g, raw.b, 255);
      batch.waves.push(wave);
    });
    tile.corners.forEach((a, index) => {
      const b = tile.corners[(index + 1) % tile.corners.length];
      if (!b) return;
      faceEdges.push(a.x, a.y + offsetLength, b.x, b.y + offsetLength);
      // Match neighbors at grid height, but draw the perimeter on the visible face.
      const key = [a, b]
        .map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`)
        .sort()
        .join(":");
      const previous = perimeter.get(key);
      if (previous) {
        previous.count++;
        if (!lightLayout && !!previous.material.isWater !== !!material.isWater) {
          const water = material.isWater ? tile : previous.center;
          appendShoreline(
            surface,
            surfaceColors,
            a,
            b,
            water,
            material.isWater ? offsetLength : previous.offset,
          );
        }
        if (
          !lightLayout &&
          !!previous.material.isRoad !== !!material.isRoad &&
          previous.material.depression === 0 &&
          material.depression === 0
        ) {
          const roadCenter = material.isRoad ? tile : previous.center;
          const grass = material.isRoad ? previous.material.color : material.color;
          appendPathShoulder(surface, surfaceColors, a, b, roadCenter, grass);
        }
        if (
          !lightLayout &&
          material.frost &&
          previous.material.frost &&
          material.frost !== previous.material.frost &&
          material.depression === 0 &&
          previous.material.depression === 0
        ) {
          const iceCenter = material.frost === "ice" ? tile : previous.center;
          const snow =
            material.frost === "snow" ? material.color : previous.material.color;
          appendPathShoulder(surface, surfaceColors, a, b, iceCenter, snow, 4, 1.5);
        }
      } else
        perimeter.set(key, {
          count: 1,
          points: [a.x, a.y + offsetLength, b.x, b.y + offsetLength],
          material,
          center: { x: tile.x, y: tile.y },
          offset: offsetLength,
        });
    });
    if (!lightLayout) {
      const corners = createGroundCorners(tile.corners, offsetLength, length);
      for (const index of groundPoints) {
        const point = corners[index];
        if (point) ground.push(point.x, point.y);
      }
      for (const edge of groundEdgeIndices)
        for (const index of edge) {
          const point = corners[index];
          if (point) groundEdges.push(point.x, point.y);
        }
    }
  }
  return {
    batches: [...groups.values()]
      .sort((a, b) => a.layer - b.layer)
      .map((batch) => ({
        ...batch,
        positions: new Float32Array(batch.positions),
        uvs: new Float32Array(batch.uvs),
        colors: new Float32Array(batch.colors),
        rawColors: new Uint8Array(batch.rawColors),
        waves: new Float32Array(batch.waves),
      })),
    ground: new Float32Array(ground),
    groundEdges: new Float32Array(groundEdges),
    surface: new Float32Array(surface),
    surfaceColors: new Float32Array(surfaceColors),
    edges: new Map(
      [...edges].map(([layer, points]) => [layer, new Float32Array(points)]),
    ),
    boundary: new Float32Array(
      [...perimeter.values()]
        .filter((edge) => edge.count === 1)
        .flatMap((edge) => edge.points),
    ),
    faceOffsets,
    animatedTiles,
  };
};

/** A bounded shoreline flood fill colors shared vertices once, preserving terrain geometry and picking. */
export const createWaterShelf = (
  grid: Grid<TerrainHex>,
  materials: ReadonlyMap<TerrainHex, Pick<TerrainLook, "isWater">>,
) => {
  const distances = new Map<TerrainHex, number>();
  for (const [tile, material] of materials)
    if (!material.isWater) distances.set(tile, 0);
  const queue = [...distances.keys()];
  for (let index = 0; index < queue.length; index++) {
    const tile = queue[index];
    if (!tile) continue;
    const distance = distances.get(tile) ?? 4;
    if (distance >= 4) continue;
    for (const neighbor of grid.traverse(ring({ center: tile, radius: 1 })))
      if (!distances.has(neighbor)) {
        distances.set(neighbor, distance + 1);
        queue.push(neighbor);
      }
  }
  const vertices = new Map<string, { sum: number; count: number }>();
  for (const tile of grid)
    for (const point of tile.corners) {
      const key = `${point.x.toFixed(4)},${point.y.toFixed(4)}`;
      const sample = vertices.get(key) ?? { sum: 0, count: 0 };
      sample.sum += distances.get(tile) ?? 4;
      sample.count++;
      vertices.set(key, sample);
    }
  return (point: { x: number; y: number }) => {
    const sample = vertices.get(`${point.x.toFixed(4)},${point.y.toFixed(4)}`);
    return sample ? Math.min(1, sample.sum / sample.count / 4) : 1;
  };
};

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
    let sign = 0,
      inside = true;
    for (let index = 0; index < tile.corners.length; index++) {
      const a = tile.corners[index],
        b = tile.corners[(index + 1) % tile.corners.length];
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
  /** Flat snow/ice joins use grouped drifts rather than elevated foundation rims. */
  frost?: "snow" | "ice";
};

/** A shallow two-tone tidal edge grounds island foundations in the same static surface batch. */
const appendShoreline = (
  positions: number[],
  colors: number[],
  a: { x: number; y: number },
  b: { x: number; y: number },
  water: { x: number; y: number },
  offset: number,
) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy);
  const direction =
    (water.x - (a.x + b.x) / 2) * -dy + (water.y - (a.y + b.y) / 2) * dx > 0 ? 1 : -1;
  const nx = (-dy / length) * direction,
    ny = (dx / length) * direction;
  for (const [near, far, tint] of [
    [0, 0.75, "#9fb8ad"],
    [0.75, 2.5, "#6b918b"],
  ] as const) {
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
      Math.round((a.y + dy * t + (dx / length) * inset * direction) / step) * step;
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
type TerrainBatchBuilder = {
  kind: "solid" | "noise" | "image";
  texture: string | null;
  layer: number;
  positions: number[];
  uvs: number[];
  colors: number[];
  rawColors: number[];
  waves: number[];
  tiles: { key: string; start: number; count: number }[];
};
