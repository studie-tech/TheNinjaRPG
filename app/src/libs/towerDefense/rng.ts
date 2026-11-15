/**
 * Deterministic randomness and arithmetic for the tower-defense simulation.
 *
 * The simulation runs in every browser and again on the server when a run is claimed, so
 * it must produce bit-identical results across JavaScript engines. Alea uses only exactly
 * rounded arithmetic, and real powers use repeated multiplication: `Math.pow`, `Math.exp`
 * and the trigonometric functions are not specified to round identically across engines.
 */
import alea from "alea";

/** A seeded generator; `next` returns a float in [0, 1). */
export const createRng = (seed: string) => {
  const next = alea(seed);
  return {
    next,
    /** Integer in [0, max). */
    int: (max: number) => Math.floor(next() * max),
    /** Unit vector from rejection sampling, normalised with the exactly rounded sqrt. */
    direction: () => {
      for (;;) {
        const x = next() * 2 - 1,
          y = next() * 2 - 1,
          length = x * x + y * y;
        if (length > 0.01 && length <= 1) {
          const root = Math.sqrt(length);
          return { x: x / root, y: y / root };
        }
      }
    },
    /** A uniformly chosen element. */
    pick: <T>(items: readonly T[]): T => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error("Cannot pick from an empty list");
      return item;
    },
  };
};
export type Rng = ReturnType<typeof createRng>;

/** `base` raised to a non-negative integer power by repeated squaring. */
export const powi = (base: number, exponent: number) => {
  let result = 1,
    factor = base,
    n = Math.max(0, Math.floor(exponent));
  while (n > 0) {
    if (n & 1) result *= factor;
    factor *= factor;
    n >>= 1;
  }
  return result;
};

/** Geometric cost of buying level `level + 1`, rounded down. */
export const geometricCost = (base: number, growth: number, level: number) =>
  Math.floor(base * powi(growth, level));
