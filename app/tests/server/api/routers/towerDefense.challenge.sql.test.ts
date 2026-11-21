import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  quest,
  questHistory,
  towerDefenseClaimReceipt,
  towerDefenseRun,
  userData,
  userTowerDefenseUpgrade,
  village,
} from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { TD_SIM_VERSION, type TdRunConfig } from "@/libs/towerDefense/sim";
import { towerDefenseRouter } from "@/server/api/routers/towerDefense";
import { type QuestTrackerType, WinTowerDefense } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { encodeLog, playBotRun } from "../../../libs/towerDefense/bot";
import {
  insertQuestHistory,
  insertQuests,
  insertUsers,
} from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const userId = "td-challenger";
/** Where the challenge objective sits; the player starts elsewhere. */
const spot = { sector: 12, longitude: 4, latitude: 6 };

const play = (config: TdRunConfig) =>
  playBotRun(config, { seed: 7, attention: 0.8, ticks: 40_000, retreat: true });

const player = async () => {
  const database = await getTestDatabase();
  const [row] = await database
    .select({
      points: userData.towerDefensePoints,
      bestWave: userData.towerDefenseBestWave,
      activeRun: userData.towerDefenseActiveRun,
      questData: userData.questData,
    })
    .from(userData)
    .where(eq(userData.userId, userId));
  return row;
};

const goal = (questData: unknown) =>
  (questData as QuestTrackerType[] | null)
    ?.find((tracker) => tracker.id === "td-quest")
    ?.goals.find((entry) => entry.id === "td-goal");

const moveTo = async (location: typeof spot) => {
  const database = await getTestDatabase();
  await database.update(userData).set(location).where(eq(userData.userId, userId));
};

/** Claim a played run as if it took as long as it plays. */
const claim = async (
  api: ReturnType<typeof towerDefenseRouter.createCaller>,
  token: string,
  run: ReturnType<typeof play>,
) => {
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + run.state.tick * 100 + 60_000);
  return api.claimRun({
    token,
    actions: encodeLog(run.log),
    endTick: run.state.tick,
    simVersion: TD_SIM_VERSION,
  });
};

describeWithDatabase("tower defense quest challenges", () => {
  const configured = env.TOWER_DEFENSE_CLAIMS_ENABLED;
  beforeEach(async () => {
    env.TOWER_DEFENSE_CLAIMS_ENABLED = "true";
    await resetTables(
      towerDefenseClaimReceipt,
      towerDefenseRun,
      userTowerDefenseUpgrade,
      questHistory,
      quest,
      userData,
      village,
    );
    await insertUsers([
      {
        userId,
        username: userId,
        status: "AWAKE",
        level: 60,
        towerDefensePoints: 500,
        towerDefenseBestWave: 15,
        sector: 3,
        longitude: 1,
        latitude: 1,
      },
    ]);
    stubRateLimitTransport();
  });
  afterEach(() => {
    Object.assign(env, { TOWER_DEFENSE_CLAIMS_ENABLED: configured });
    vi.restoreAllMocks();
  });

  /** An active mission whose one objective is the given challenge at `spot`. */
  const assignChallenge = async (rules: object) => {
    await insertQuests([
      {
        id: "td-quest",
        questType: "mission",
        content: {
          objectives: [
            WinTowerDefense.parse({
              id: "td-goal",
              task: "win_tower_defense",
              ...spot,
              ...rules,
            }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    await insertQuestHistory([{ userId, questId: "td-quest", questType: "mission" }]);
  };
  const request = { questId: "td-quest", objectiveId: "td-goal" };

  it("starts only at the objective's location, with the objective's rules", async () => {
    await assignChallenge({
      startWave: 31,
      waves: 4,
      enemyHealth: 150,
      enemyDamage: 70,
    });
    const api = await callerFor(towerDefenseRouter, userId);
    const away = await api.startRun({ startWave: 1, challenge: request });
    expect(away.success).toBe(false);
    expect(away.message).toContain("sector 12");
    await moveTo(spot);
    // The objective decides the start wave, even past the player's checkpoints.
    const started = await api.startRun({ startWave: 1, challenge: request });
    expect(started.success).toBe(true);
    expect(started.config).toMatchObject({
      startWave: 31,
      challenge: { ...request, waves: 4, enemyHealth: 150, enemyDamage: 70 },
    });
    const unknown = await api.startRun({
      startWave: 1,
      challenge: { questId: "td-quest", objectiveId: "missing" },
    });
    expect(unknown.success).toBe(false);
  });

  it("completes the objective on a win and pays nothing else", async () => {
    await assignChallenge({ startWave: 1, waves: 3 });
    await moveTo(spot);
    const api = await callerFor(towerDefenseRouter, userId);
    const started = await api.startRun({ startWave: 1, challenge: request });
    if (!started.token || !started.config) throw new Error("Challenge did not start");
    const run = play(started.config);
    expect(run.state.won).toBe(true);
    const first = await claim(api, started.token, run);
    expect(first).toMatchObject({
      success: true,
      challengeCompleted: true,
      pointsEarned: 0,
      wave: 3,
    });
    expect(goal(first.userPatch?.questData)?.done).toBe(true);
    const after = await player();
    expect(goal(after?.questData)?.done).toBe(true);
    expect(after).toMatchObject({ points: 500, bestWave: 15, activeRun: null });
    expect(await api.getLeaderboard({ limit: 5 })).toHaveLength(0);
    const again = await claim(api, started.token, run);
    expect(again).toMatchObject({ success: false, alreadyClaimed: true });
    // A finished challenge cannot be started again.
    expect((await api.startRun({ startWave: 1, challenge: request })).success).toBe(
      false,
    );
  });

  it("leaves the objective open after a loss and lets the player try again", async () => {
    await assignChallenge({
      startWave: 30,
      waves: 20,
      enemyHealth: 1000,
      enemyDamage: 1000,
    });
    await moveTo(spot);
    const api = await callerFor(towerDefenseRouter, userId);
    const started = await api.startRun({ startWave: 1, challenge: request });
    if (!started.token || !started.config) throw new Error("Challenge did not start");
    const run = play(started.config);
    expect(run.state.won).toBe(false);
    const result = await claim(api, started.token, run);
    expect(result).toMatchObject({
      success: true,
      challengeCompleted: false,
      pointsEarned: 0,
    });
    const after = await player();
    expect(goal(after?.questData)?.done).toBeFalsy();
    expect(after).toMatchObject({ points: 500, bestWave: 15, activeRun: null });
    expect((await api.startRun({ startWave: 1, challenge: request })).success).toBe(
      true,
    );
  });
});
