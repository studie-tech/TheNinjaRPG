/**
 * Globally coherent world-generation fields.
 *
 * These fields are defined ONCE over the whole sphere and sampled at each
 * tile's true 3D position, so neighbouring sectors agree along their shared
 * edge: lakes, coastlines and biomes continue across sector borders and the
 * world reads as continuous. The cylindrical longitude/latitude graph uses one local
 * orientation everywhere, and 3D sampling remains continuous across its wrapped
 * east/west boundary. Both the globe and local map generator call these same
 * fields directly, rather than deriving one view from the other's resolution.
 */
import alea from "alea";
import { createNoise3D } from "simplex-noise";
import { MAP_WAKE_ISLAND_SECTOR } from "@/drizzle/constants";
import {
  sectorGeographicBounds,
  sectorGridNeighbors,
  sectorGridPosition,
} from "@/libs/sector-map/world-grid";

/** Sphere radius of the globe and its tile corner data */
export const WORLDGEN_RADIUS = 30;
export const WORLDGEN_LAND_THRESHOLD = -0.2;
// A sector is roughly 2.5 world units tall. Extending protection 2.2 units
// lets reserved/landmark terrain spill well into adjacent sectors while
// keeping continents irregular rather than broad and circular.
export const WORLDGEN_PROTECTED_LAND_RADIUS = 2.2;
export const WORLDGEN_WAKE_ISLAND_RADIUS_FACTOR = 0.46;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// Fixed seeds so every sector samples the exact same global field
const elevationNoise = createNoise3D(alea("worldgen-elevation-v1"));
const detailNoise = createNoise3D(alea("worldgen-detail-v1"));
const featureNoise = createNoise3D(alea("worldgen-feature-v1"));
const continentalNoise = createNoise3D(alea("worldgen-continental-v2"));
const continentalDetailNoise = createNoise3D(alea("worldgen-continental-detail-v2"));
const temperatureNoise = createNoise3D(alea("worldgen-temperature-v2"));
const temperatureDetailNoise = createNoise3D(alea("worldgen-temperature-detail-v2"));
const moistureNoise = createNoise3D(alea("worldgen-moisture-v2"));
const moistureDetailNoise = createNoise3D(alea("worldgen-moisture-detail-v2"));

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

/** Hermite blend of `t`, already clamped to 0-1. */
const smoothBlend = (t: number) => t * t * (3 - 2 * t);

/** Clamped Hermite interpolation of `value` between `low` and `high`. */
export const smoothstep = (low: number, high: number, value: number) =>
  smoothBlend(Math.max(0, Math.min(1, (value - low) / (high - low))));

/** Spherical point with +Y as north and longitude rotating around the Y axis. */
export const sphericalPoint = (longitude: number, latitude: number): Vec3 => {
  const lon = (longitude * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  const horizontal = Math.cos(lat) * WORLDGEN_RADIUS;
  return {
    x: Math.cos(lon) * horizontal,
    y: Math.sin(lat) * WORLDGEN_RADIUS,
    z: Math.sin(lon) * horizontal,
  };
};

/** Spherical quad of a sector in canonical [NW, NE, SE, SW] order, with its center. */
export const sectorGeometry = (sector: number) => {
  const bounds = sectorGeographicBounds(sector);
  return {
    corners: [
      sphericalPoint(bounds.west, bounds.north),
      sphericalPoint(bounds.east, bounds.north),
      sphericalPoint(bounds.east, bounds.south),
      sphericalPoint(bounds.west, bounds.south),
    ] as [Vec3, Vec3, Vec3, Vec3],
    center: sphericalPoint(
      (bounds.west + bounds.east) / 2,
      (bounds.north + bounds.south) / 2,
    ),
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

/**
 * Low-frequency continental structure with a smaller coastline octave. All
 * fields use 3D sphere coordinates, so values remain continuous across the
 * wrapped antimeridian and are reproducible from their fixed seeds.
 */
export const globalContinentalness = (p: Vec3): number => {
  const coarse = 1 / 13.5;
  const detail = 1 / 6;
  return (
    continentalNoise(p.x * coarse, p.y * coarse, p.z * coarse) * 0.76 +
    continentalDetailNoise(p.x * detail, p.y * detail, p.z * detail) * 0.24
  );
};

export interface WorldLandScoreOptions {
  protectedCenters: Vec3[];
  wakeIslandCenter: Vec3;
  wakeIslandRadius: number;
  wakeMoatRadius: number;
}

/**
 * The single deterministic land/water decision used by both the global globe
 * and high-resolution local sector maps. Landmark protection is deliberately
 * local: it guarantees a usable settlement centre without creating broad,
 * artificial circular continents.
 *
 * Wake Island uses a radial override across its sector and cardinal ocean
 * ring. This creates a real island with water inside the logical sector rather
 * than painting one entire square sector as land.
 */
export const createWorldLandScore = (options: WorldLandScoreOptions) => {
  return (point: Vec3): number => {
    let continentalness = globalContinentalness(point);
    for (const center of options.protectedCenters) {
      const distance = Math.hypot(
        point.x - center.x,
        point.y - center.y,
        point.z - center.z,
      );
      if (distance >= WORLDGEN_PROTECTED_LAND_RADIUS) continue;
      const proximity = 1 - distance / WORLDGEN_PROTECTED_LAND_RADIUS;
      continentalness = Math.max(
        continentalness,
        WORLDGEN_LAND_THRESHOLD + proximity * proximity * 0.3,
      );
    }
    const naturalScore = continentalness - WORLDGEN_LAND_THRESHOLD;

    // Wake Island must be a function of POSITION, not the sector currently
    // sampling that position, so both sides of an edge shared with Wake's
    // neighbor ring evaluate identically. Keep the island and its ocean moat,
    // then blend continuously back into the natural continental field over a
    // one-radius transition band.
    const wakeDistance = Math.hypot(
      point.x - options.wakeIslandCenter.x,
      point.y - options.wakeIslandCenter.y,
      point.z - options.wakeIslandCenter.z,
    );
    // Keep the four immediate neighbor sectors as a readable ocean moat. The
    // transition begins beyond their visual samples, but remains positional
    // and continuous when it reaches the next ring.
    const wakeBlendStart = options.wakeMoatRadius;
    const wakeBlendEnd = options.wakeMoatRadius + options.wakeIslandRadius;
    if (wakeDistance >= wakeBlendEnd) return naturalScore;
    const islandScore =
      ((options.wakeIslandRadius - wakeDistance) / options.wakeIslandRadius) * 0.25;
    if (wakeDistance <= wakeBlendStart) return islandScore;
    const t = (wakeDistance - wakeBlendStart) / (wakeBlendEnd - wakeBlendStart);
    return islandScore + (naturalScore - islandScore) * smoothBlend(t);
  };
};

/**
 * The land score of the sector grid, with protected land around `protectedSectors` and
 * Wake Island sized by its immediate neighbors. The globe and the local sector maps both
 * derive it here, so they make the same decision for every point.
 */
export const createSectorGridLandScore = (protectedSectors: number[]) =>
  createWorldLandScore({
    protectedCenters: protectedSectors
      .filter(
        (sector) =>
          sector !== MAP_WAKE_ISLAND_SECTOR && sectorGridPosition(sector) !== null,
      )
      .map((sector) => sectorGeometry(sector).center),
    ...wakeIslandGeometry(),
  });

/**
 * Wake Island's radial override in worldgen units: its centre, the island radius
 * (sized by the nearest neighbour centre) and the ocean moat radius that covers its
 * four neighbours' corners. The land blends back into the natural field over one
 * island radius beyond the moat.
 */
export const wakeIslandGeometry = () => {
  const wakeIslandCenter = sectorGeometry(MAP_WAKE_ISLAND_SECTOR).center;
  const distanceToWake = (point: Vec3) =>
    Math.hypot(
      wakeIslandCenter.x - point.x,
      wakeIslandCenter.y - point.y,
      wakeIslandCenter.z - point.z,
    );
  const wakeNeighbors = sectorGridNeighbors(MAP_WAKE_ISLAND_SECTOR)
    .filter((sector) => sector >= 0)
    .map(sectorGeometry);
  return {
    wakeIslandCenter,
    wakeIslandRadius:
      Math.min(...wakeNeighbors.map(({ center }) => distanceToWake(center))) *
      WORLDGEN_WAKE_ISLAND_RADIUS_FACTOR,
    wakeMoatRadius: Math.max(
      ...wakeNeighbors.flatMap(({ corners }) => corners.map(distanceToWake)),
    ),
  };
};

/**
 * Deterministic climate temperature. Latitude supplies the broad energy
 * gradient, while two noise scales and elevation make the isotherms irregular
 * instead of tracing exact rows around the globe.
 */
export const globalTemperature = (p: Vec3, elevation = 0): number => {
  const latitude = Math.asin(Math.max(-1, Math.min(1, p.y / WORLDGEN_RADIUS)));
  const latitudeCooling = (Math.abs(latitude) / (Math.PI / 2)) ** 1.18;
  const coarse = 1 / 16;
  const detail = 1 / 7;
  return (
    0.82 -
    latitudeCooling * 1.72 +
    temperatureNoise(p.x * coarse, p.y * coarse, p.z * coarse) * 0.38 +
    temperatureDetailNoise(p.x * detail, p.y * detail, p.z * detail) * 0.12 -
    Math.max(0, elevation) * 0.18
  );
};

/**
 * Moisture is independent of temperature, allowing dry continental interiors,
 * wet tropics, and irregular rain-shadow-like patches at the same latitude.
 */
export const globalMoisture = (p: Vec3, elevation = 0): number => {
  const coarse = 1 / 14;
  const detail = 1 / 5.5;
  const equatorialHumidity = 0.12 * (1 - Math.abs(p.y) / WORLDGEN_RADIUS);
  return (
    moistureNoise(p.x * coarse, p.y * coarse, p.z * coarse) * 0.72 +
    moistureDetailNoise(p.x * detail, p.y * detail, p.z * detail) * 0.28 +
    equatorialHumidity -
    Math.max(0, elevation) * 0.08
  );
};

/** Global-map terrain id: 0 ocean, 1 grass, 2 desert, 3 ice. */
export const globalBiomeType = (p: Vec3, land: boolean, elevation = 0): number => {
  if (!land) return 0;
  const temperature = globalTemperature(p, elevation);
  const moisture = globalMoisture(p, elevation);
  if (temperature < -0.14) return 3;
  if (temperature > 0.12 && moisture < -0.08) return 2;
  return 1;
};
