import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  chakraStormClaimReceipt,
  chakraStormProgress,
  quest,
  questHistory,
  userData,
  village,
} from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { encodeCsActions } from "@/libs/chakraStorm/actionLog";
import { CS_TPS, csNoTraining } from "@/libs/chakraStorm/content";
import { CS_SIM_VERSION, type CsRunConfig } from "@/libs/chakraStorm/sim";
import { chakraStormRouter } from "@/server/api/routers/chakraStorm";
import { type QuestTrackerType, WinChakraStorm } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { playBot } from "../../../libs/chakraStorm/bot";
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

const userId = "cs-challenger";
/** Where the challenge objective sits; the player starts elsewhere. */
const spot = { sector: 12, longitude: 4, latitude: 6 };
const request = { questId: "cs-quest", objectiveId: "cs-goal" };

const progressRow = async () => {
  const database = await getTestDatabase();
  const [row] = await database
    .select({
      intel: chakraStormProgress.intel,
      stages: chakraStormProgress.stages,
      activeRun: chakraStormProgress.activeRun,
    })
    .from(chakraStormProgress)
    .where(eq(chakraStormProgress.userId, userId));
  return row;
};

const goal = async () => {
  const database = await getTestDatabase();
  const [row] = await database
    .select({ questData: userData.questData })
    .from(userData)
    .where(eq(userData.userId, userId));
  return (row?.questData as QuestTrackerType[] | null)
    ?.find((tracker) => tracker.id === "cs-quest")
    ?.goals.find((entry) => entry.id === "cs-goal");
};

const moveTo = async (location: typeof spot) => {
  const database = await getTestDatabase();
  await database.update(userData).set(location).where(eq(userData.userId, userId));
};

/** Play a started run with the test bot, giving up at `quitAt` when given, and claim it. */
const playAndClaim = async (
  api: ReturnType<typeof chakraStormRouter.createCaller>,
  started: Awaited<
    ReturnType<ReturnType<typeof chakraStormRouter.createCaller>["startRun"]>
  >,
  quitAt?: number,
) => {
  if (!started.token || !started.seed || !started.stage)
    throw new Error("Challenge did not start");
  const config: CsRunConfig = {
    stage: started.stage,
    training: { ...csNoTraining(), ...started.training },
    challenge: started.challenge,
  };
  const run = playBot(started.seed, 20 * 60 * CS_TPS, config, quitAt);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + run.state.tick * 100 + 60_000);
  return {
    run,
    claim: () =>
      api.claimRun({
        token: started.token ?? "",
        actions: encodeCsActions(run.log),
        endTick: run.state.tick,
        simVersion: CS_SIM_VERSION,
      }),
  };
};

describeWithDatabase("chakra storm quest challenges", () => {
  const configured = env.CHAKRA_STORM_CLAIMS_ENABLED;
  beforeEach(async () => {
    env.CHAKRA_STORM_CLAIMS_ENABLED = "true";
    await resetTables(
      chakraStormClaimReceipt,
      chakraStormProgress,
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
        sector: 3,
        longitude: 1,
        latitude: 1,
      },
    ]);
    stubRateLimitTransport();
  });
  afterEach(() => {
    Object.assign(env, { CHAKRA_STORM_CLAIMS_ENABLED: configured });
    vi.restoreAllMocks();
  });

  /** An active mission whose one objective is the given challenge at `spot`. */
  const assignChallenge = async (rules: object) => {
    await insertQuests([
      {
        id: "cs-quest",
        questType: "mission",
        content: {
          objectives: [
            WinChakraStorm.parse({
              id: "cs-goal",
              task: "win_chakra_storm",
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
    await insertQuestHistory([{ userId, questId: "cs-quest", questType: "mission" }]);
  };

  it("starts only at the objective's location, in its region even when locked", async () => {
    await assignChallenge({ stage: "hyorin", surviveMinutes: 4 });
    const api = await callerFor(chakraStormRouter, userId);
    const away = await api.startRun({ stage: "horizon", challenge: request });
    expect(away.success).toBe(false);
    expect(away.message).toContain("sector 12");
    await moveTo(spot);
    // The objective decides the region and time, even a region not open yet.
    const started = await api.startRun({ stage: "horizon", challenge: request });
    expect(started.success).toBe(true);
    expect(started).toMatchObject({
      stage: "hyorin",
      challenge: { ...request, seconds: 240 },
    });
    // Without a challenge the locked region still refuses to start.
    expect((await api.startRun({ stage: "hyorin" })).success).toBe(false);
  });

  it("completes the objective on a survived storm and pays nothing else", async () => {
    await assignChallenge({ stage: "horizon", surviveMinutes: 1 });
    await moveTo(spot);
    const api = await callerFor(chakraStormRouter, userId);
    const started = await api.startRun({ stage: "horizon", challenge: request });
    const { run, claim } = await playAndClaim(api, started);
    expect(run.state.won).toBe(true);
    const first = await claim();
    expect(first).toMatchObject({ success: true, intelEarned: 0 });
    const patched = (first.userPatch?.questData as QuestTrackerType[] | undefined)
      ?.find((tracker) => tracker.id === "cs-quest")
      ?.goals.find((entry) => entry.id === "cs-goal");
    expect(patched?.done).toBe(true);
    expect((await goal())?.done).toBe(true);
    expect(await progressRow()).toMatchObject({
      intel: 0,
      stages: {},
      activeRun: null,
    });
    expect(await claim()).toMatchObject({ success: false, alreadyClaimed: true });
    // A finished challenge cannot be started again.
    expect((await api.startRun({ stage: "horizon", challenge: request })).success).toBe(
      false,
    );
  });

  it("leaves the objective open when the player gives up", async () => {
    await assignChallenge({ stage: "horizon", surviveMinutes: 2 });
    await moveTo(spot);
    const api = await callerFor(chakraStormRouter, userId);
    const started = await api.startRun({ stage: "horizon", challenge: request });
    const { run, claim } = await playAndClaim(api, started, 20 * CS_TPS);
    expect(run.state.won).toBe(false);
    const result = await claim();
    expect(result).toMatchObject({ success: true, intelEarned: 0, userDelta: {} });
    expect(result.userPatch).toBeUndefined();
    expect((await goal())?.done).toBeFalsy();
    expect(await progressRow()).toMatchObject({ intel: 0, activeRun: null });
    expect((await api.startRun({ stage: "horizon", challenge: request })).success).toBe(
      true,
    );
  });
});
