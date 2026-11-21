/**
 * Deterministic randomness for Kessen.
 *
 * Matches replay on the server, in every browser and in balance bots, so the generator
 * uses only 32-bit integer operations (`Math.imul`, shifts, `>>> 0`) and never floats.
 */

/** The four 32-bit words of an sfc32 generator, JSON-serialisable. */
export type RngState = [number, number, number, number];

export interface Rng {
  /** Next unsigned 32-bit integer. */
  next: () => number;
  /** Uniform integer in [0, max) by rejection sampling; `max` in 1..2^32. */
  int: (max: number) => number;
  /** Snapshot that `rngFromState` resumes exactly. */
  state: () => RngState;
}

const UINT32 = 4294967296;

/** Mixes a string into four seed words (the tower-defense generator's hash). */
export const seedWords = (seed: string): RngState => {
  let h1 = 1779033703 ^ seed.length;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const code = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ code, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ code, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ code, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ code, 2716044179);
  }
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
};

/** Resumes an sfc32 generator from a snapshot. */
export const rngFromState = (initial: RngState): Rng => {
  let [a, b, c, d] = initial;
  const next = () => {
    const t = (((a + b) | 0) + d + 1) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
  const int = (max: number) => {
    if (!Number.isInteger(max) || max < 1 || max > UINT32) {
      throw new Error(`Invalid rng bound ${max}`);
    }
    const limit = UINT32 - (UINT32 % max);
    for (;;) {
      const value = next();
      if (value < limit) return value % max;
    }
  };
  const state = (): RngState => [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
  return { next, int, state };
};

/** A seeded sfc32 generator, warmed up so similar seeds diverge. */
export const createRng = (seed: string): Rng => {
  const rng = rngFromState(seedWords(seed));
  for (let i = 0; i < 12; i++) rng.next();
  return rng;
};

/**
 * A named stream of a match seed: `engine` (shuffle and coin), `ai:<seat>`,
 * `loaner:<seat>`. Streams never share state, so one consumer cannot shift another.
 */
export const createStream = (matchSeed: string, name: string) =>
  createRng(`${matchSeed}#${name}`);

/** In-place Fisher-Yates shuffle. */
export const shuffleInPlace = <T>(rng: Rng, items: T[]) => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const swap = items[i] as T;
    items[i] = items[j] as T;
    items[j] = swap;
  }
  return items;
};

/** 64-bit string hash as 16 hex characters (two independent 32-bit lanes). */
export const hashString = (text: string) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");
  return `${hex(h2)}${hex(h1)}`;
};
