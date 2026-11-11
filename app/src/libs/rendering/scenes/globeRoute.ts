import type { GlobalPoint } from "@/libs/sector-map/world-types";
import type { GlobeJourney } from "@/validators/travel";

/** One shared great-circle path for the route ribbon and its moving character. */
export const createGlobeArc = (from: GlobalPoint, to: GlobalPoint, radius: number) => {
  const { start, toward, across } = greatCircleBasis(from, to);
  const angle = angleBetween(from, to);
  return {
    angle,
    across,
    at: (progress: number): GlobalPoint => {
      const t = Math.max(0, Math.min(1, progress));
      const a = Math.cos(t * angle),
        b = Math.sin(t * angle);
      const height =
        radius * (1.006 + Math.sin(Math.PI * t) * Math.min(0.12, angle * 0.1));
      return {
        x: (start.x * a + toward.x * b) * height,
        y: (start.y * a + toward.y * b) * height,
        z: (start.z * a + toward.z * b) * height,
      };
    },
  };
};

/** Deadline-based progress resumes at the correct position after delays or a reload. */
export const globeJourneyProgress = (journey: GlobeJourney, serverNow: number) =>
  journey.durationMs <= 0
    ? 1
    : Math.max(0, Math.min(1, 1 - (journey.finishAt - serverNow) / journey.durationMs));

const unit = (point: GlobalPoint) => {
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  return { x: point.x / length, y: point.y / length, z: point.z / length };
};

/**
 * Orthonormal frame of the great circle from `from` to `to`: the arc point at angle θ is
 * `start·cos θ + toward·sin θ`, and `across` is its normal. Every sector has an exact
 * antipode on the symmetric hexasphere, where the plane through both points is undefined;
 * the arc then bends toward the north pole (or the x axis from a pole).
 */
export const greatCircleBasis = (from: GlobalPoint, to: GlobalPoint) => {
  const start = unit(from);
  // The part of a direction perpendicular to start, kept once it is long enough to normalise.
  const perpendicular = (point: GlobalPoint, minimum: number) => {
    const along = start.x * point.x + start.y * point.y + start.z * point.z;
    const rest = {
      x: point.x - start.x * along,
      y: point.y - start.y * along,
      z: point.z - start.z * along,
    };
    return Math.hypot(rest.x, rest.y, rest.z) > minimum ? unit(rest) : null;
  };
  const toward =
    perpendicular(unit(to), 1e-6) ??
    perpendicular({ x: 0, y: 1, z: 0 }, 0.1) ??
    perpendicular({ x: 1, y: 0, z: 0 }, 0.1) ??
    start;
  const across = {
    x: start.y * toward.z - start.z * toward.y,
    y: start.z * toward.x - start.x * toward.z,
    z: start.x * toward.y - start.y * toward.x,
  };
  return { start, toward, across };
};

const angleBetween = (a: GlobalPoint, b: GlobalPoint) => {
  const ua = unit(a),
    ub = unit(b);
  return Math.acos(Math.max(-1, Math.min(1, ua.x * ub.x + ua.y * ub.y + ua.z * ub.z)));
};
