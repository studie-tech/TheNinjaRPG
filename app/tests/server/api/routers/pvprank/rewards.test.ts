import { RANKED_ENTRY_COST } from "@/drizzle/constants";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import { anbuSquad, war, quest, questHistory, rankedSeason, rankedUserRewards, userData, village } from "@/drizzle/schema";
import { pvpRankRouter } from "@/server/api/routers/pvprank";
import { fetchUpdatedUser, profileRouter } from "@/server/api/routers/profile";
import * as profileApi from "@/server/api/routers/profile";
import { withRequestScope } from "@/server/requestScope";
import { userDeltaResponseSchema } from "@/validators/userCache";
import { prepareUserUpdate, updateUserCache, type UserPatch, type UserUpdateOptions } from "@/utils/userCache";
import { ObjectiveReward } from "@/validators/rewards";
import { InstantNewQuestObjective, SimpleObjective } from "@/validators/objectives";
import { insertQuests, insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

type Profile = Awaited<ReturnType<ReturnType<typeof profileRouter.createCaller>["getUser"]>>;
const cleanups: (() => void)[] = [];
/** Exercise the claim callback with the mounted application's active profile query. */
const cachedProfile = async () => {
  const profile = await callerFor(profileRouter, "claimant");
  const initial = await profile.getUser();
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["ranked-loyalty-profile"];
  cache.setQueryData(key, initial);
  const read = vi.fn(() => profile.getUser());
  const observer = new QueryObserver(cache, { queryKey: key, queryFn: read, staleTime: Infinity });
  const stop = observer.subscribe(() => {});
  cleanups.push(() => { stop(); cache.clear(); });
  const source = readFileSync(join(import.meta.dirname, "../../../../../src/layout/UnclaimedSeasonRewards.tsx"), "utf8");
  const callback = source.slice(source.indexOf("api.pvpRank.claimSeasonRewards.useMutation(")).match(/useMutation\((\{[\s\S]*?\n  \})\);/)?.[1];
  if (!callback) throw new Error("Season reward callbacks were not found");
  const options = new Function("utils", "prepareUserUpdate", "updateUser", "showRewardToast", `return (${callback});`)(
    { pvpRank: { getUnclaimedUserSeasonRewards: { invalidate: vi.fn(async () => {}) } } },
    () => prepareUserUpdate(cache, key),
    (patch: UserPatch | undefined, update: UserUpdateOptions) => updateUserCache(cache, key, patch, update),
    vi.fn(),
  ) as { onMutate: () => number | undefined; onSuccess: (data: unknown, input: unknown, revision: number | undefined) => Promise<void> };
  const revision = options.onMutate();
  return {
    cache, key, initial, read, current: () => cache.getQueryData<Profile>(key)!,
    complete: (result: unknown) => options.onSuccess(result, undefined, revision),
  };
};

describeWithDatabase("ranked season reward loyalty", () => {
  beforeEach(async () => {
    await resetTables(questHistory, quest, rankedUserRewards, rankedSeason, userData, village, anbuSquad, war);
    const db = await getTestDatabase();
    await db.insert(village).values({ id: "reward-village", name: "Reward village", kageId: "", tokens: 0 });
    await insertUsers([{ userId: "claimant", villageId: "reward-village", joinedVillageAt: new Date(Date.now() - 100 * 86_400_000), villagePrestige: 0, money: 0 }]);
    await db.insert(rankedSeason).values({ id: "season", name: "Season", description: "", startDate: new Date(0), endDate: new Date(0), rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_tokens: 1000, reward_prestige: 1000, reward_money: 1000 }) }] });
    await db.insert(rankedUserRewards).values({ id: "prize", userId: "claimant", seasonId: "season", division: "Wood" });
  });

  afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); vi.restoreAllMocks(); });

  it("reconciles ANBU points through the shared response parser after a warmed read", async () => {
    const db = await getTestDatabase();
    await db.insert(anbuSquad).values({ id: "reward-squad", name: "Reward squad", image: "", villageId: "reward-village", kageOrderId: "", leaderOrderId: "" });
    await db.update(userData).set({ anbuId: "reward-squad" }).where(eq(userData.userId, "claimant"));
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_anbupoints: 50 }) }] }).where(eq(rankedSeason.id, "season"));
    const cached = await cachedProfile();
    const hydration = vi.spyOn(profileApi, "fetchUpdatedUser");
    const result = await withRequestScope(async () => {
      await fetchUpdatedUser({ client: db, userId: "claimant" });
      const reads = hydration.mock.calls.length;
      const response = await (await callerFor(pvpRankRouter, "claimant")).claimSeasonRewards();
      expect(hydration).toHaveBeenCalledTimes(reads);
      return response;
    });
    const parsed = userDeltaResponseSchema.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.userPatch).toBeUndefined();
    expect(parsed.userDelta).toBeUndefined();
    await cached.complete(parsed);
    expect(cached.read).toHaveBeenCalledTimes(1);
    expect(cached.current().userData).toMatchObject({ anbuId: "reward-squad", anbuSquad: { id: "reward-squad", name: "Reward squad", points: 50 }, sageModeId: null, sageMode: null });
    expect(await db.query.anbuSquad.findFirst({ where: eq(anbuSquad.id, "reward-squad") })).toMatchObject({ points: 50 });
  });

  it("rebuilds faction notices when a reward moves the player to a different village", async () => {
    const db = await getTestDatabase();
    await db.insert(village).values({ id: "new-village", name: "AKIKAZE", sector: 2, kageId: "" });
    await db.insert(war).values({ id: "former-war", type: "SECTOR_WAR", status: "ACTIVE", attackerVillageId: "other-village", defenderVillageId: "reward-village", sector: 30 });
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_village_membership: "AKIKAZE" }) }] }).where(eq(rankedSeason.id, "season"));
    const cached = await cachedProfile();
    expect(cached.initial.userData).toMatchObject({ activeWars: [{ id: "former-war" }] });
    const hydration = vi.spyOn(profileApi, "fetchUpdatedUser");
    const result = await (await callerFor(pvpRankRouter, "claimant")).claimSeasonRewards();
    expect(result.success).toBe(true);
    if (!("rewards" in result)) throw new Error(result.message);
    expect(result.userPatch).toBeUndefined();
    expect(hydration).not.toHaveBeenCalled();
    await cached.complete(result);
    expect(cached.read).toHaveBeenCalledTimes(1);
    expect(cached.current().userData).toMatchObject({ villageId: "new-village", village: { id: "new-village" }, activeWars: [] });
    expect(cached.current().notifications.some((entry) => entry.name.includes("Sector 30"))).toBe(false);
  });

  it("reconciles derived progression for rank rewards through the canonical profile", async () => {
    const db = await getTestDatabase();
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_rank: "JONIN", reward_money: 100 }) }] }).where(eq(rankedSeason.id, "season"));
    const cached = await cachedProfile();
    const hydration = vi.spyOn(profileApi, "fetchUpdatedUser");
    const result = await (await callerFor(pvpRankRouter, "claimant")).claimSeasonRewards();
    expect(result.success).toBe(true);
    if (!("rewards" in result)) throw new Error(result.message);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(hydration).not.toHaveBeenCalled();
    await cached.complete(result);
    expect(cached.read).toHaveBeenCalledTimes(1);
    expect(cached.current().userData).toMatchObject({ rank: "JONIN", money: 100, villageId: "reward-village", effectiveMasteries: expect.any(Object), maxEnergy: expect.any(Number) });
  });

  it("leaves quest feedback for canonical recovery after a membership reward", async () => {
    const db = await getTestDatabase();
    await db.insert(village).values({ id: "new-village", name: "AKIKAZE", sector: 2, kageId: "" });
    await db.update(userData).set({ role: "OWNER", rank: "JONIN", level: 50 }).where(eq(userData.userId, "claimant"));
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_village_membership: "AKIKAZE" }) }] }).where(eq(rankedSeason.id, "season"));
    const content = { objectives: [SimpleObjective.parse({ id: "arena", task: "arena_kills", value: 100 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] };
    await insertQuests([
      { id: "destination-tier", questType: "tier", requiredVillage: "new-village", requiredLevel: 1, maxLevel: 100, hidden: false,
        content: { ...content, objectives: [InstantNewQuestObjective.parse({ id: "start-child", task: "new_quest", newQuestIds: ["child-mission"] })] } },
      { id: "child-mission", name: "New Child Mission", questType: "mission", requiredVillage: "new-village", content, hidden: false },
    ]);
    await db.insert(questHistory).values({ id: "paused-tier", userId: "claimant", questId: "destination-tier", questType: "tier" });
    const cached = await cachedProfile();
    expect(cached.initial.userData?.userQuests).toEqual([]);
    const hydration = vi.spyOn(profileApi, "fetchUpdatedUser");
    const result = await (await callerFor(pvpRankRouter, "claimant")).claimSeasonRewards();
    expect(result.success).toBe(true);
    if (!("rewards" in result)) throw new Error(result.message);
    const parsed = userDeltaResponseSchema.parse(result);
    expect(parsed.userPatch).toBeUndefined();
    expect(parsed.announcements).toBeUndefined();
    expect(hydration).not.toHaveBeenCalled();
    expect(await db.query.questHistory.findFirst({ where: eq(questHistory.questId, "child-mission") })).toBeUndefined();
    await cached.complete(parsed);
    expect(cached.read).toHaveBeenCalledTimes(1);
    const message = "Started new quest: New Child Mission";
    expect(cached.current().notifications).toContainEqual(expect.objectContaining({ color: "toast", name: message }));
    expect(await db.query.questHistory.findMany({ where: eq(questHistory.questId, "child-mission") })).toHaveLength(1);
    // Canonical settlement admits the child; the next profile read loads its objectives.
    await cached.cache.invalidateQueries({ queryKey: cached.key, exact: true });
    expect(cached.current().userData?.userQuests.some((entry) => entry.questId === "child-mission")).toBe(true);
    expect(cached.current().notifications.some((entry) => entry.name === message)).toBe(false);
    expect(await db.query.questHistory.findMany({ where: eq(questHistory.questId, "child-mission") })).toHaveLength(1);
  });

  it.each([false, true])("scales earned prestige and tokens once, with outlaw=%s", async (isOutlaw) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ isOutlaw }).where(eq(userData.userId, "claimant"));
    const caller = await callerFor(pvpRankRouter, "claimant");
    const cached = await cachedProfile();
    const hydration = vi.spyOn(profileApi, "fetchUpdatedUser");
    const amount = isOutlaw ? 1000 : 1130;
    const result = await caller.claimSeasonRewards();
    expect(result).toMatchObject({ success: true, rewards: { reward_tokens: amount, reward_prestige: amount, reward_money: 1000 } });
    if (!("rewards" in result)) throw new Error(result.message);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(hydration).not.toHaveBeenCalled();
    await cached.complete(result);
    expect(cached.read).toHaveBeenCalledTimes(1);
    expect(cached.current().userData).toMatchObject({ money: 1000, villagePrestige: amount, village: { id: "reward-village", tokens: amount } });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "claimant") })).toMatchObject({ villagePrestige: amount, money: 1000 });
    expect(await db.query.village.findFirst({ where: eq(village.id, "reward-village") })).toMatchObject({ tokens: amount });
    expect((await caller.claimSeasonRewards()).success).toBe(false);
    expect(await db.query.village.findFirst({ where: eq(village.id, "reward-village") })).toMatchObject({ tokens: amount });
  });
});

 describeWithDatabase("ranked entry cache updates", () => {
  it("charges only one concurrent entry and returns the committed counter changes", async () => {
    const db = await getTestDatabase();
    await resetTables(userData);
    await insertUsers([{ userId: "entrant", rank: "JONIN", villagePrestige: RANKED_ENTRY_COST * 2, rankedLp: 0 }]);
    const caller = await callerFor(pvpRankRouter, "entrant");
    const results = await Promise.all([caller.enterRankedSeason(), caller.enterRankedSeason()]);
    const succeeded = results.filter((result) => result.success);
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0]).toMatchObject({ userPatch: { rankedLp: 150 }, userDelta: { villagePrestige: -RANKED_ENTRY_COST } });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "entrant") })).toMatchObject({ rankedLp: 150, villagePrestige: RANKED_ENTRY_COST });
  });
});
