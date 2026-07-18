/**
 * Globally coherent world-generation fields.
 *
 * Sector maps used to be generated in isolation (one independent noise seed per
 * sector, one uniform biome), so features (lakes, coastlines) stopped dead at
 * sector borders and biomes changed abruptly across them. These fields instead
 * are defined ONCE over the whole sphere and sampled at each tile's true 3D
 * position, so neighbouring sectors agree along their shared edge and the world
 * reads as continuous. Because everything is a function of the 3D position, the
 * 90/270-degree cube-edge seams are handled for free (the shared edge is the
 * same set of 3D points regardless of either sector's local orientation).
 *
 * The global per-sector biome map (hexasphere.json `t`) is still respected: a
 * sector's interior votes for its own biome; only near the edges do neighbours'
 * biomes interleave, via a domain-warped nearest-centre vote.
 */
import alea from "alea";
import { createNoise3D } from "simplex-noise";

/** Sphere radius; matches scripts/generate-globe.ts and the tile corner data */
export const WORLDGEN_RADIUS = 30;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// Fixed seeds so every sector samples the exact same global field
const elevationNoise = createNoise3D(alea("worldgen-elevation-v1"));
const detailNoise = createNoise3D(alea("worldgen-detail-v1"));
const featureNoise = createNoise3D(alea("worldgen-feature-v1"));
const warpNoiseA = createNoise3D(alea("worldgen-warp-a-v1"));
const warpNoiseB = createNoise3D(alea("worldgen-warp-b-v1"));
const warpNoiseC = createNoise3D(alea("worldgen-warp-c-v1"));

/**
 * Normalize a point onto the WORLDGEN_RADIUS sphere. Bilinear corner
 * interpolation yields chord points inside the sphere, so re-projection keeps
 * sampling positions on the surface; the || 1 guards the degenerate zero
 * vector.
 */
const projectToSphere = (p: Vec3): Vec3 => {
  const len = Math.hypot(p.x, p.y, p.z) || 1;
  return {
    x: (p.x / len) * WORLDGEN_RADIUS,
    y: (p.y / len) * WORLDGEN_RADIUS,
    z: (p.z / len) * WORLDGEN_RADIUS,
  };
};

/**
 * 3D position on the sphere for grid tile (x, y) inside a sector, bilinearly
 * interpolated from the sector's four corners. Corner order is the canonical
 * [NW, NE, SE, SW] with the grid binding (x0,y0)=NW, (xW,y0)=NE, (xW,yH)=SE,
 * (x0,yH)=SW - the same binding the crossing math uses, so the interpolation
 * matches neighbours along every shared edge.
 */
export const tilePosition = (
  corners: [Vec3, Vec3, Vec3, Vec3],
  x: number,
  y: number,
  width: number,
  height: number,
): Vec3 => {
  const u = width > 1 ? x / (width - 1) : 0;
  const v = height > 1 ? y / (height - 1) : 0;
  const [nw, ne, se, sw] = corners;
  // Linear interpolation between two 3D points
  const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  });
  const top = lerp(nw, ne, u);
  const bottom = lerp(sw, se, u);
  return projectToSphere(lerp(top, bottom, v));
};

/**
 * Continuous elevation in roughly [-1, 1]. Low octaves shape whole landmasses;
 * higher octaves add lake/coastline detail at sub-sector scale.
 */
export const globalElevation = (p: Vec3): number => {
  const s = 1 / 9;
  return (
    elevationNoise(p.x * s, p.y * s, p.z * s) * 0.6 +
    detailNoise(p.x * s * 2.7, p.y * s * 2.7, p.z * s * 2.7) * 0.28 +
    detailNoise(p.x * s * 6.3, p.y * s * 6.3, p.z * s * 6.3) * 0.12
  );
};

/** Continuous feature noise (snow patches, shoreline erosion) in [-1, 1] */
export const globalFeature = (p: Vec3): number => {
  const s = 1 / 4;
  return featureNoise(p.x * s, p.y * s, p.z * s);
};

/** Domain-warp a position so biome boundaries wiggle organically across borders */
const warp = (p: Vec3, amplitude: number): Vec3 => {
  const s = 1 / 7;
  return {
    x: p.x + warpNoiseA(p.x * s, p.y * s, p.z * s) * amplitude,
    y: p.y + warpNoiseB(p.x * s, p.y * s, p.z * s) * amplitude,
    z: p.z + warpNoiseC(p.x * s, p.y * s, p.z * s) * amplitude,
  };
};

export interface BiomeCandidate {
  center: Vec3;
  /** Terrain type from hexasphere.json: 0 ocean, 1 ground, 2 dessert, 3 ice */
  t: number;
}

/**
 * The global biome (`t`) at a position: the terrain of the nearest sector centre
 * after domain-warping the sample point. Within a sector's interior its own
 * centre is nearest, so its biome is preserved; near an edge the warp lets a
 * neighbour's centre win, producing an organic transition band that crosses the
 * border identically from both sides (both use the same warp and centres).
 */
export const biomeVote = (
  p: Vec3,
  candidates: BiomeCandidate[],
  warpAmplitude: number,
): number => {
  const pw = warp(p, warpAmplitude);
  let bestT = candidates[0]?.t ?? 1;
  let bestDist = Infinity;
  for (const candidate of candidates) {
    const dx = pw.x - candidate.center.x;
    const dy = pw.y - candidate.center.y;
    const dz = pw.z - candidate.center.z;
    const dist = dx * dx + dy * dy + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      bestT = candidate.t;
    }
  }
  return bestT;
};
