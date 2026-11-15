import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  towerDefenseClaimReceipt,
  towerDefenseRun,
  userData,
  userTowerDefenseUpgrade,
} from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { encodeTdActions } from "@/libs/towerDefense/actionLog";
import {
  applyAction,
  createRun,
  stepRun,
  type TdAction,
  type TdRunConfig,
  tdDojoCost,
} from "@/libs/towerDefense/sim";
import { towerDefenseRouter } from "@/server/api/routers/towerDefense";
import { botAct } from "../../../libs/towerDefense/bot";
import { insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

/** Play a signed run with the test bot until the hero falls. */
const play = (config: TdRunConfig) => {
  const state = createRun(config);
  const log: TdAction[] = [];
  let value = 5;
  const rng = () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
  while (!state.over && state.tick < 40_000) {
    log.push(...botAct(state, { rng, attention: 0.8 }));
    stepRun(state);
  }
  if (!state.over) {
    const quit: TdAction = [state.tick, "quit"];
    applyAction(state, quit);
    log.push(quit);
  }
  return { state, log };
};

const progress = async (userId: string) => {
  const database = await getTestDatabase();
  const [row] = await database
    .select({
      points: userData.towerDefensePoints,
      bestWave: userData.towerDefenseBestWave,
    })
    .from(userData)
    .where(eq(userData.userId, userId));
  return row;
};

describeWithDatabase("tower defense runs and the Dojo", () => {
  const configured = env.TOWER_DEFENSE_CLAIMS_ENABLED;
  beforeEach(async () => {
    env.TOWER_DEFENSE_CLAIMS_ENABLED = "true";
    await resetTables(
      towerDefenseClaimReceipt,
      towerDefenseRun,
      userTowerDefenseUpgrade,
      userData,
    );
    await insertUsers([
      { userId: "td-user", towerDefensePoints: 500, towerDefenseBestWave: 45 },
      { userId: "td-other" },
    ]);
    stubRateLimitTransport();
  });
  afterEach(() => {
    Object.assign(env, { TOWER_DEFENSE_CLAIMS_ENABLED: configured });
    vi.restoreAllMocks();
  });

  it("only starts runs from unlocked checkpoints", async () => {
    const api = await callerFor(towerDefenseRouter, "td-user");
    expect((await api.startRun({ startWave: 41 })).success).toBe(false);
    const started = await api.startRun({ startWave: 31 });
    expect(started.success).toBe(true);
    expect(started.config).toMatchObject({ startWave: 31, bestWave: 45 });
  });

  it("pays a replayed run once, raises the best wave and records the leaderboard", async () => {
    const api = await callerFor(towerDefenseRouter, "td-user");
    const started = await api.startRun({ startWave: 1 });
    if (!started.token || !started.config) throw new Error("Run did not start");
    const { state, log } = play(started.config as TdRunConfig);
    // Pretend the run took as long as it really plays.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + state.tick * 100 + 60_000);
    const claim = {
      token: started.token,
      actions: encodeTdActions(log),
      endTick: state.tick,
    };
    const first = await api.claimRun(claim);
    expect(first).toMatchObject({
      success: true,
      wave: state.wave,
      kills: state.kills,
      pointsEarned: Math.floor(state.scrolls),
    });
    expect(await progress("td-user")).toEqual({
      points: 500 + Math.floor(state.scrolls),
      bestWave: Math.max(45, state.wave),
    });
    const again = await api.claimRun(claim);
    expect(again).toMatchObject({
      success: false,
      alreadyClaimed: true,
      wave: state.wave,
      pointsEarned: Math.floor(state.scrolls),
    });
    // A repeat is answered from the receipt before any replay: even a log that could
    // never verify gets the same answer.
    expect(await api.claimRun({ ...claim, actions: "" })).toMatchObject({
      alreadyClaimed: true,
    });
    expect(await progress("td-user")).toEqual({
      points: 500 + Math.floor(state.scrolls),
      bestWave: Math.max(45, state.wave),
    });
    const leaderboard = await api.getLeaderboard({ limit: 5 });
    expect(leaderboard).toHaveLength(1);
    expect(leaderboard[0]).toMatchObject({
      userId: "td-user",
      wave: state.wave,
      score: state.kills,
    });
  });

  it("refuses another player's token, a run that ends elsewhere and paused claims", async () => {
    const api = await callerFor(towerDefenseRouter, "td-user");
    const other = await callerFor(towerDefenseRouter, "td-other");
    const started = await api.startRun({ startWave: 1 });
    if (!started.token || !started.config) throw new Error("Run did not start");
    const { state, log } = play(started.config as TdRunConfig);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + state.tick * 100 + 60_000);
    expect(
      (
        await other.claimRun({
          token: started.token,
          actions: encodeTdActions(log),
          endTick: state.tick,
        })
      ).success,
    ).toBe(false);
    expect(
      (
        await api.claimRun({
          token: started.token,
          actions: encodeTdActions(log),
          endTick: state.tick - 1,
        })
      ).success,
    ).toBe(false);
    env.TOWER_DEFENSE_CLAIMS_ENABLED = undefined;
    expect(
      await api.claimRun({
        token: started.token,
        actions: encodeTdActions(log),
        endTick: state.tick,
      }),
    ).toMatchObject({ success: false, claimsPaused: true });
    expect(await progress("td-user")).toEqual({ points: 500, bestWave: 45 });
  });

  it("buys Dojo levels with scrolls and refuses locked or unaffordable ones", async () => {
    const api = await callerFor(towerDefenseRouter, "td-user");
    const bought = await api.purchaseDojoUpgrade({ upgradeId: "dmg" });
    expect(bought).toMatchObject({
      success: true,
      level: 1,
      pointsSpent: tdDojoCost("dmg", 0),
    });
    expect((await api.getProgress()).points).toBe(500 - tdDojoCost("dmg", 0));
    expect((await api.getProgress()).dojo.dmg).toBe(1);
    expect((await api.purchaseDojoUpgrade({ upgradeId: "ul_tempest" })).success).toBe(
      false,
    );
    expect((await api.purchaseDojoUpgrade({ upgradeId: "perk_choices" })).success).toBe(
      false,
    );
    const database = await getTestDatabase();
    await database
      .update(userData)
      .set({ towerDefensePoints: 0 })
      .where(eq(userData.userId, "td-user"));
    expect((await api.purchaseDojoUpgrade({ upgradeId: "hp" })).success).toBe(false);
    expect((await api.getProgress()).dojo.hp).toBeUndefined();
  });
});
