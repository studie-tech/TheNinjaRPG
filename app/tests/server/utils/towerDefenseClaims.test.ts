import { afterEach, describe, expect, it, vi } from "bun:test";
import {
  applyAction,
  createRun,
  stepRun,
  type TdAction,
  type TdRunConfig,
} from "@/libs/towerDefense/sim";
import {
  checkTowerDefenseClaimTiming,
  reserveTowerDefenseReplay,
  TD_TOKEN_LIFETIME_MS,
  TOWER_DEFENSE_REPLAY_LIMIT_MESSAGE,
  towerDefenseReplayCost,
  verifyTowerDefenseRun,
} from "@/server/utils/towerDefenseClaims";
import {
  generateRunNonce,
  signRunToken,
  verifyRunToken,
} from "@/server/utils/towerDefenseCrypto";
import { TD_MAX_TICKS, type TowerDefenseRunToken } from "@/validators/towerDefense";
import { botAct } from "../../libs/towerDefense/bot";
import { stubRateLimitTransport } from "../../setup/rateLimit";

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
  it("pays out exactly what the replay earned", async () => {
    const payload = token();
    const { state, log } = play(payload);
    expect(state.over).toBe(true);
    const result = await verifyTowerDefenseRun({
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

  it("accepts a retreat and pays the scrolls banked so far", async () => {
    const payload = token({ seed: "retreat" });
    const { state, log } = play(payload, 900);
    expect(state.quit).toBe(true);
    const result = await verifyTowerDefenseRun({
      token: payload,
      actions: log,
      endTick: state.tick,
      now: payload.issuedAt + 10 * 60_000,
    });
    expect(result.ok).toBe(true);
  });

  it("refuses runs simulated faster than the unlocked game speed", async () => {
    const payload = token({ seed: "fast" });
    const { state, log } = play(payload);
    const realTime = (state.tick * 100) / 1;
    const early = await verifyTowerDefenseRun({
      token: payload,
      actions: log,
      endTick: state.tick,
      now: payload.issuedAt + realTime / 3,
    });
    expect(early.ok).toBe(false);
    const sped = await verifyTowerDefenseRun({
      token: { ...payload, dojo: { ...payload.dojo, speed: 4 } },
      actions: log,
      endTick: state.tick,
      now: payload.issuedAt + realTime / 3,
    });
    // Time Dilation never changes the simulation, only how fast it may be played.
    expect(sped.ok).toBe(true);
  });

  it("refuses a run that has not ended, or that ends elsewhere", async () => {
    const payload = token({ seed: "unfinished" });
    const { state, log } = play(payload);
    const now = payload.issuedAt + state.tick * 100 + 60_000;
    expect(
      (
        await verifyTowerDefenseRun({
          token: payload,
          actions: log,
          endTick: state.tick - 50,
          now,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await verifyTowerDefenseRun({
          token: payload,
          actions: log,
          endTick: state.tick + 50,
          now,
        })
      ).ok,
    ).toBe(false);
  });

  it("refuses a log that names a different run's actions", async () => {
    const payload = token({ seed: "original" });
    const { state, log } = play(payload);
    const result = await verifyTowerDefenseRun({
      token: { ...payload, seed: "other" },
      actions: log,
      endTick: state.tick,
      now: payload.issuedAt + state.tick * 100 + 60_000,
    });
    expect(
      result.ok && result.wave === state.wave && result.kills === state.kills,
    ).toBe(false);
  });

  it("refuses expired tokens", async () => {
    const payload = token({ seed: "expired" });
    const { state, log } = play(payload);
    const result = await verifyTowerDefenseRun({
      token: payload,
      actions: log,
      endTick: state.tick,
      now: payload.issuedAt + TD_TOKEN_LIFETIME_MS + 1,
    });
    expect(result.ok).toBe(false);
  });

  it("replays in slices that yield to the event loop and never change the result", async () => {
    const payload = token({ seed: "sliced" });
    const { state, log } = play(payload);
    const claim = {
      token: payload,
      actions: log,
      endTick: state.tick,
      now: payload.issuedAt + state.tick * 100 + 60_000,
    };
    let yielded = false;
    setImmediate(() => {
      yielded = true;
    });
    const sliced = await verifyTowerDefenseRun({ ...claim, sliceTicks: 97 });
    expect(yielded).toBe(true);
    const whole = await verifyTowerDefenseRun({
      ...claim,
      sliceTicks: Number.POSITIVE_INFINITY,
    });
    expect(sliced).toEqual(whole);
    expect(sliced).toEqual({
      ok: true,
      wave: state.wave,
      kills: state.kills,
      points: Math.floor(state.scrolls),
    });
  });
});

describe("tower defense claim pre-checks", () => {
  afterEach(() => vi.restoreAllMocks());

  it("refuses an impossible length or an expired token from the token alone", () => {
    const payload = token({ seed: "timing" });
    const tenMinutes = payload.issuedAt + 10 * 60_000;
    expect(
      checkTowerDefenseClaimTiming({ token: payload, endTick: 6_000, now: tenMinutes }),
    ).toBeNull();
    // Ten minutes at 1x is 6,000 ticks; thirty seconds of slack is not twice that.
    expect(
      checkTowerDefenseClaimTiming({
        token: payload,
        endTick: 12_000,
        now: tenMinutes,
      }),
    ).toMatchObject({ permanent: false });
    expect(
      checkTowerDefenseClaimTiming({
        token: { ...payload, dojo: { speed: 4 } },
        endTick: 12_000,
        now: tenMinutes,
      }),
    ).toBeNull();
    expect(
      checkTowerDefenseClaimTiming({
        token: payload,
        endTick: 0,
        now: payload.issuedAt + TD_TOKEN_LIFETIME_MS + 1,
      }),
    ).toMatchObject({ permanent: true });
  });

  it("reserves replays through their own limiter", async () => {
    stubRateLimitTransport({ unexpectedRequestMessage: "Unexpected request" });
    expect(await reserveTowerDefenseReplay("td-replay-open", 0)).toBe(true);
    vi.restoreAllMocks();
    stubRateLimitTransport({
      unexpectedRequestMessage: "Unexpected request",
      remaining: () => -1,
    });
    expect(await reserveTowerDefenseReplay("td-replay-spent", 0)).toBe(false);
  });

  it("charges a replay by the ticks it covers", async () => {
    expect(towerDefenseReplayCost(0)).toBe(1);
    expect(towerDefenseReplayCost(50_000)).toBe(1);
    expect(towerDefenseReplayCost(50_001)).toBe(2);
    expect(towerDefenseReplayCost(TD_MAX_TICKS)).toBe(10);
    const fetch = stubRateLimitTransport({ unexpectedRequestMessage: "Unexpected" });
    await reserveTowerDefenseReplay("td-replay-weighted", 120_000);
    const body = String(fetch.mock.calls[0]?.[1]?.body);
    // The limiter script receives the claim's cost as its increment, its last argument.
    const command = JSON.parse(body) as unknown[];
    const args = (Array.isArray(command[0]) ? command[0] : command) as unknown[];
    expect(args.at(-1)).toBe(3);
  });

  it("refuses an over-limit claim without asserting the run is saved", () => {
    // The server cannot know whether the player's device still holds the run.
    expect(TOWER_DEFENSE_REPLAY_LIMIT_MESSAGE).not.toMatch(/saved/i);
  });
});
