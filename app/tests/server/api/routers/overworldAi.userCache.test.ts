import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { aiProfile, battle, battleHistory, trainingLog, userCookingJob, userQueue, overworldAiPlacement, overworldAiPlacementQuest, quest, questHistory, userData, userQuestAttempt } from "@/drizzle/schema";
import * as overworldQueries from "@/queries/overworldAi";
import { overworldAiRouter } from "@/server/api/routers/overworldAi";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { AllObjectives } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

describeWithDatabase("overworld interaction profile updates", () => {
  beforeEach(async () => {
    await resetTables(aiProfile, battle, battleHistory, trainingLog, userCookingJob, userQueue, overworldAiPlacementQuest, overworldAiPlacement, questHistory, quest, userQuestAttempt, userData);
    await insertUsers([
      { userId: "npc-cache-actor", rank: "JONIN", status: "AWAKE", sector: 0, longitude: 0, latitude: 0, primaryElement: "Fire", secondaryElement: "Water" },
      { userId: "npc-cache-template", isAi: true },
    ]);
    const db = await getTestDatabase();
    await db.insert(overworldAiPlacement).values({ id: "cache-giver", aiTemplateUserId: "npc-cache-template", interactionType: "FRIENDLY", sectorList: [], sector: 0, longitude: 0, latitude: 0 });
  });
  afterEach(() => { resetServerModuleStubs(); vi.restoreAllMocks(); });

  const prepared = async () => {
    const db = await getTestDatabase();
    const snapshot = await fetchUpdatedUser({ client: db, userId: "npc-cache-actor" });
    stubProfile("fetchUpdatedUser", async () => ({ ...snapshot, requiresUserRefresh: false, requiresProgressionRefresh: false }));
    return { db, snapshot, caller: callerForDatabase(overworldAiRouter, "npc-cache-actor", db) };
  };

  it.each(["safe", "upfront", "progression", "queue", "cooking"] as const)("preserves admission recovery after upfront hydration (%s)", async (settlement) => {
    const db = await getTestDatabase();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json([{ result: [59, 60] }]));
    await db.insert(aiProfile).values({ id: "Default", userId: "default-ai", rules: [] });
    await db.update(userData).set({ rank: "JONIN", level: 50, isOutlaw: true, regeneration: 0 }).where(eq(userData.userId, "npc-cache-actor"));
    await db.update(overworldAiPlacement).set({ interactionType: "HOSTILE" }).where(eq(overworldAiPlacement.id, "cache-giver"));
    const { caller, snapshot } = await prepared();
    stubProfile("fetchUpdatedUser", async () => ({ ...snapshot, requiresUserRefresh: settlement === "upfront", requiresProgressionRefresh: settlement === "progression" }));
    // The admission preload must also account for work that became due after hydration.
    if (settlement === "queue") await db.insert(userQueue).values({ id: "npc-deleted-job", userId: "npc-cache-actor", kind: "JUTSU", position: 1, jutsuId: "deleted-jutsu", reservedRyo: 321, durationSeconds: 1, startsAt: new Date(0), finishesAt: new Date(1000) });
    if (settlement === "cooking") await db.insert(userCookingJob).values({ id: "npc-cooking", userId: "npc-cache-actor", experience: 99, finishesAt: new Date(0) });
    const response = await caller.interactWithOverworldAi({ placementId: "cache-giver", positionVersion: 0 });
    expect(response.success).toBe(true);
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "npc-cache-actor") })).toHaveProperty("status", "BATTLE");
    if (settlement === "safe") expect(response.userPatch).toHaveProperty("status", "BATTLE");
    else {
      expect(response.userPatch).toBeUndefined();
      expect(response.userDelta).toBeUndefined();
    }
  });
  it("acknowledges a friendly NPC with no available work without changing the profile", async () => {
    const { caller } = await prepared();
    expect(await caller.interactWithOverworldAi({ placementId: "cache-giver", positionVersion: 0 })).toMatchObject({ success: true, userPatch: {} });
  });

  it.each([0, 100])("returns the committed roll and active quest slot for chance %s", async (chance) => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "cache-npc-quest", questType: "overworld", hidden: false, maxAttempts: 10, maxCompletes: 10, content: {
      objectives: [AllObjectives.parse({ id: "train", task: "stats_trained", value: 50 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    await db.insert(overworldAiPlacementQuest).values({ placementId: "cache-giver", questId: "cache-npc-quest", chance });
    const { caller } = await prepared();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const result = await caller.interactWithOverworldAi({ placementId: "cache-giver", positionVersion: 0 });
    expect(result.success).toBe(true);
    expect(result.userPatch).toMatchObject({ dailyOverworldQuestRolls: 1, activeNpcQuestId: chance ? "cache-npc-quest" : null });
    if (chance) expect(result.userPatch?.userQuests).toContainEqual(expect.objectContaining({ questId: "cache-npc-quest" }));
    const saved = await db.query.userData.findFirst({ where: eq(userData.userId, "npc-cache-actor") });
    expect(result.userPatch?.dailyOverworldQuestRolls).toBe(saved?.dailyOverworldQuestRolls);
    expect(result.userPatch?.activeNpcQuestId).toBe(saved?.activeNpcQuestId);
  });

  it("omits the partial progression patch after a committed NPC assignment when confirmation fails", async () => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "cache-npc-quest", questType: "overworld", hidden: false, maxAttempts: 10, maxCompletes: 10, content: {
      objectives: [AllObjectives.parse({ id: "train", task: "stats_trained", value: 50 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    await db.insert(overworldAiPlacementQuest).values({ placementId: "cache-giver", questId: "cache-npc-quest", chance: 100 });
    const { caller } = await prepared();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.spyOn(overworldQueries, "findOverworldInteractionUserCache").mockRejectedValueOnce(new Error("NPC confirmation unavailable"));
    const result = await caller.interactWithOverworldAi({ placementId: "cache-giver", positionVersion: 0 });
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "npc-cache-actor") })).toMatchObject({ dailyOverworldQuestRolls: 1, activeNpcQuestId: "cache-npc-quest" });
    expect(await db.query.questHistory.findMany()).toHaveLength(1);
  });
  it("publishes a dialog objective's confirmed payout and updated trackers", async () => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "cache-dialog-quest", questType: "overworld", hidden: false, maxAttempts: 10, maxCompletes: 10, content: {
      objectives: [
        AllObjectives.parse({ id: "talk", task: "dialog", overworldPlacementId: "cache-giver", reward_money: 11, nextObjectiveId: [{ text: "Continue", nextObjectiveId: "train" }] }),
        AllObjectives.parse({ id: "train", task: "stats_trained", value: 1000 }),
      ], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    await db.insert(overworldAiPlacementQuest).values({ placementId: "cache-giver", questId: "cache-dialog-quest", chance: 100 });
    const { caller, snapshot } = await prepared();
    expect((await caller.interactWithOverworldAi({ placementId: "cache-giver", positionVersion: 0 })).success).toBe(true);
    snapshot.user!.activeNpcQuestId = "cache-dialog-quest";
    expect((await caller.interactWithOverworldAi({ placementId: "cache-giver", positionVersion: 0 })).dialog?.objectiveId).toBe("talk");
    const moneyBefore = (await db.query.userData.findFirst({ where: eq(userData.userId, "npc-cache-actor") }))!.money;
    const result = await caller.interactWithOverworldAi({ placementId: "cache-giver", positionVersion: 0, dialogContentId: "train" });
    expect(result).toMatchObject({ success: true, userDelta: { money: 11 } });
    expect(result.userPatch?.questData?.find((tracker) => tracker.id === "cache-dialog-quest")?.goals.find((goal) => goal.id === "talk")?.done).toBe(true);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "npc-cache-actor") }))!.money).toBe(moneyBefore + 11);
  });

});
