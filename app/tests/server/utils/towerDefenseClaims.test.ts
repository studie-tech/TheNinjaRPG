import { describe, expect, it } from "bun:test";
import {
  applyAction,
  createRun,
  stepRun,
  type TdAction,
  type TdRunConfig,
} from "@/libs/towerDefense/sim";
import {
  TD_TOKEN_LIFETIME_MS,
  verifyTowerDefenseRun,
} from "@/server/utils/towerDefenseClaims";
import {
  generateRunNonce,
  signRunToken,
  verifyRunToken,
} from "@/server/utils/towerDefenseCrypto";
import type { TowerDefenseRunToken } from "@/validators/towerDefense";
import { botAct } from "../../libs/towerDefense/bot";

const token = (
  overrides: Partial<TowerDefenseRunToken> = {},
): TowerDefenseRunToken => ({
  v: 1,
  userId: "td-user",
  nonce: generateRunNonce(),
  seed: "claim-seed",
  startWave: 1,
  bestWave: 0,
  dojo: { dmg: 3, hp: 3 },
  issuedAt: 1_000_000,
  ...overrides,
});

/** Play the token's run with the test bot until the hero falls. */
const play = (payload: TowerDefenseRunToken, quitAt?: number) => {
  const config: TdRunConfig = {
    seed: payload.seed,
    startWave: payload.startWave,
    bestWave: payload.bestWave,
    dojo: payload.dojo,
  };
  const state = createRun(config);
  const log: TdAction[] = [];
  let value = 11;
  const rng = () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
  while (!state.over && state.tick < 50_000) {
    if (quitAt !== undefined && state.tick === quitAt) {
      const quit: TdAction = [state.tick, "quit"];
      applyAction(state, quit);
      log.push(quit);
      break;
    }
    log.push(...botAct(state, { rng, attention: 0.8 }));
    stepRun(state);
  }
  return { state, log };
};

describe("tower defense run tokens", () => {
  it("round-trips a signed payload and rejects any alteration", () => {
    const payload = token();
    const signed = signRunToken(payload);
    expect(verifyRunToken(signed)).toEqual(payload);
    const [body, mac] = signed.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...payload, dojo: { dmg: 999 } }),
    ).toString("base64url");
    expect(verifyRunToken(`${forged}.${mac}`)).toBeNull();
    expect(verifyRunToken(`${body}.${mac}x`)).toBeNull();
    expect(verifyRunToken(`${body}`)).toBeNull();
    expect(verifyRunToken("not-a-token")).toBeNull();
  });
});

describe("tower defense claim verification", () => {
  it("pays out exactly what the replay earned", () => {
    const payload = token();
    const { state, log } = play(payload);
    expect(state.over).toBe(true);
    const result = verifyTowerDefenseRun({
      token: payload,
      actions: log,
      endTick: state.tick,
      now: payload.issuedAt + state.tick * 100 + 60_000,
    });
    expect(result).toEqual({
      ok: true,
      wave: state.wave,
      kills: state.kills,
      points: Math.floor(state.scrolls),
    });
  });

  it("accepts a retreat and pays the scrolls banked so far", () => {
    const payload = token({ seed: "retreat" });
    const { state, log } = play(payload, 900);
    expect(state.quit).toBe(true);
    const result = verifyTowerDefenseRun({
      token: payload,
      actions: log,
      endTick: state.tick,
      now: payload.issuedAt + 10 * 60_000,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses runs simulated faster than the unlocked game speed", () => {
    const payload = token({ seed: "fast" });
    const { state, log } = play(payload);
    const realTime = (state.tick * 100) / 1;
    const early = verifyTowerDefenseRun({
      token: payload,
      actions: log,
      endTick: state.tick,
      now: payload.issuedAt + realTime / 3,
    });
    expect(early.ok).toBe(false);
    const sped = verifyTowerDefenseRun({
      token: { ...payload, dojo: { ...payload.dojo, speed: 4 } },
      actions: log,
      endTick: state.tick,
      now: payload.issuedAt + realTime / 3,
    });
    // Time Dilation never changes the simulation, only how fast it may be played.
    expect(sped.ok).toBe(true);
  });

  it("refuses a run that has not ended, or that ends elsewhere", () => {
    const payload = token({ seed: "unfinished" });
    const { state, log } = play(payload);
    const now = payload.issuedAt + state.tick * 100 + 60_000;
    expect(
      verifyTowerDefenseRun({
        token: payload,
        actions: log,
        endTick: state.tick - 50,
        now,
      }).ok,
    ).toBe(false);
    expect(
      verifyTowerDefenseRun({
        token: payload,
        actions: log,
        endTick: state.tick + 50,
        now,
      }).ok,
    ).toBe(false);
  });

  it("refuses a log that names a different run's actions", () => {
    const payload = token({ seed: "original" });
    const { state, log } = play(payload);
    const result = verifyTowerDefenseRun({
      token: { ...payload, seed: "other" },
      actions: log,
      endTick: state.tick,
      now: payload.issuedAt + state.tick * 100 + 60_000,
    });
    expect(
      result.ok && result.wave === state.wave && result.kills === state.kills,
    ).toBe(false);
  });

  it("refuses expired tokens", () => {
    const payload = token({ seed: "expired" });
    const { state, log } = play(payload);
    const result = verifyTowerDefenseRun({
      token: payload,
      actions: log,
      endTick: state.tick,
      now: payload.issuedAt + TD_TOKEN_LIFETIME_MS + 1,
    });
    expect(result.ok).toBe(false);
  });
});
