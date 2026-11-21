/** A short travel beat shared by replay scheduling and the battlefield renderer. */
export const projectileTravelMs = (from: ProjectilePosition, to: ProjectilePosition) =>
  Math.round(
    Math.min(
      650,
      100 +
        Math.hypot(to.longitude - from.longitude, to.latitude - from.latitude) * 110,
    ),
  );

type ProjectilePosition = { longitude: number; latitude: number };
