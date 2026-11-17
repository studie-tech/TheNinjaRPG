import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { TD_DAILY_WAVES } from "@/drizzle/constants";
import {
  towerDefenseClaimReceipt,
  towerDefenseRun,
  userData,
  userTowerDefenseUpgrade,
  village,
} from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import {
  TD_WAVE_TICKS,
  tdDailyReward,
  tdWavesCleared,
} from "@/libs/towerDefense/balance";
import { TD_SIM_VERSION, type TdRunConfig, tdDojoCost } from "@/libs/towerDefense/sim";
import { updateUserDataForDailyCounters } from "@/queries/profile";
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
      village,
    );
    await insertUsers([
      {
        userId: "td-user",
        towerDefensePoints: 500,
        towerDefenseBestWave: 45,
        level: 60,
      },
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
    // The character's level is signed with the run, so the claim replays its bonus.
    expect(started.config).toMatchObject({ startWave: 31, bestWave: 45, level: 60 });
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

  it("claims only the latest run a player started", async () => {
    const api = await callerFor(towerDefenseRouter, "td-user");
    const first = await api.startRun({ startWave: 1 });
    const second = await api.startRun({ startWave: 1 });
    if (!first.token || !first.config || !second.token || !second.config)
      throw new Error("Runs did not start");
    const older = play(first.config);
    const newer = play(second.config);
    vi.spyOn(Date, "now").mockReturnValue(
      Date.now() + Math.max(older.state.tick, newer.state.tick) * 100 + 60_000,
    );
    const claimOf = (token: string, run: typeof older) => ({
      token,
      actions: encodeLog(run.log),
      endTick: run.state.tick,
      simVersion: TD_SIM_VERSION,
    });
    // Starting the second run retired the first, so two runs never earn side by side.
    expect(await api.claimRun(claimOf(first.token, older))).toMatchObject({
      success: false,
      permanent: true,
    });
    expect(await progress("td-user")).toEqual({ points: 500, bestWave: 45 });
    expect(await api.claimRun(claimOf(second.token, newer))).toMatchObject({
      success: true,
    });
    // A claimed run is retired too; a retry is answered from its receipt.
    expect(await api.claimRun(claimOf(second.token, newer))).toMatchObject({
      alreadyClaimed: true,
    });
  });

  it("pays the daily Guard Hall duty once a day, to runs that clear its waves", async () => {
    const database = await getTestDatabase();
    await database
      .insert(village)
      .values({ id: "td-village", name: "Akikaze", kageId: "" });
    await database
      .update(userData)
      .set({ villageId: "td-village", money: 1000, villagePrestige: 0 })
      .where(eq(userData.userId, "td-user"));
    const api = await callerFor(towerDefenseRouter, "td-user");
    const claimRun = async (startWave: number, ticks: number) => {
      const started = await api.startRun({ startWave });
      if (!started.token || !started.config) throw new Error("Run did not start");
      const run = playBotRun(started.config, {
        seed: 5,
        attention: 0.8,
        ticks,
        retreat: true,
      });
      vi.spyOn(Date, "now").mockReturnValue(Date.now() + run.state.tick * 100 + 60_000);
      const result = await api.claimRun({
        token: started.token,
        actions: encodeLog(run.log),
        endTick: run.state.tick,
        simVersion: TD_SIM_VERSION,
      });
      vi.restoreAllMocks();
      stubRateLimitTransport();
      return { result, cleared: tdWavesCleared(startWave, run.state.wave) };
    };
    const duty = async () => {
      const [user] = await database
        .select({
          paidAt: userData.towerDefenseDutyAt,
          money: userData.money,
          prestige: userData.villagePrestige,
        })
        .from(userData)
        .where(eq(userData.userId, "td-user"));
      const [defended] = await database
        .select({ tokens: village.tokens })
        .from(village)
        .where(eq(village.id, "td-village"));
      return { ...user, tokens: defended?.tokens };
    };
    const reward = tdDailyReward(60);

    // A checkpoint start does not count its earlier waves: this run clears too few.
    const short = await claimRun(31, 5 * TD_WAVE_TICKS);
    expect(short.cleared).toBeLessThan(TD_DAILY_WAVES);
    expect(short.result).toMatchObject({ success: true, userDelta: {} });
    expect(short.result.dailyReward).toBeUndefined();
    expect(short.result.userPatch).toBeUndefined();
    expect(await duty()).toEqual({ paidAt: null, money: 1000, prestige: 0, tokens: 0 });

    const long = await claimRun(1, 40_000);
    expect(long.cleared).toBeGreaterThanOrEqual(TD_DAILY_WAVES);
    expect(long.result).toMatchObject({
      success: true,
      dailyReward: reward,
      userDelta: {
        money: reward.ryo,
        villagePrestige: reward.prestige,
        village: { id: "td-village", tokens: reward.villageTokens },
      },
    });
    const paid = await duty();
    expect(paid).toEqual({
      paidAt: expect.any(Date),
      money: 1000 + reward.ryo,
      prestige: reward.prestige,
      tokens: reward.villageTokens,
    });
    expect(long.result.userPatch?.towerDefenseDutyAt).toBeInstanceOf(Date);

    // Another qualifying run the same day pays nothing more, even after the daily
    // counters reset, since the payout is guarded on the day it was made.
    await updateUserDataForDailyCounters(database, new Date(Date.now() + 60_000), [
      "td-user",
    ]);
    const again = await claimRun(1, 40_000);
    expect(again.result).toMatchObject({ success: true, userDelta: {} });
    expect(again.result.dailyReward).toBeUndefined();
    expect(await duty()).toMatchObject({
      money: 1000 + reward.ryo,
      prestige: reward.prestige + 1,
      tokens: reward.villageTokens,
    });

    // The next UTC day pays again.
    await database
      .update(userData)
      .set({ towerDefenseDutyAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(userData.userId, "td-user"));
    const tomorrow = await claimRun(1, 40_000);
    expect(tomorrow.result).toMatchObject({ success: true, dailyReward: reward });
    expect(await duty()).toMatchObject({
      money: 1000 + 2 * reward.ryo,
      tokens: 2 * reward.villageTokens,
    });
  });

  it("ranks each player once, by their best run", async () => {
    const database = await getTestDatabase();
    const run = (
      id: string,
      userId: string,
      wave: number,
      score: number,
      startedAt: string,
    ) => ({
      id,
      seed: id,
      userId,
      wave,
      score,
      startWave: 1,
      startedAt: new Date(startedAt),
      endedAt: new Date(startedAt),
    });
    await database
      .insert(towerDefenseRun)
      .values([
        run("a-low", "td-user", 30, 400, "2026-11-01T10:00:00Z"),
        run("a-best", "td-user", 55, 900, "2026-11-02T10:00:00Z"),
        run("a-fewer-kills", "td-user", 55, 700, "2026-11-03T10:00:00Z"),
        run("a-tie-later", "td-user", 55, 900, "2026-11-04T10:00:00Z"),
        run("b-only", "td-other", 40, 500, "2026-11-01T11:00:00Z"),
      ]);
    const api = await callerFor(towerDefenseRouter, "td-user");
    const leaderboard = await api.getLeaderboard({ limit: 10 });
    expect(leaderboard.map((entry) => entry.id)).toEqual(["a-best", "b-only"]);
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
