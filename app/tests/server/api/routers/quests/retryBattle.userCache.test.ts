import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { aiProfile, battle, battleHistory, item, quest, questHistory, userCookingJob, userData, userItem, userVote } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { profileRouter } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import { createTRPCRouter } from "@/server/api/trpc";
import { prepareUserUpdate, updateUserCache, type UserPatch, type UserUpdateOptions } from "@/utils/userCache";
import { IncreaseMaxPoolsTag } from "@/validators/combat";
import { InstantNewQuestObjective, InstantStartBattleObjective, QuestTracker, SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertItems, insertQuestHistory, insertQuests, insertUserItems, insertUsers } from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { beforeStatements } from "../../../../setup/statements";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const playerId = "retry-cache-player";
const questId = "retry-cache-quest";
const router = createTRPCRouter({ quests: questsRouter });
const scenarios = ["ordinary", "isolated", "cooking", "unpaid entry", "paid entry", "live immunity", "consumed feedback"] as const;

describeWithDatabase("quest retry admission cache", () => {
  beforeEach(async () => {
    await resetTables(aiProfile, battle, battleHistory, questHistory, quest, userCookingJob, userItem, item, userVote, userData);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    stubRateLimitTransport({ unexpectedRequestMessage: "Unexpected HTTP request in retry cache tests" });
    vi.spyOn(Math, "random").mockReturnValue(0.9999);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(scenarios)("reconciles committed admission state for %s", async (scenario) => {
    const database = await getTestDatabase();
    const isolated = scenario === "isolated";
    const hasEntryItems = scenario === "unpaid entry" || scenario === "paid entry";
    const needsRecovery = !["ordinary", "isolated", "paid entry"].includes(scenario);
    const now = new Date();
    await insertUsers([
      {
        userId: playerId, username: "RetryCache", rank: "JONIN", level: 50,
        status: isolated ? "BATTLE" : "AWAKE", isOutlaw: true,
        primaryElement: "Fire", secondaryElement: "Water", regeneration: 0,
        pveFights: 7, stealthActive: true, stealthActivatedAt: now,
        bracketImmunityLiftedUntil: scenario === "live immunity" ? new Date(now.getTime() + 3600000) : new Date(0),
        bracketImmunityPausedAt: null, updatedAt: now, regenAt: now,
        curHealth: 1000, maxHealth: 1000, curChakra: 1000, maxChakra: 1000,
        curStamina: 1000, maxStamina: 1000,
        questData: [QuestTracker.parse({ id: questId, goals: [{ id: "fight", recentlyDied: true }] })],
      },
      { userId: "retry-cache-foe", isAi: true },
    ]);
    await insertQuests([{
      id: questId, name: "Retry quest", questType: isolated ? "battlepyramid" : "story", hidden: false,
      content: {
        isolated, entryItems: hasEntryItems ? [{ ids: ["retry-ticket"], number: 1 }] : [],
        objectives: [InstantStartBattleObjective.parse({ id: "fight", task: "start_battle", opponentAIs: [{ ids: ["retry-cache-foe"], number: 1 }] })],
        reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
      },
    }]);
    const definition = await database.query.quest.findFirst({ where: eq(quest.id, questId) });
    await insertQuestHistory([{
      userId: playerId, questId, questType: isolated ? "battlepyramid" : "story",
      questVersion: isolated ? definition?.updatedAt : null, isolated, startedAt: now,
      entryPaid: scenario === "paid entry",
    }]);
    await database.insert(aiProfile).values({ id: "Default", userId: "retry-cache-foe", rules: [] });
    await database.insert(userVote).values({ id: "retry-cache-vote", userId: playerId, secret: "retry001", lastVoteAt: now });
    if (hasEntryItems) {
      await insertItems([{
        id: "retry-ticket", itemType: "ARMOR", slot: "CHEST", maxDurability: 100,
        effects: [IncreaseMaxPoolsTag.parse({ power: 100, calculation: "static", poolsAffected: ["Energy"] })],
      }]);
      await insertUserItems([{ id: "retry-worn-ticket", userId: playerId, itemId: "retry-ticket", equipped: "CHEST", durability: 100, quantity: 1 }]);
    }
    if (scenario === "cooking") await database.insert(userCookingJob).values({
      id: "retry-cooking", userId: playerId, experience: 99, finishesAt: new Date(now.getTime() + 3600000),
    });
    const profile = callerForDatabase(profileRouter, playerId, database);
    const initial = await profile.getUser();
    if (scenario === "consumed feedback") {
      const content = { reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] };
      await insertQuests([
        { id: "retry-feedback-source", questType: "story", hidden: false, content: {
          ...content, objectives: [InstantNewQuestObjective.parse({ id: "grant", task: "new_quest", newQuestIds: ["retry-feedback-destination"] })],
        } },
        { id: "retry-feedback-destination", name: "Feedback quest", questType: "story", hidden: false, content: {
          ...content, objectives: [SimpleObjective.parse({ id: "train", task: "stats_trained", value: 10000 })],
        } },
      ]);
      await insertQuestHistory([{ userId: playerId, questId: "retry-feedback-source", questType: "story" }]);
    }
    // Admission observes Cooking becoming due after the retry's opening profile read.
    const actorDatabase = scenario === "cooking"
      ? beforeStatements(database, userData, [async () => {
          await database.update(userCookingJob).set({ finishesAt: new Date(0) }).where(eq(userCookingJob.id, "retry-cooking"));
        }])
      : database;
    const api = callerForDatabase(router, playerId, actorDatabase).quests;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["retry-cache-profile"];
    const recovery = vi.fn(() => profile.getUser());
    client.setQueryDefaults(key, { queryFn: recovery });
    client.setQueryData(key, initial);
    const observer = new QueryObserver(client, { queryKey: key, queryFn: recovery, staleTime: Infinity });
    const unsubscribe = observer.subscribe(() => {});
    const revision = prepareUserUpdate(client, key);
    try {
      const response = await api.retryBattle({ questId });
      expect(response.success).toBe(true);
      expect(response.message).toContain("Attacking 1 target for Retry quest.");
      if (scenario === "consumed feedback") {
        expect(response.message.split("\n").filter((message) => message === "Started new quest: Feedback quest")).toHaveLength(1);
        expect(response.announcements).toBeUndefined();
      }
      if (needsRecovery) {
        expect(response.userPatch).toBeUndefined();
        expect(response.userDelta).toBeUndefined();
        expect(response.achievementProgress).toBeUndefined();
      } else expect(response.userPatch).toBeDefined();
      // Execute Objective's actual callback against this real admission result.
      const source = readFileSync(join(import.meta.dirname, "../../../../../src/layout/Objective.tsx"), "utf8");
      const call = source.indexOf("api.quests.retryBattle.useMutation(");
      const callbacks = source.slice(call).match(/useMutation\((\{[\s\S]*?\n    \})\);/)?.[1];
      if (!callbacks) throw new Error("Retry callbacks were not found");
      const transpiler = new (require("bun").Transpiler)({ loader: "tsx" });
      const factory = transpiler.transformSync(`function callbacks() { return (${callbacks}); }`);
      const options = new Function("prepareUserUpdate", "updateUser", "showMutationToast", "utils", `${factory}\nreturn callbacks();`)(
        () => prepareUserUpdate(client, key),
        (patch: UserPatch | undefined, mutation: UserUpdateOptions) => updateUserCache(client, key, patch, mutation),
        vi.fn(), { profile: { getUser: { invalidate: () => client.invalidateQueries({ queryKey: key, exact: true }) } } },
      ) as { onSuccess: (data: unknown, input: unknown, revision: number | undefined) => Promise<void> };
      await options.onSuccess(response, undefined, revision);
      expect(recovery).toHaveBeenCalledTimes(needsRecovery ? 1 : 0);
      const saved = await database.query.userData.findFirst({ where: eq(userData.userId, playerId) });
      const cached = client.getQueryData<typeof initial>(key)?.userData;
      if (scenario === "consumed feedback") {
        expect(cached?.userQuests.some((entry) => entry.questId === "retry-feedback-destination")).toBe(true);
        expect(client.getQueryData<typeof initial>(key)?.notifications?.some((entry) => entry.name === "Started new quest: Feedback quest")).toBe(false);
      }
      expect(saved?.pveFights).toBe(8);
      expect(saved?.stealthActive).toBe(false);
      if (scenario === "live immunity") expect(saved?.bracketImmunityPausedAt).toBeInstanceOf(Date);
      else expect(saved?.bracketImmunityPausedAt).toBeNull();
      for (const field of ["status", "battleId", "pveFights", "stealthActive", "stealthActivatedAt", "bracketImmunityPausedAt", "updatedAt"] as const) {
        expect(cached?.[field]).toEqual(saved?.[field]);
      }
      if (scenario === "cooking") {
        expect(saved?.cookingExperience).toBe(99);
        expect(cached?.cookingExperience).toBe(99);
        expect(cached?.cookingJobs).toEqual([]);
        expect(await database.query.userCookingJob.findMany()).toEqual([]);
      }
      if (hasEntryItems) {
        const receipt = await database.query.questHistory.findFirst({ where: eq(questHistory.questId, questId) });
        const ticket = await database.query.userItem.findFirst({ where: eq(userItem.id, "retry-worn-ticket") });
        expect(receipt?.entryPaid).toBe(true);
        expect(cached?.userQuests.find((entry) => entry.questId === questId)?.entryPaid).toBe(true);
        expect(ticket?.quantity ?? 0).toBe(scenario === "paid entry" ? 1 : 0);
        expect(cached?.maxEnergy).toBe(initial.userData!.maxEnergy - (scenario === "unpaid entry" ? 100 : 0));
      }
      const canonical = (await profile.getUser()).userData;
      for (const field of ["offence", "defence", "strength", "speed", "intelligence", "willpower", "curHealth", "curChakra", "curStamina", "curEnergy", "maxEnergy"] as const) {
        expect(cached?.[field]).toBe(canonical?.[field]);
      }
    } finally { unsubscribe(); client.clear(); }
  });
});
