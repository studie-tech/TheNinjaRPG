import type { KessenFaction } from "@/validators/itemCard";
import type { KessenKnobs, Row } from "./types";

/**
 * Version of the match rules. Stored on every match; the pinned rules fingerprint in
 * `tests/libs/kessen/replay.test.ts` fails on any rule change until this is bumped.
 */
export const CARD_ENGINE_VERSION = 3;

/** Board rows from the centre line outward; also the canonical row order. */
export const ROWS: readonly Row[] = ["CLOSE", "RANGED", "JUTSU"];

export const LANTERNS = 2;
export const START_HAND = 10;
export const LAST_ROUND = 3;
/** Cards drawn at the start of Round 2 and Round 3. */
export const ROUND_DRAWS: Readonly<Record<number, number>> = { 2: 2, 3: 1 };

/** The Opening Gambit token's item id; created by the engine, never in a deck. */
export const TOKEN_CARD_ID = "kessen-token-shadow-clone";
/** Row the Opening Gambit's Shadow Clone starts on, on the Round 1 opener's side. */
export const GAMBIT_ROW: Row = "CLOSE";
/** Prefix of token instance ids (`t-1`, `t-2`, ...). */
export const TOKEN_PREFIX = "t-";

/** Default rule knobs, balanced through round-robin AI sweeps; a match can override any of them. */
export const DEFAULT_KNOBS: Readonly<KessenKnobs> = {
  handCap: 10,
  maxBanked: 3,
  rowCap: 5,
  r1Mulligans: 3,
  laterMulligans: 1,
  gambitPower: 3,
  terrainPenalty: 2,
  meditateCap: 6,
  bondStep: 2,
  bondCap: 4,
  purgeThreshold: 10,
  sunBonus: 1,
  evergreen: false,
  evergreenReset: true,
  permafrost: true,
  permafrostR3: true,
  tideCount: 1,
  tideMaxPower: 2,
  tailwind: 1,
  riggedOdds: true,
  riggedOddsR3: true,
};

/**
 * Hyorin's Permafrost: Terrain cast by a Hyorin seat afflicts only the enemy's side, in
 * Round 3 too unless `permafrostR3` is off.
 */
export const permafrostHolds = (
  faction: KessenFaction | null | undefined,
  round: number,
  knobs: Pick<KessenKnobs, "permafrost" | "permafrostR3">,
) =>
  faction === "HYORIN" &&
  knobs.permafrost &&
  (round < LAST_ROUND || knobs.permafrostR3);
