/**
 * Tower-defense claim verification.
 *
 * A claim pays out only what the server itself computes: the signed run token fixes the
 * seed and configuration, and the deterministic simulation replays the submitted action
 * log to the run's end. A forged log can only describe a run that really plays out that
 * way, and the elapsed-time check stops logs simulated faster than the game can be played.
 */

import { env } from "@/env/server.mjs";
import { TD_TPS, tdMaxSpeed } from "@/libs/towerDefense/balance";
import { replayRun, type TdAction, tdRunPoints } from "@/libs/towerDefense/sim";
import { TD_MAX_TICKS, type TowerDefenseRunToken } from "@/validators/towerDefense";

export const TOWER_DEFENSE_CLAIMS_PAUSED_MESSAGE =
  "Tower defense rewards are temporarily paused.";

/** Tokens older than this can no longer be claimed. */
export const TD_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
/** Allowance for clock skew and the request round trip in the elapsed-time check. */
const TD_TIME_SLACK_MS = 30_000;

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

/** Replay a claimed run and decide what it earned. */
export const verifyTowerDefenseRun = (input: {
  token: TowerDefenseRunToken;
  actions: readonly TdAction[];
  endTick: number;
  now: number;
}): TowerDefenseClaimResult => {
  const { token, actions, endTick, now } = input;
  const elapsed = now - token.issuedAt;
  if (elapsed > TD_TOKEN_LIFETIME_MS)
    return { ok: false, message: "This run is too old to claim." };
  const { state, stop, invalidAt } = replayRun(
    {
      seed: token.seed,
      startWave: token.startWave,
      bestWave: token.bestWave,
      dojo: token.dojo,
    },
    actions,
    endTick,
    { maxTicks: TD_MAX_TICKS },
  );
  if (invalidAt !== null)
    return { ok: false, message: "The run's action log does not match its replay." };
  if (stop !== "over" || state.tick !== endTick)
    return { ok: false, message: "This run has not ended yet." };
  const fastestMs =
    (state.tick * 1000) / TD_TPS / tdMaxSpeed(token.dojo.speed ?? 0) - TD_TIME_SLACK_MS;
  if (elapsed < fastestMs)
    return {
      ok: false,
      message: "This run finished faster than the game can be played.",
    };
  return {
    ok: true,
    wave: state.wave,
    kills: state.kills,
    points: Math.max(0, Math.min(1_000_000_000, tdRunPoints(state))),
  };
};
