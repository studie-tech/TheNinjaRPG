/**
 * Deterministic randomness and arithmetic for the tower-defense simulation.
 *
 * The simulation runs in every browser and again on the server when a run is claimed, so
 * it must produce bit-identical results across JavaScript engines. Integer mixing uses
 * `Math.imul`, and real powers use repeated multiplication: `Math.pow`, `Math.exp` and the
 * trigonometric functions are not specified to round identically across engines.
 */

/** A seeded sfc32 generator; `next` returns a float in [0, 1). */
export const createRng = (seed: string) => {
  let h1 = 1779033703 ^ seed.length,
    h2 = 3144134277,
    h3 = 1013904242,
    h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const code = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  let a = h1 >>> 0,
    b = h2 >>> 0,
    c = h3 >>> 0,
    d = h4 >>> 0;
  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
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
