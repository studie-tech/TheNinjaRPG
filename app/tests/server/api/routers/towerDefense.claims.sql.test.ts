import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  towerDefenseClaimReceipt,
  towerDefenseRun,
  userData,
  userTowerDefenseUpgrade,
} from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { TD_SIM_VERSION, type TdRunConfig, tdDojoCost } from "@/libs/towerDefense/sim";
import { towerDefenseRouter } from "@/server/api/routers/towerDefense";
import { TOWER_DEFENSE_CLAIMS_PAUSED_MESSAGE } from "@/server/utils/towerDefenseClaims";
import { encodeLog, playBotRun } from "../../../libs/towerDefense/bot";
import { insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

/** Play a signed run with the test bot until the hero falls, or retreat at 40,000 ticks. */
const play = (config: TdRunConfig) =>
  playBotRun(config, { seed: 5, attention: 0.8, ticks: 40_000, retreat: true });

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
    const { state, log } = play(started.config);
    // Pretend the run took as long as it really plays.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + state.tick * 100 + 60_000);
    const claim = {
      token: started.token,
      actions: encodeLog(log),
      endTick: state.tick,
      simVersion: TD_SIM_VERSION,
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

  it("refuses another player's token, a run that ends elsewhere, older rules and paused claims", async () => {
    const api = await callerFor(towerDefenseRouter, "td-user");
    const other = await callerFor(towerDefenseRouter, "td-other");
    const started = await api.startRun({ startWave: 1 });
    if (!started.token || !started.config) throw new Error("Run did not start");
    const { state, log } = play(started.config);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + state.tick * 100 + 60_000);
    const claim = {
      token: started.token,
      actions: encodeLog(log),
      endTick: state.tick,
      simVersion: TD_SIM_VERSION,
    };
    // Refusals the same claim can only repeat tell the client to discard the run.
    expect(await other.claimRun(claim)).toMatchObject({
      success: false,
      permanent: true,
    });
    expect(await api.claimRun({ ...claim, endTick: state.tick - 1 })).toMatchObject({
      success: false,
      permanent: true,
    });
    expect(await api.claimRun({ ...claim, token: `${claim.token}x` })).toMatchObject({
      success: false,
      permanent: true,
    });
    // A log that cannot be decoded is refused for good, after every cheaper check.
    expect(await api.claimRun({ ...claim, actions: "not a log" })).toMatchObject({
      success: false,
      permanent: true,
      message: "This run's record could not be read.",
    });
    // A page on older rules is sent to reload and resume, keeping its save, even when
    // these rules can no longer read its log.
    const outdated = await api.claimRun({ ...claim, simVersion: TD_SIM_VERSION - 1 });
    expect(outdated).toMatchObject({ success: false, reloadRequired: true });
    expect(outdated.permanent).toBeUndefined();
    expect(
      await api.claimRun({
        ...claim,
        actions: "not a log",
        simVersion: TD_SIM_VERSION - 1,
      }),
    ).toMatchObject({ success: false, reloadRequired: true });
    env.TOWER_DEFENSE_CLAIMS_ENABLED = undefined;
    const paused = await api.claimRun(claim);
    expect(paused).toMatchObject({
      success: false,
      message: TOWER_DEFENSE_CLAIMS_PAUSED_MESSAGE,
    });
    expect(paused.permanent).toBeUndefined();
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
