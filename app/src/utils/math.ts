/**
 * min and max included
 */
export const randomInt = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

/** Unbiased integer in [0, maxExclusive), available in server and browser code. */
export const secureRandomInt = (maxExclusive: number) => {
  if (
    !Number.isInteger(maxExclusive) ||
    maxExclusive < 1 ||
    maxExclusive > 0x1_0000_0000
  )
    throw new RangeError("Random upper bound must be an integer from 1 through 2^32.");
  if (maxExclusive === 1) return 0;
  // Mask to the next power of two and reject excess values instead of rounding or modulo.
  const mask = 0xffff_ffff >>> Math.clz32(maxExclusive - 1);
  const values = crypto.getRandomValues(new Uint32Array(1));
  let value = ((values[0] ?? 0) & mask) >>> 0;
  while (value >= maxExclusive) {
    crypto.getRandomValues(values);
    value = ((values[0] ?? 0) & mask) >>> 0;
  }
  return value;
};

/**
 * Rounds a number to a specified number of decimal places.
 * @param value - The number to round.
 * @param decimals - The number of decimal places to round to.
 * @returns The rounded number.
 */
export const round = (value: number, decimals = 2) => {
  return Number(`${Math.round(Number(`${value}e${decimals}`))}e-${decimals}`);
};

/**
 * Clamp a value into the inclusive [min, max] range.
 */
export const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

/**
 * Calculates percentage clamped between 0 and 100.
 * @param current - The current value.
 * @param max - The maximum value (divisor). Defaults to 1 if 0 to avoid division by zero.
 * @returns The percentage value between 0 and 100.
 */
export const calculatePercent = (current: number, max: number): number => {
  const safeMax = max || 1;
  return clamp((current / safeMax) * 100, 0, 100);
};

/**
 * The first `uint32()` of `alea(...seeds)` for one or more seeds, bit for bit, without building
 * a generator (Alea seeds itself from the clock when given none). Scenery
 * draws one seeded number per tile and per sprite; constructing a full generator for each
 * showed in sector loads.
 */
export const aleaUint32 = (...seeds: (number | string)[]) => {
  let n = 0xefc8249d;
  const mash = (data: string) => {
    for (let i = 0; i < data.length; i++) {
      n += data.charCodeAt(i);
      let h = 0.02519603282416938 * n;
      n = h >>> 0;
      h -= n;
      h *= n;
      n = h >>> 0;
      h -= n;
      n += h * 0x100000000;
    }
    return (n >>> 0) * 2.3283064365386963e-10;
  };
  let s0 = mash(" ");
  mash(" ");
  mash(" ");
  // Only the first state word feeds the first output; the others still advance the hash.
  for (const seed of seeds) {
    const data = String(seed);
    s0 -= mash(data);
    if (s0 < 0) s0 += 1;
    mash(data);
    mash(data);
  }
  const t = 2091639 * s0 + 2.3283064365386963e-10;
  return (t - (t | 0)) * 0x100000000;
};
