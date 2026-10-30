import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import type { RouterOutputs } from "@/app/_trpc/client";
import { battle, clan, dungeon, dungeonMember, dungeonRun, gameSetting, quest, questHistory, userData, userRewards, userVote, village } from "@/drizzle/schema";
import * as dungeonQueries from "@/queries/dungeon";
import * as skillQueries from "@/queries/skillTree";
import { dungeonRouter } from "@/server/api/routers/dungeon";
import * as profileQueries from "@/server/api/routers/profile";
import { profileRouter } from "@/server/api/routers/profile";
import { settleDungeonBattle } from "@/server/utils/dungeon";
import { prepareUserUpdate, updateUserCache, type UserPatch, type UserUpdateOptions } from "@/utils/userCache";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { type UserDeltaResponse, userDeltaResponseSchema } from "@/validators/userCache";
import { makeCompleteBattle, makeUser } from "../../../libs/combat/helpers/battleScenario";
import { dungeonBattleState, dungeonContent } from "../../../setup/dungeon";
import { insertQuests, insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

type Profile = RouterOutputs["profile"]["getUser"];
const userId = "dungeon-cache-player";
/** Select the goal compared between cached and canonical dungeon progress. */
const goal = (profile: Profile, id: string) => profile.userData?.questData?.find((entry) => entry.id === id)?.goals[0];
const clients: QueryClient[] = [];

type ClaimCallbacks = {
  onMutate: () => number | undefined;
  onSuccess: (response: UserDeltaResponse, input: unknown, revision: number | undefined) => Promise<void>;
};

const page = readFileSync(join(import.meta.dirname, "../../../../src/app/[shell]/dungeon/page.tsx"), "utf8");
const refreshSource = page.slice(page.indexOf("  const refresh ="), page.indexOf("  const create ="));
const claimSource = page.slice(page.indexOf("  const claim ="), page.indexOf("  const runs ="));
// Exercise the page's shared refresh and actual claim callback with the production cache merger.
const transpiler = new (require("bun").Transpiler)({ loader: "tsx" }) as { transformSync(source: string): string };
const claimFactory = transpiler.transformSync(`function createCallbacks() { ${refreshSource} ${claimSource} return claim; }`);

/** Use the production merge against a warmed profile and count any fallback profile read. */
const cachedProfile = (initial: Profile, read: () => Promise<Profile>) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const key = ["dungeon-cache-profile"];
  const refetch = vi.fn(read);
  client.setQueryDefaults(key, { queryFn: refetch });
  client.setQueryData(key, initial);
  const refetchState = vi.fn(async () => undefined);
  const callbacks = new Function("prepareUserUpdate", "updateUser", "api", "state", "setMessage", "setAbandonId", "showMutationToast", "setIsHistoryOpen", "user", `${claimFactory}\nreturn createCallbacks();`)(
    () => prepareUserUpdate(client, key),
    (patch: UserPatch | undefined, options: UserUpdateOptions) => updateUserCache(client, key, patch, options),
    { coop: { dungeon: { claim: { useMutation: (options: ClaimCallbacks) => options } } } },
    { refetch: refetchState }, vi.fn(), vi.fn(), vi.fn(), vi.fn(), initial.userData,
  ) as ClaimCallbacks;
  return { client, key, refetch, refetchState, callbacks, current: () => client.getQueryData<Profile>(key)! };
};

describeWithDatabase("confirmed dungeon reward progression", () => {
  beforeEach(async () => {
    stubRateLimitTransport({ unexpectedRequestMessage: "Unexpected HTTP request in dungeon cache tests" });
    await resetTables(battle, dungeonMember, dungeonRun, dungeon, questHistory, quest, userRewards, userVote, userData, gameSetting, clan, village);
    await insertUsers([{ userId, username: "DungeonCache", role: "USER", rank: "JONIN", level: 50,
      primaryElement: "Fire", secondaryElement: "Water", status: "AWAKE", isOutlaw: true,
      money: 0, earnedExperience: 0, reputationPoints: 0, reputationPointsTotal: 0, medicalExperience: 0,
      huntingExperience: 0, craftingExperience: 0, gatheringExperience: 0, regeneration: 0,
      updatedAt: new Date(), regenAt: new Date() }]);
    const db = await getTestDatabase();
    await db.insert(userVote).values({ id: "dungeon-cache-vote", userId, secret: "dungeon1", lastVoteAt: new Date() });
    await insertQuests([{ id: "dungeon-completion", questType: "achievement", content: {
      objectives: [SimpleObjective.parse({ id: "completion", task: "dungeons_completed", value: 1 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
  });
  afterEach(() => { clients.splice(0).forEach((client) => client.clear()); vi.restoreAllMocks(); });

  const completedRun = async (rewards: Record<string, unknown> = {}) => {
    const db = await getTestDatabase();
    const content = dungeonContent();
    content.rewards.tokens = 0;
    content.rewards.prestige = 0;
    content.rewards.drops = Object.keys(rewards).length ? [{ type: "package", id: "progress", chance: 100, quantity: 1,
      package: { name: "Progress", description: "", rewards: ObjectiveReward.parse(rewards) } }] : [];
    await db.insert(dungeonRun).values({ id: "completed-run", dungeonId: "definition", leaderId: userId, content,
      status: "COMPLETED", createdAt: new Date(), state: { ...dungeonBattleState().runState,
        memberIds: [userId], floor: 5, clearedFloors: [0, 1, 2, 3, 4] } });
    await db.insert(dungeonMember).values({ runId: "completed-run", userId });
    return callerForDatabase(dungeonRouter, userId, db);
  };

  it.each([
    ["reputation_points", "reward_reputation", "reputationPointsTotal"],
    ["medical_experience", "reward_medical_experience", "medicalExperience"],
    ["hunting_experience", "reward_hunting_experience", "huntingExperience"],
    ["crafting_experience", "reward_crafting_experience", "craftingExperience"],
    ["gathering_experience", "reward_gathering_experience", "gatheringExperience"],
  ] as const)("confirms the %s payout and merges completion on claim and receipt replay", async (task, field, counter) => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "reward-progress", questType: "achievement", content: {
      objectives: [SimpleObjective.parse({ id: "reward", task, value: 1 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    const profile = callerForDatabase(profileRouter, userId, db);
    expect(goal(await profile.getUser(), "dungeon-completion")).toMatchObject({ done: false, value: 0 });
    const api = await completedRun({ [field]: 1 });
    // Battle-ended profile refresh sees completion before the receipt is claimed.
    const initial = await profile.getUser();
    expect(goal(initial, "dungeon-completion")).toMatchObject({ done: true, value: 1 });
    expect(goal(initial, "reward-progress")).toMatchObject({ done: false, value: 0 });
    const cache = cachedProfile(initial, () => profile.getUser());
    for (const money of [100, 109]) {
      if (money === 109) await db.update(userData).set({ money }).where(eq(userData.userId, userId));
      const revision = prepareUserUpdate(cache.client, cache.key);
      const response = userDeltaResponseSchema.parse(await api.claim({ id: "completed-run" }));
      expect(response.success).toBe(true);
      await updateUserCache(cache.client, cache.key, response.userPatch, { revision,
        achievementProgress: response.achievementProgress });
      expect(cache.refetch).not.toHaveBeenCalled();
      expect(cache.current().userData).toMatchObject({ money, [counter]: 1, dungeonsCompleted: 1 });
      expect(goal(cache.current(), "reward-progress")).toMatchObject({ done: true, value: 1 });
      expect(cache.current().achievementProgress?.find((entry) => entry.questId === "reward-progress")).toBeDefined();
      const saved = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
      expect(saved).toMatchObject({ money, [counter]: 1 });
      expect(saved?.questData?.find((entry) => entry.id === "dungeon-completion")?.goals[0]).toMatchObject({ done: true, value: 1 });
    }
    expect(goal(cache.current(), "reward-progress")).toEqual(goal(await profile.getUser(), "reward-progress"));
  });

  it("keeps scalar-only claims and receipt replay narrow after completion was reconciled", async () => {
    const db = await getTestDatabase();
    const profile = callerForDatabase(profileRouter, userId, db);
    await profile.getUser();
    const api = await completedRun();
    const initial = await profile.getUser();
    expect(goal(initial, "dungeon-completion")).toMatchObject({ done: true, value: 1 });
    const cache = cachedProfile(initial, () => profile.getUser());
    const hydration = vi.spyOn(profileQueries, "fetchUpdatedUser");
    for (let claim = 0; claim < 2; claim++) {
      const revision = cache.callbacks.onMutate();
      const response = userDeltaResponseSchema.parse(await api.claim({ id: "completed-run" }));
      expect(response.userPatch).not.toHaveProperty("questData");
      expect(response.achievementProgress).toBeUndefined();
      await cache.callbacks.onSuccess(response, undefined, revision);
    }
    expect(hydration).not.toHaveBeenCalled();
    expect(cache.refetch).not.toHaveBeenCalled();
    expect(cache.current().userData).toMatchObject({ money: 100, earnedExperience: 10, dungeonsCompleted: 1 });
    expect(goal(cache.current(), "dungeon-completion")).toEqual(goal(initial, "dungeon-completion"));
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ money: 100, earnedExperience: 10 });
  });

  it.each([null, "other-village"])("preserves unrelated membership snapshots on scalar claim and replay after the village changes to %s", async (villageId) => {
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "cached-village", name: "Cached village", sector: 1, kageId: "" },
      { id: "other-village", name: "Other village", sector: 2, kageId: "" },
    ]);
    await db.insert(clan).values({ id: "cached-clan", name: "Cached clan", image: "clan.png",
      villageId: "cached-village", founderId: userId, leaderId: userId, leaderOrderId: "order" });
    await db.update(userData).set({ isOutlaw: false, villageId: "cached-village", clanId: "cached-clan" }).where(eq(userData.userId, userId));
    const profile = callerForDatabase(profileRouter, userId, db);
    await profile.getUser();
    const api = await completedRun();
    const initial = await profile.getUser();
    expect(goal(initial, "dungeon-completion")?.done).toBe(true);
    expect(initial.userData?.village?.name).toBe("Cached village");
    expect(initial.userData?.clan?.name).toBe("Cached clan");
    const cache = cachedProfile(initial, () => profile.getUser());
    const hydration = vi.spyOn(profileQueries, "fetchUpdatedUser");
    // Scalar receipts leave unrelated membership snapshots intact.
    await db.update(userData).set({ villageId, clanId: null }).where(eq(userData.userId, userId));
    for (const money of [100, 109]) {
      if (money === 109) await db.update(userData).set({ money }).where(eq(userData.userId, userId));
      const revision = cache.callbacks.onMutate();
      const response = userDeltaResponseSchema.parse(await api.claim({ id: "completed-run" }));
      expect(response.success).toBe(true);
      await cache.callbacks.onSuccess(response, undefined, revision);
      expect(cache.current().userData?.villageId).toBe("cached-village");
      expect(cache.current().userData?.village).toEqual(initial.userData?.village);
      expect(cache.current().userData?.clanId).toBe("cached-clan");
      expect(cache.current().userData?.clan).toEqual(initial.userData?.clan);
      expect(cache.current().userData?.money).toBe(money);
      expect(cache.current().userData?.earnedExperience).toBe(10);
      expect(cache.current().userData?.dungeonsCompleted).toBe(1);
      expect(goal(cache.current(), "dungeon-completion")).toEqual(goal(initial, "dungeon-completion"));
    }
    expect(hydration).not.toHaveBeenCalled();
    expect(cache.refetch).not.toHaveBeenCalled();
    const saved = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
    expect(saved?.villageId).toBe(villageId);
    expect(saved?.clanId).toBeNull();
    expect(saved?.money).toBe(109);
    expect(saved?.earnedExperience).toBe(10);
  });

  it.each([false, true])("reconciles a polled completion through the claim callback (delayed profile refresh: %s)", async (delayedRefresh) => {
    const db = await getTestDatabase();
    const profile = callerForDatabase(profileRouter, userId, db);
    const initial = await profile.getUser();
    expect(goal(initial, "dungeon-completion")).toMatchObject({ done: false, value: 0 });
    const cache = cachedProfile(initial, () => profile.getUser());
    const meta = dungeonBattleState({ runState: { memberIds: [userId], invitedIds: [], readyIds: [], floor: 4, clearedFloors: [0, 1, 2, 3], message: "" } });
    const content = dungeonContent();
    content.rewards.tokens = 0;
    content.rewards.prestige = 0;
    await db.insert(dungeonRun).values({ id: "run", dungeonId: "definition", leaderId: userId, content,
      state: meta.runState, status: "FIGHTING", version: 1, battleId: "fight", expiresAt: new Date(meta.expiresAt), createdAt: new Date() });
    await db.insert(dungeonMember).values({ runId: "run", userId });
    await db.update(userData).set({ status: "BATTLE", battleId: "fight" }).where(eq(userData.userId, userId));
    const fight = makeCompleteBattle({ id: "fight", battleType: "QUEST", version: 0, round: 0, width: 12, height: 10,
      rewardScaling: 0, forceKeepPools: true, activeUserId: userId, createdAt: new Date(), updatedAt: new Date(), roundStartAt: new Date(), background: "default",
      usersState: [makeUser({ userId, direction: "left" }), makeUser({ userId: "enemy", direction: "right", isAi: true, curHealth: 0 })],
      extraState: { dungeon: meta, energyRegeneration: { [userId]: 0 }, energyCapacity: { [userId]: 100 } } });
    await db.insert(battle).values(fight);
    expect(await settleDungeonBattle(db, fight, 0)).toBe(true);
    const api = callerForDatabase(dungeonRouter, userId, db);
    const state = await api.getState();
    expect(state.runs[0]).toMatchObject({ status: "COMPLETED" });
    expect(state.members[0]?.reward).toBeNull();
    const savedBeforeClaim = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
    expect(savedBeforeClaim?.questData?.find((entry) => entry.id === "dungeon-completion")?.goals[0]?.done).not.toBe(true);
    // The callback was created from the older render. Its functional patch must inspect the live cache.
    if (delayedRefresh) cache.client.setQueryData(cache.key, await profile.getUser());
    for (let claim = 0; claim < 2; claim++) {
      const revision = cache.callbacks.onMutate();
      const response = userDeltaResponseSchema.parse(await api.claim({ id: "run" }));
      expect(response.success).toBe(true);
      expect(response.userPatch).not.toHaveProperty("questData");
      await cache.callbacks.onSuccess(response, undefined, revision);
      expect(cache.current().userData).toMatchObject({ money: 100, earnedExperience: 10, dungeonsCompleted: 1 });
      expect(goal(cache.current(), "dungeon-completion")).toMatchObject({ done: true, value: 1 });
      expect(cache.current().achievementProgress?.find((entry) => entry.questId === "dungeon-completion")).toBeDefined();
      expect(cache.refetch).toHaveBeenCalledTimes(delayedRefresh ? 0 : 1);
    }
    expect(cache.refetchState).toHaveBeenCalledTimes(2);
    expect(goal(cache.current(), "dungeon-completion")).toEqual(goal(await profile.getUser(), "dungeon-completion"));
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ money: 100, earnedExperience: 10 });
  });

  it.each(["unavailable", "missing", "mastery unavailable"] as const)("keeps delivered receipts successful and reconciles the profile when confirmation is %s", async (failure) => {
    const db = await getTestDatabase();
    const profile = callerForDatabase(profileRouter, userId, db);
    const api = await completedRun();
    const cache = cachedProfile(await profile.getUser(), () => profile.getUser());
    if (failure === "mastery unavailable") vi.spyOn(skillQueries, "fetchMasterySources").mockRejectedValueOnce(new Error("Mastery confirmation unavailable"));
    else {
      const confirmation = vi.spyOn(dungeonQueries, "findDungeonRewardUserCache");
      if (failure === "missing") confirmation.mockResolvedValueOnce(undefined);
      else confirmation.mockRejectedValueOnce(new Error("Dungeon confirmation unavailable"));
    }
    const revision = cache.callbacks.onMutate();
    const result = userDeltaResponseSchema.parse(await api.claim({ id: "completed-run" }));
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    await cache.callbacks.onSuccess(result, undefined, revision);
    expect(cache.refetch).toHaveBeenCalledTimes(1);
    expect(cache.current().userData).toMatchObject({ money: 100, earnedExperience: 10, dungeonsCompleted: 1 });
    expect((await api.claim({ id: "completed-run" })).success).toBe(true);
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ money: 100, earnedExperience: 10 });
    expect(await db.query.dungeonMember.findFirst()).toMatchObject({ reward: { money: 100 } });
  });

  it("propagates canonical progression failures after a relation-changing receipt", async () => {
    const db = await getTestDatabase();
    const api = await completedRun({ reward_rank: "JONIN" });
    const progression = vi.spyOn(profileQueries, "fetchUpdatedUser").mockRejectedValueOnce(new Error("Dungeon progression unavailable"));
    await expect(api.claim({ id: "completed-run" })).rejects.toThrow("Dungeon progression unavailable");
    expect(progression).toHaveBeenCalledTimes(1);
    expect(await db.query.dungeonMember.findFirst()).toMatchObject({ reward: { money: 100 } });
  });

  it("reconciles mastery and village membership from the committed receipt without granting twice", async () => {
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "former-village", name: "Former", sector: 1, kageId: "" },
      { id: "reward-village", name: "AKIKAZE", sector: 2, kageId: "" },
    ]);
    await db.update(userData).set({ isOutlaw: false, villageId: "former-village" }).where(eq(userData.userId, userId));
    const profile = callerForDatabase(profileRouter, userId, db);
    const cache = cachedProfile(await profile.getUser(), () => profile.getUser());
    const api = await completedRun({ reward_ninjutsu_experience: 5, reward_village_membership: "AKIKAZE" });
    for (let claim = 0; claim < 2; claim++) {
      const revision = cache.callbacks.onMutate();
      const response = userDeltaResponseSchema.parse(await api.claim({ id: "completed-run" }));
      expect(response.success).toBe(true);
      expect(response.userPatch?.questData).toBeDefined();
      await cache.callbacks.onSuccess(response, undefined, revision);
      expect(cache.refetch).not.toHaveBeenCalled();
      expect(cache.current().userData).toMatchObject({ money: 100, ninjutsuMastery: 15,
        effectiveMasteries: { ninjutsuMastery: 15 }, isOutlaw: false,
        villageId: "reward-village", village: { id: "reward-village" }, dungeonsCompleted: 1 });
      expect(goal(cache.current(), "dungeon-completion")).toMatchObject({ done: true, value: 1 });
    }
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ money: 100, ninjutsuMastery: 15 });
  });

  it("reconciles progression for a legacy receipt without its complete reward payload", async () => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "legacy-progress", questType: "achievement", content: {
      objectives: [SimpleObjective.parse({ id: "medical", task: "medical_experience", value: 1 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    const profile = callerForDatabase(profileRouter, userId, db);
    const api = await completedRun();
    await api.claim({ id: "completed-run" });
    const cache = cachedProfile(await profile.getUser(), () => profile.getUser());
    const member = await db.query.dungeonMember.findFirst();
    if (!member?.reward) throw new Error("Missing completion receipt");
    const { rewards: _rewards, ...legacyReceipt } = member.reward;
    await db.update(dungeonMember).set({ reward: legacyReceipt });
    await db.update(userData).set({ medicalExperience: 1 }).where(eq(userData.userId, userId));
    const revision = prepareUserUpdate(cache.client, cache.key);
    const response = userDeltaResponseSchema.parse(await api.claim({ id: "completed-run" }));
    await updateUserCache(cache.client, cache.key, response.userPatch, { revision,
      achievementProgress: response.achievementProgress });
    expect(cache.refetch).not.toHaveBeenCalled();
    expect(cache.current().userData).toMatchObject({ money: 100, medicalExperience: 1 });
    expect(goal(cache.current(), "legacy-progress")).toMatchObject({ done: true, value: 1 });
    expect(goal(cache.current(), "legacy-progress")).toEqual(goal(await profile.getUser(), "legacy-progress"));
  });
});
