/**
 * Generate the world globe as a CUBE-SPHERE: 6 cube faces, each an 18x18 grid
 * of tiles (6 * 324 = 1944), projected onto a sphere. Unlike a lat/long UV-sphere,
 * a cube-sphere has NO pole singularity - every tile is a well-formed quad with
 * exactly four neighbours - so the globe renders cleanly everywhere.
 *
 * Sector id = face * FACE_SIZE^2 + row * FACE_SIZE + col, so each of the six
 * faces is a contiguous id range. Neighbours are found by CORNER MATCHING: every tile edge is a
 * shared cube edge, so two tiles are neighbours exactly when they share an edge
 * in 3D. This makes every link mirror-reciprocal by construction and handles
 * cross-face seams (and their rotations) with no hand-authored adjacency table.
 *
 * Biomes follow latitude from the +Y axis (poles -> ice, equator -> desert),
 * but the poles now sit in the middle of the +Y / -Y faces, which tessellate
 * as regular grids, so there is no distortion there.
 *
 * Output schema is unchanged: { radius, tiles: [{ c, b[4], t, n, ne }] } written
 * to src/data/hexasphere.json (the server-side module import). The client fetches
 * the same file from UploadThing's CDN (IMG_MAP_HEXASPHERE), so after
 * regenerating, upload it and repoint the constant:
 *   bun run scripts/upload-map-asset.ts src/data/hexasphere.json application/json
 * then paste the printed CDN url into IMG_MAP_HEXASPHERE in @/drizzle/constants.ts
 * and bump MAP_CACHE_VERSION in libs/threejs/globe.ts.
 *
 * Usage (from /app): bun run scripts/generate-globe.ts
 *   [--villages 271,296,...]   sector ids that must be on land
 *   [--out src/data/hexasphere.json]
 */
import { writeFileSync } from "node:fs";
import alea from "alea";
import { getFlagValue, parseIntList } from "./cli";
import { createNoise3D } from "simplex-noise";
import {
  MAP_SECTOR_ID_MAX,
  MAP_WAKE_ISLAND_SECTOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";

const RADIUS = 30;
const FACE_SIZE = 18; // tiles per face edge
const FACES = 6;
const TILE_COUNT = FACES * FACE_SIZE * FACE_SIZE; // 1944

type Vec3 = { x: number; y: number; z: number };

/** Sector id from cube-face grid position: face * FACE_SIZE^2 + row * FACE_SIZE + col */
const toId = (face: number, col: number, row: number) =>
  face * FACE_SIZE * FACE_SIZE + row * FACE_SIZE + col;

/**
 * Cube-surface point for grid indices (i, j in [0, FACE_SIZE]) on a face,
 * before projection to the sphere. Each face is one side of the [-1, 1] cube;
 * a shared cube edge produces identical 3D points on both faces, which is what
 * lets corner matching stitch the faces together.
 *
 * The (i, j) -> (a, b) axis assignment is chosen PER FACE so that all six faces
 * wind the same way (counter-clockwise as seen from outside the sphere). A
 * consistently oriented cube-sphere is a single orientable manifold, so every
 * face seam is a pure rotation (0/90/180/270) with NO reflection - which is
 * exactly what lets a square 26x26 sector map tile across the 12 cube edges
 * (rotate the neighbour's map; never mirror it).
 */
const faceCubePoint = (face: number, i: number, j: number): Vec3 => {
  const a = (i / FACE_SIZE) * 2 - 1; // [-1, 1]
  const b = (j / FACE_SIZE) * 2 - 1;
  switch (face) {
    case 0:
      return { x: 1, y: a, z: b }; // +X
    case 1:
      return { x: -1, y: b, z: a }; // -X
    case 2:
      return { x: b, y: 1, z: a }; // +Y (north cap)
    case 3:
      return { x: a, y: -1, z: b }; // -Y (south cap)
    case 4:
      return { x: a, y: b, z: 1 }; // +Z
    default:
      return { x: b, y: a, z: -1 }; // -Z
  }
};

/** Project a cube-surface point onto the sphere of the given radius */
const toSphere = (p: Vec3): Vec3 => {
  const len = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
  return { x: (p.x / len) * RADIUS, y: (p.y / len) * RADIUS, z: (p.z / len) * RADIUS };
};

/**
 * Hash key for a corner point, quantized to 4 decimals so corners computed
 * independently on adjacent cube faces hash to the same key despite float
 * noise - this quantization is what makes corner/edge matching work.
 */
const cornerKey = (p: Vec3) =>
  `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;

interface RawTile {
  id: number;
  corners: [Vec3, Vec3, Vec3, Vec3]; // [NW, NE, SE, SW]
  center: Vec3;
}

/**
 * Build all tiles of the cube-sphere, indexed by toId(face, col, row). Corner
 * order is [NW, NE, SE, SW] - an invariant the edge indexing in
 * buildNeighbours (0-1 = N .. 3-0 = W) depends on. The center is the average
 * of the four corners re-projected onto the sphere.
 */
const buildTiles = (): RawTile[] => {
  const tiles: RawTile[] = [];
  for (let face = 0; face < FACES; face++) {
    for (let row = 0; row < FACE_SIZE; row++) {
      for (let col = 0; col < FACE_SIZE; col++) {
        const nw = toSphere(faceCubePoint(face, col, row));
        const ne = toSphere(faceCubePoint(face, col + 1, row));
        const se = toSphere(faceCubePoint(face, col + 1, row + 1));
        const sw = toSphere(faceCubePoint(face, col, row + 1));
        const center = toSphere({
          x: (nw.x + ne.x + se.x + sw.x) / 4,
          y: (nw.y + ne.y + se.y + sw.y) / 4,
          z: (nw.z + ne.z + se.z + sw.z) / 4,
        });
        tiles[toId(face, col, row)] = {
          id: toId(face, col, row),
          corners: [nw, ne, se, sw],
          center,
        };
      }
    }
  }
  return tiles;
};

/**
 * Neighbour ids and entry edges by corner matching. Tile edges are corner pairs
 * (0-1 = N, 1-2 = E, 2-3 = S, 3-0 = W); the neighbour across an edge is the
 * other tile that shares that exact 3D edge. On a closed cube-sphere every edge
 * is shared by exactly two tiles, so every tile gets four neighbours.
 *
 * `entryEdges[id][k]` is the edge index (0..3) of the neighbour across this
 * tile's edge k that coincides with the shared edge - i.e. the edge a crossing
 * ENTERS through. For within-face neighbours this is always (k + 2) % 4 (an
 * aligned grid); across the 12 cube-edge seams it differs, encoding the seam's
 * 90/270 rotation. Because the cube-sphere is consistently oriented, the shared
 * edge is traversed in opposite corner order by the two tiles, so the entry
 * edge is a pure rotation with no reflection.
 */
const buildNeighbours = (
  tiles: RawTile[],
): { neighbours: number[][]; entryEdges: number[][] } => {
  const edgeMap = new Map<string, { id: number; dir: number }[]>();
  // Order-independent key for an edge's two 3D corners, so both tiles
  // traversing the shared edge (in opposite order) produce the same key
  const edgeKey = (a: Vec3, b: Vec3) => {
    const ka = cornerKey(a);
    const kb = cornerKey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  for (const tile of tiles) {
    for (let dir = 0; dir < 4; dir++) {
      const a = tile.corners[dir]!;
      const b = tile.corners[(dir + 1) % 4]!;
      const key = edgeKey(a, b);
      const list = edgeMap.get(key) ?? [];
      list.push({ id: tile.id, dir });
      edgeMap.set(key, list);
    }
  }
  const neighbours: number[][] = tiles.map(() => [-1, -1, -1, -1]);
  const entryEdges: number[][] = tiles.map(() => [-1, -1, -1, -1]);
  for (const tile of tiles) {
    for (let dir = 0; dir < 4; dir++) {
      const a = tile.corners[dir]!;
      const b = tile.corners[(dir + 1) % 4]!;
      const shared = edgeMap.get(edgeKey(a, b)) ?? [];
      const other = shared.find((entry) => entry.id !== tile.id);
      if (other) {
        neighbours[tile.id]![dir] = other.id;
        entryEdges[tile.id]![dir] = other.dir;
      }
    }
  }
  return { neighbours, entryEdges };
};

/** Terrain type per tile: 0 ocean, 1 ground, 2 dessert, 3 ice */
const terrainFor = (center: Vec3, land: boolean): number => {
  if (!land) return 0;
  const latRatio = Math.abs(center.y) / RADIUS; // 0 equator, 1 pole
  if (latRatio > 0.72) return 3; // ice caps
  if (latRatio < 0.24) return 2; // equatorial desert
  return 1; // temperate ground
};

/**
 * Land mask per tile id. Two-octave 3D simplex noise grows a few large
 * continents (deterministic via the passed prng), then radius-2 land blobs are
 * grown around every village sector so no village ends up a one-tile island.
 * Wake Island is excluded from blob growth and forced to a single land cell;
 * its surrounding ocean ring is enforced by main().
 */
const generateLand = (
  tiles: RawTile[],
  neighbours: number[][],
  villageSectors: number[],
  prng: () => number,
): boolean[] => {
  const noise = createNoise3D(prng);
  const noise2 = createNoise3D(prng);
  const land = new Array<boolean>(TILE_COUNT).fill(false);
  // Land where the noise clears this threshold; lower = more land / less water.
  const LAND_THRESHOLD = 0.01;
  for (const tile of tiles) {
    const n = tile.center;
    // Two-octave 3D noise on the unit sphere grows a few large continents
    const value =
      noise(n.x / 12, n.y / 12, n.z / 12) * 0.7 +
      noise2(n.x / 6, n.y / 6, n.z / 6) * 0.3;
    if (value > LAND_THRESHOLD) land[tile.id] = true;
  }
  // Grow a small landmass (radius 2 over the neighbour graph) around every
  // village seed so no village is left as a lonely one-tile island. Wake Island
  // is handled separately by main() and deliberately excluded here.
  const growBlob = (seed: number, radius: number) => {
    let frontier = [seed];
    for (let step = 0; step <= radius; step++) {
      const next: number[] = [];
      for (const id of frontier) {
        land[id] = true;
        for (const nb of neighbours[id]!) if (nb >= 0 && !land[nb]) next.push(nb);
      }
      frontier = next;
    }
  };
  for (const id of villageSectors) {
    if (id >= 0 && id < TILE_COUNT && id !== MAP_WAKE_ISLAND_SECTOR) growBlob(id, 2);
  }
  // The war-torn battleground is a village-like fixed location
  growBlob(MAP_WAR_TORN_BATTLEGROUND_SECTOR, 2);
  // Wake Island: exactly one land cell (its isolation is enforced by main())
  land[MAP_WAKE_ISLAND_SECTOR] = true;
  return land;
};

/**
 * Generate the cube-sphere tiles, land/biome layout and neighbor graph,
 * verify the topology (4 mirror-reciprocal neighbors per tile), and write
 * src/data/hexasphere.json
 */
const main = () => {
  const argv = process.argv.slice(2);
  const out = getFlagValue(argv, "--out") ?? "src/data/hexasphere.json";
  const villageSectors = parseIntList(getFlagValue(argv, "--villages"));

  if (MAP_SECTOR_ID_MAX !== TILE_COUNT - 1) {
    throw new Error(`MAP_SECTOR_ID_MAX must equal ${TILE_COUNT - 1}`);
  }

  const tiles = buildTiles();
  const { neighbours, entryEdges } = buildNeighbours(tiles);
  const prng = alea("cube-sphere-v1");
  const land = generateLand(tiles, neighbours, villageSectors, prng);

  // Isolate Wake Island: force its immediate neighbours to ocean
  const islandRing = new Set<number>([MAP_WAKE_ISLAND_SECTOR]);
  for (const nb of neighbours[MAP_WAKE_ISLAND_SECTOR]!) if (nb >= 0) islandRing.add(nb);
  islandRing.forEach((id) => {
    if (id !== MAP_WAKE_ISLAND_SECTOR) land[id] = false;
  });

  const out_tiles = tiles.map((tile) => ({
    c: tile.center,
    b: tile.corners.map((p) => ({
      x: p.x.toFixed(3),
      y: p.y.toFixed(3),
      z: p.z.toFixed(3),
    })),
    t: terrainFor(tile.center, land[tile.id]!),
    n: neighbours[tile.id]!,
    ne: entryEdges[tile.id]!,
  }));

  const payload = JSON.stringify({ radius: RADIUS, tiles: out_tiles });
  writeFileSync(out, payload);

  const counts = out_tiles.reduce<Record<number, number>>((acc, t) => {
    acc[t.t] = (acc[t.t] ?? 0) + 1;
    return acc;
  }, {});
  // Verify the topology: every tile has 4 real neighbours, all mirror-reciprocal
  let nonMirror = 0;
  let missing = 0;
  for (let id = 0; id < TILE_COUNT; id++) {
    for (const nb of out_tiles[id]!.n) {
      if (nb < 0) {
        missing++;
      } else if (!out_tiles[nb]!.n.includes(id)) {
        nonMirror++;
      }
    }
  }
  console.log(
    `Wrote ${out}: ${TILE_COUNT} cube-sphere tiles ` +
      `(6 faces x ${FACE_SIZE}x${FACE_SIZE}), terrain ${JSON.stringify(counts)}, ` +
      `${missing} missing neighbours, ${nonMirror} non-mirror links`,
  );
  console.log(
    "Next: upload to UploadThing and repoint IMG_MAP_HEXASPHERE —\n" +
      `  bun run scripts/upload-map-asset.ts ${out} application/json`,
  );
};

if (import.meta.main) {
  main();
}
