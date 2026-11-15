/**
 * Tower-defense claim verification.
 *
 * A claim pays out only what the server itself computes: the signed run token fixes the
 * seed and configuration, and the deterministic simulation replays the submitted action
 * log to the run's end. A forged log can only describe a run that really plays out that
 * way, and the elapsed-time check stops logs simulated faster than the game can be played.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "@/env/server.mjs";
import { TD_TPS, tdMaxSpeed } from "@/libs/towerDefense/balance";
import {
  advanceReplay,
  createReplay,
  type TdAction,
  type TdReplayResult,
  tdRunPoints,
} from "@/libs/towerDefense/sim";
import { TD_MAX_TICKS, type TowerDefenseRunToken } from "@/validators/towerDefense";

export const TOWER_DEFENSE_CLAIMS_PAUSED_MESSAGE =
  "Tower defense rewards are temporarily paused.";

/** Tokens older than this can no longer be claimed. */
export const TD_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** Allowance for clock skew and the request round trip in the elapsed-time check. */
const TD_TIME_SLACK_MS = 30_000;
/** Replays a player may request per window; each can cost a second or more of CPU. */
const TD_REPLAYS_PER_WINDOW = 10;
/**
 * Ticks a claim replays between yields to the event loop. A slice takes tens of
 * milliseconds, so a long replay never holds up the other requests on the instance.
 */
const TD_REPLAY_SLICE_TICKS = 10_000;

export const TOWER_DEFENSE_REPLAY_LIMIT_MESSAGE =
  "Too many runs verified recently. Your run is saved; claim it again in a few minutes.";

const replayLimiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(TD_REPLAYS_PER_WINDOW, "10 m"),
  prefix: "trpc-ratelimit-td-replay",
});

/**
 * Reserve one claim replay for a player. Like the shared tRPC limiter, an unreachable
 * Redis fails open in development and closed elsewhere.
 */
export const reserveTowerDefenseReplay = async (userId: string): Promise<boolean> => {
  try {
    return (await replayLimiter.limit(userId)).success;
  } catch (error) {
    if (process.env.NODE_ENV !== "development") throw error;
    console.warn("Tower defense replay limiter unavailable in development", error);
    return true;
  }
};

/**
 * Claims stay off unless `TOWER_DEFENSE_CLAIMS_ENABLED` is exactly "true". The switch is
 * checked inside the procedure, so it covers every caller.
 */
export const areTowerDefenseClaimsEnabled = (): boolean =>
  env.TOWER_DEFENSE_CLAIMS_ENABLED === "true";

/** The receipt key for a claim; the nonce is server-generated and signed into the token. */
export const towerDefenseClaimKey = (nonce: string): string => `run:${nonce}`;

export type TowerDefenseClaimResult =
  | { ok: true; wave: number; kills: number; points: number }
  | { ok: false; message: string };

/**
 * Refuse what the token and claimed length alone rule out: an expired token, or a run
 * longer than the time since it started allows at the unlocked game speed. It costs
 * nothing, so it runs before the replay. An expired token stays expired; a run that
 * seems too fast can pass later, once the elapsed time covers it.
 */
export const checkTowerDefenseClaimTiming = (input: {
  token: TowerDefenseRunToken;
  endTick: number;
  now: number;
}): { message: string; permanent: boolean } | null => {
  const elapsed = input.now - input.token.issuedAt;
  if (elapsed > TD_TOKEN_LIFETIME_MS)
    return { message: "This run is too old to claim.", permanent: true };
  const fastestMs =
    (input.endTick * 1000) / TD_TPS / tdMaxSpeed(input.token.dojo.speed ?? 0) -
    TD_TIME_SLACK_MS;
  if (elapsed < fastestMs)
    return {
      message: "This run finished faster than the game can be played.",
      permanent: false,
    };
  return null;
};

/**
 * Replay a claimed run and decide what it earned. The replay advances in slices of
 * `sliceTicks` and yields between them; slicing never changes the result.
 */
export const verifyTowerDefenseRun = async (input: {
  token: TowerDefenseRunToken;
  actions: readonly TdAction[];
  endTick: number;
  now: number;
  sliceTicks?: number;
}): Promise<TowerDefenseClaimResult> => {
  const { token, actions, endTick } = input;
  const refused = checkTowerDefenseClaimTiming(input);
  if (refused) return { ok: false, message: refused.message };
  const replay = createReplay(
    {
      seed: token.seed,
      startWave: token.startWave,
      bestWave: token.bestWave,
      dojo: token.dojo,
    },
    actions,
  );
  const slice = {
    maxTicks: TD_MAX_TICKS,
    ticks: input.sliceTicks ?? TD_REPLAY_SLICE_TICKS,
  };
  let result: TdReplayResult | null = advanceReplay(replay, endTick, slice);
  while (!result) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    result = advanceReplay(replay, endTick, slice);
  }
  const { state, stop, invalidAt } = result;
  if (invalidAt !== null)
    return { ok: false, message: "The run's action log does not match its replay." };
  // The timing check trusted the claimed end tick; the replay must end exactly there.
  if (stop !== "over" || state.tick !== endTick)
    return { ok: false, message: "This run has not ended yet." };
  return {
    ok: true,
    wave: state.wave,
    kills: state.kills,
    points: Math.max(0, Math.min(1_000_000_000, tdRunPoints(state))),
  };
};
