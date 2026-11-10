import {
  createSectorGridLandScore,
  globalContinentalness,
  globalElevation,
  globalMoisture,
  globalTemperature,
  WORLDGEN_LAND_THRESHOLD,
  WORLDGEN_RADIUS,
} from "@/libs/sector-map/worldgen";

/** Equirectangular texel grid of the globe climate field: 2.4x the globe's colour samples. */
export const GLOBE_CLIMATE_WIDTH = 1024;
export const GLOBE_CLIMATE_HEIGHT = 512;

/**
 * Value range packed into each RGBA8 channel, decoded by the globe shader as
 * `low + channel * (high - low)`. Land score is clamped close to the coast, where
 * the shader thresholds it at zero, so the shoreline keeps sub-texel precision.
 * Relief is land elevation on land; at sea it is the seabed, the natural continental
 * score without landmark overrides, so a landmark's carved moat is not drawn as a
 * hole of deep water.
 */
export const GLOBE_CLIMATE_RANGES = {
  land: [-0.5, 0.5],
  relief: [-1, 1],
  temperature: [-1, 1.25],
  moisture: [-1, 1],
} as const;

/**
 * The worldgen fields that decide each sector's biome (land score, relief,
 * temperature, moisture), sampled over the whole sphere. Row 0 is the north
 * pole and column 0 is longitude -180 degrees, matching the shader's lookup.
 * The globe paints biomes per pixel from it, so it can never disagree with
 * the land and climate decisions the sector maps make.
 */
export const buildGlobeClimate = (
  protectedSectors: readonly number[],
  width = GLOBE_CLIMATE_WIDTH,
  height = GLOBE_CLIMATE_HEIGHT,
) => {
  const landScore = createSectorGridLandScore([...protectedSectors]);
  const texels = new Uint8Array(width * height * 4);
  const ranges = GLOBE_CLIMATE_RANGES;
  for (let row = 0; row < height; row++) {
    const latitude = Math.PI / 2 - ((row + 0.5) / height) * Math.PI;
    const ring = WORLDGEN_RADIUS * Math.cos(latitude);
    const y = WORLDGEN_RADIUS * Math.sin(latitude);
    for (let column = 0; column < width; column++) {
      const longitude = ((column + 0.5) / width) * Math.PI * 2 - Math.PI;
      const point = { x: ring * Math.cos(longitude), y, z: ring * Math.sin(longitude) };
      const elevation = globalElevation(point);
      const land = landScore(point);
      const offset = (row * width + column) * 4;
      texels[offset] = pack(land, ranges.land);
      texels[offset + 1] = pack(
        land > 0 ? elevation : globalContinentalness(point) - WORLDGEN_LAND_THRESHOLD,
        ranges.relief,
      );
      texels[offset + 2] = pack(
        globalTemperature(point, elevation),
        ranges.temperature,
      );
      texels[offset + 3] = pack(globalMoisture(point, elevation), ranges.moisture);
    }
  }
  return texels;
};

const pack = (value: number, [low, high]: readonly [number, number]) =>
  Math.round(Math.max(0, Math.min(1, (value - low) / (high - low))) * 255);
