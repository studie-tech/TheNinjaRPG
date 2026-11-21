/**
 * Chakra Storm claim verification.
 *
 * A claim pays out only what the server itself computes: the signed run token fixes the
 * seed, region and Training Hall levels, and the deterministic simulation replays the
 * submitted action log to the run's end. A forged log can only describe a run that really
 * plays out that way, and the elapsed-time check stops logs simulated faster than the
 * game is played.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/env/server.mjs";
import { CS_TPS, csIntelFor, csNoTraining } from "@/libs/chakraStorm/content";
import {
  advanceCsReplay,
  type CsAction,
  createCsReplay,
  csSeconds,
} from "@/libs/chakraStorm/sim";
import { strictRateLimit } from "@/server/utils/rateLimit";
import type { ChakraStormRunToken } from "@/validators/chakraStorm";

export const CHAKRA_STORM_CLAIMS_PAUSED_MESSAGE =
  "Chakra Storm rewards are temporarily paused.";
export const CHAKRA_STORM_REPLAY_LIMIT_MESSAGE =
  "Too many runs verified recently. Claim this run again in a few minutes.";

/** Tokens older than this can no longer be claimed. */
export const CS_TOKEN_LIFETIME_MS = 2 * 24 * 60 * 60 * 1000;
/** Allowance for clock skew and the request round trip in the elapsed-time check. */
const CS_TIME_SLACK_MS = 30_000;
/**
 * Replay units a player may spend per window; a full fifteen-minute run costs three, a
 * quick retreat one, so steady play never meets the limit while scripted floods do.
 */
const CS_REPLAY_UNITS_PER_WINDOW = 30;
const CS_REPLAY_TICKS_PER_UNIT = 6_000;
/** Ticks a claim replays between yields to the event loop. */
const CS_REPLAY_SLICE_TICKS = 2_000;

const replayLimiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(CS_REPLAY_UNITS_PER_WINDOW, "10 m"),
  prefix: "trpc-ratelimit-cs-replay",
});

/** The limiter units a claim replaying `endTick` ticks spends. */
export const chakraStormReplayCost = (endTick: number): number =>
  Math.max(1, Math.ceil(endTick / CS_REPLAY_TICKS_PER_UNIT));

/** Reserve a claim replay of `endTick` ticks for a player through the shared Redis limiter. */
export const reserveChakraStormReplay = (userId: string, endTick: number) =>
  strictRateLimit("replay", () =>
    replayLimiter.limit(userId, { rate: chakraStormReplayCost(endTick) }),
  );

/**
 * Claims stay off unless `CHAKRA_STORM_CLAIMS_ENABLED` is exactly "true". The switch is
 * checked inside the procedure, so it covers every caller.
 */
export const areChakraStormClaimsEnabled = (): boolean =>
  env.CHAKRA_STORM_CLAIMS_ENABLED === "true";

/** The receipt key for a claim; the nonce is server-generated and signed into the token. */
export const chakraStormClaimKey = (nonce: string): string => `run:${nonce}`;

/**
 * Refuse what the token and claimed length alone rule out: an expired token, or a run
 * longer than the time since it started allows, since the game plays in real time. An
 * expired token stays expired; a run that seems too fast can pass later.
 */
export const checkChakraStormClaimTiming = (input: {
  token: ChakraStormRunToken;
  endTick: number;
  now: number;
}): { message: string; permanent: boolean } | null => {
  const elapsed = input.now - input.token.issuedAt;
  if (elapsed > CS_TOKEN_LIFETIME_MS)
    return { message: "This run is too old to claim.", permanent: true };
  if (elapsed < (input.endTick * 1000) / CS_TPS - CS_TIME_SLACK_MS)
    return {
      message: "This run finished faster than the game can be played.",
      permanent: false,
    };
  return null;
};

export type ChakraStormClaimResult =
  | {
      ok: true;
      seconds: number;
      kills: number;
      level: number;
      won: boolean;
      bosses: number;
      intel: number;
    }
  | { ok: false; message: string };

/**
 * Replay a claimed run and decide what it earned. The replay advances in slices and
 * yields between them; slicing never changes the result.
 */
export const verifyChakraStormRun = async (input: {
  token: ChakraStormRunToken;
  actions: readonly [number, CsAction][];
  endTick: number;
  sliceTicks?: number;
}): Promise<ChakraStormClaimResult> => {
  const { token, endTick } = input;
  const replay = createCsReplay(
    token.seed,
    { stage: token.stage, training: { ...csNoTraining(), ...token.training } },
    input.actions,
  );
  const slice = input.sliceTicks ?? CS_REPLAY_SLICE_TICKS;
  while (!advanceCsReplay(replay, endTick, slice))
    await new Promise<void>((resolve) => setImmediate(resolve));
  const { state } = replay;
  if (replay.invalid)
    return { ok: false, message: "The run's action log does not match its replay." };
  // The timing check trusted the claimed end tick; the replay must end exactly there.
  if (!state.over || state.tick !== endTick)
    return { ok: false, message: "This run has not ended yet." };
  const run = {
    seconds: Math.floor(csSeconds(state)),
    kills: state.kills,
    level: state.hero.level,
    won: state.won,
    bosses: state.bossesKilled,
  };
  return { ok: true, ...run, intel: csIntelFor({ ...run, stage: token.stage }) };
};
