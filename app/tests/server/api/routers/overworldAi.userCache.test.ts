import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { aiProfile, battle, battleHistory, trainingLog, userCookingJob, userQueue, overworldAiPlacement, overworldAiPlacementQuest, quest, questHistory, userData, userQuestAttempt } from "@/drizzle/schema";
import { overworldAiRouter } from "@/server/api/routers/overworldAi";
import { fetchUpdatedUser, profileRouter } from "@/server/api/routers/profile";
import { updateUserDataForGET } from "@/queries/profile";
import { prepareUserUpdate, updateUserCache, type UserPatch, type UserUpdateOptions } from "@/utils/userCache";
import { AllObjectives } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import { callerForDatabase, describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../../setup/testDatabase";

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
  afterEach(() => { resetServerModuleStubs(); vi.restoreAllMocks(); setSystemTime(); });

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
    expect(result.userDelta).toMatchObject({ dailyOverworldQuestRolls: 1 });
    if (chance) expect(result.userPatch).toMatchObject({ activeNpcQuestId: "cache-npc-quest" });
    else expect(result.userPatch).toEqual({});
    if (chance) expect(result.userPatch?.userQuests).toContainEqual(expect.objectContaining({ questId: "cache-npc-quest" }));
    const saved = await db.query.userData.findFirst({ where: eq(userData.userId, "npc-cache-actor") });
    expect(result.userDelta?.dailyOverworldQuestRolls).toBe(saved?.dailyOverworldQuestRolls);
    if (chance) expect(result.userPatch?.activeNpcQuestId).toBe(saved?.activeNpcQuestId);
  });

  it("returns the committed assignment without a cache confirmation SELECT", async () => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "cache-npc-quest", questType: "overworld", hidden: false, maxAttempts: 10, maxCompletes: 10, content: {
      objectives: [AllObjectives.parse({ id: "train", task: "stats_trained", value: 50 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    await db.insert(overworldAiPlacementQuest).values({ placementId: "cache-giver", questId: "cache-npc-quest", chance: 100 });
    const { caller } = await prepared();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { result, statements } = await recordQueries(() => caller.interactWithOverworldAi({ placementId: "cache-giver", positionVersion: 0 }));
    const lastWrite = statements.reduce((last, statement, index) => /^\s*(update|insert|delete)/i.test(statement) ? index : last, -1);
    expect(statements.slice(lastWrite + 1).some((statement) => /^\s*select/i.test(statement))).toBe(false);
    expect(result.success).toBe(true);
    expect(result.userPatch).toHaveProperty("activeNpcQuestId", "cache-npc-quest");
    expect(result.userDelta).toEqual({ dailyOverworldQuestRolls: 1 });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "npc-cache-actor") })).toMatchObject({ dailyOverworldQuestRolls: 1, activeNpcQuestId: "cache-npc-quest" });
    expect(await db.query.questHistory.findMany()).toHaveLength(1);
  });
  it.each([false, true])("applies the SQL roll through Sector's actual callback across a UTC cron reset=%s", async (resetDay) => {
    const db = await getTestDatabase();
    setSystemTime(new Date("2026-10-30T23:59:59Z"));
    await db.update(userData).set({ level: 50, isOutlaw: true, regeneration: 0, dailyOverworldQuestRolls: 1, updatedAt: new Date(), regenAt: new Date() }).where(eq(userData.userId, "npc-cache-actor"));
    await insertQuests([{ id: "cache-npc-quest", questType: "overworld", hidden: false, maxAttempts: 10, maxCompletes: 10, content: {
      objectives: [AllObjectives.parse({ id: "train", task: "stats_trained", value: 50 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    await db.insert(overworldAiPlacementQuest).values({ placementId: "cache-giver", questId: "cache-npc-quest", chance: 0 });
    const profile = callerForDatabase(profileRouter, "npc-cache-actor", db);
    const initial = await profile.getUser();
    expect(initial.userData?.dailyOverworldQuestRolls).toBe(1);
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["npc-roll-profile"];
    const getUser = vi.fn(() => profile.getUser());
    cache.setQueryDefaults(key, { queryFn: getUser });
    cache.setQueryData(key, initial);
    const observer = new QueryObserver(cache, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const stop = observer.subscribe(() => {});
    if (resetDay) {
      setSystemTime(new Date("2026-10-31T00:00:01Z"));
      await updateUserDataForGET(db);
      // Another settled request can advance updatedAt before this tab learns the reset.
      await db.update(userData).set({ updatedAt: new Date(), regenAt: new Date() }).where(eq(userData.userId, "npc-cache-actor"));
    }
    const source = readFileSync(join(import.meta.dirname, "../../../../src/layout/Sector.tsx"), "utf8");
    const call = source.indexOf("api.overworldAi.interactWithOverworldAi.useMutation(");
    const callbacks = source.slice(call).match(/useMutation\((\{[\s\S]*?\n    \})\);/)?.[1];
    if (!callbacks) throw new Error("NPC callbacks were not found");
    const transpiler = new (require("bun").Transpiler)({ loader: "tsx" });
    const factory = transpiler.transformSync(`function callbacks() { return (${callbacks}); }`);
    const updateUser = (patch: UserPatch | undefined, options: UserUpdateOptions) => updateUserCache(cache, key, patch, options);
    const options = new Function("prepareUserUpdate", "updateUser", "showMutationToast", "setNpcDialog", "utils", "openRewardChoice", `${factory}\nreturn callbacks();`)(
      () => prepareUserUpdate(cache, key), updateUser, vi.fn(), vi.fn(), { travel: { getSectorData: { invalidate: vi.fn() } } }, vi.fn(),
    ) as { onMutate: () => number | undefined; onSuccess: (data: unknown, input: unknown, revision: number | undefined) => Promise<void> };
    try {
      const revision = options.onMutate();
      const result = await callerForDatabase(overworldAiRouter, "npc-cache-actor", db).interactWithOverworldAi({ placementId: "cache-giver", positionVersion: 0 });
      expect(result).toMatchObject({ success: true, userDelta: { dailyOverworldQuestRolls: 1 }, dailyOverworldQuestRollsBefore: resetDay ? 0 : 1 });
      await options.onSuccess(result, undefined, revision);
      const saved = await db.query.userData.findFirst({ where: eq(userData.userId, "npc-cache-actor") });
      expect(saved?.dailyOverworldQuestRolls).toBe(resetDay ? 1 : 2);
      expect(cache.getQueryData<typeof initial>(key)?.userData?.dailyOverworldQuestRolls).toBe(saved?.dailyOverworldQuestRolls);
      expect(getUser).toHaveBeenCalledTimes(resetDay ? 1 : 0);
    } finally { stop(); cache.clear(); }
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
