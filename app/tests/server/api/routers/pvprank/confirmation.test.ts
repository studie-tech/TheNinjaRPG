import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { gameSetting, notification, quest, questHistory, rankedSeason, rankedUserRewards, userData, userVote } from "@/drizzle/schema";
import * as questQueries from "@/queries/quests";
import * as profile from "@/server/api/routers/profile";
import { pvpRankRouter } from "@/server/api/routers/pvprank";
import { prepareUserUpdate, updateUserCache, type UserPatch, type UserUpdateOptions } from "@/utils/userCache";
import { InstantNewQuestObjective, SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuestHistory, insertQuests, insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const userId = "reward-confirmation-player";

describeWithDatabase("ranked reward confirmation recovery", () => {
  beforeEach(async () => {
    await resetTables(rankedUserRewards, rankedSeason, notification, questHistory, quest, userVote, userData, gameSetting);
    await insertUsers([{ userId, username: "RewardConfirmation", role: "USER", rank: "JONIN", level: 50,
      primaryElement: "Fire", secondaryElement: "Water", status: "AWAKE", isOutlaw: true,
      regeneration: 0, money: 0, updatedAt: new Date(), regenAt: new Date() }]);
    const db = await getTestDatabase();
    await db.insert(userVote).values({ id: "confirmation-vote", userId, secret: "confirm1", lastVoteAt: new Date() });
    await db.insert(rankedSeason).values({ id: "confirmation-season", name: "Confirmation Season", description: "", startDate: new Date(0), endDate: new Date(0), rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_money: 100 }) }] });
    await db.insert(rankedUserRewards).values({ id: "confirmation-receipt", userId, seasonId: "confirmation-season", division: "Wood" });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["unavailable", "missing"] as const)("reconciles the paid profile and clears the receipt through the actual callback when confirmation is %s", async (failure) => {
    const db = await getTestDatabase();
    const api = await callerFor(pvpRankRouter, userId);
    const profileApi = await callerFor(profile.profileRouter, userId);
    const initial = await profileApi.getUser();
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = [["profile", "getUser"], { type: "query" }];
    cache.setQueryData(key, initial);
    const getUser = vi.fn(() => profileApi.getUser());
    const observer = new QueryObserver(cache, { queryKey: key, queryFn: getUser, staleTime: Infinity });
    const stop = observer.subscribe(() => undefined);
    let unclaimed = await api.getUnclaimedUserSeasonRewards();
    const invalidate = vi.fn(async () => { unclaimed = await api.getUnclaimedUserSeasonRewards(); });
    const updateUser = (patch: UserPatch | undefined, options: UserUpdateOptions) => updateUserCache(cache, key, patch, options);
    const source = readFileSync(join(import.meta.dirname, "../../../../../src/layout/UnclaimedSeasonRewards.tsx"), "utf8");
    const callbacks = source.slice(source.indexOf("api.pvpRank.claimSeasonRewards.useMutation(")).match(/useMutation\((\{[\s\S]*?\n  \})\);/)?.[1];
    if (!callbacks) throw new Error("Season reward callbacks were not found");
    const options = new Function("utils", "prepareUserUpdate", "updateUser", "showRewardToast", `return (${callbacks});`)(
      { pvpRank: { getUnclaimedUserSeasonRewards: { invalidate } } }, () => prepareUserUpdate(cache, key), updateUser, vi.fn(),
    ) as { onMutate: () => number | undefined; onSuccess: (data: unknown, input: unknown, revision: number | undefined) => Promise<void> };
    const confirmation = vi.spyOn(questQueries, "findRewardUserSnapshot");
    if (failure === "unavailable") confirmation.mockRejectedValueOnce(new Error("Reward confirmation unavailable"));
    else confirmation.mockResolvedValueOnce(undefined);
    try {
      const revision = options.onMutate();
      const result = await api.claimSeasonRewards();
      expect(result.success).toBe(true);
      if (!("rewards" in result)) throw new Error(result.message);
      expect(result.userPatch).toBeUndefined();
      expect(result.userDelta).toBeUndefined();
      expect(confirmation).toHaveBeenCalledTimes(1);
      await options.onSuccess(result, undefined, revision);
      expect(getUser).toHaveBeenCalledTimes(1);
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(unclaimed).toEqual([]);
      expect(cache.getQueryData<typeof initial>(key)?.userData?.money).toBe(100);
      expect((await api.claimSeasonRewards()).success).toBe(false);
      expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ money: 100 });
      expect(await db.query.rankedUserRewards.findFirst({ where: eq(rankedUserRewards.id, "confirmation-receipt") })).toMatchObject({ claimed: true });
    } finally { stop(); cache.clear(); }
  });

  it("propagates payout failures before attempting confirmation", async () => {
    const db = await getTestDatabase();
    vi.spyOn(questQueries, "updateUserDataForUpdateRewards").mockRejectedValueOnce(new Error("Reward payout unavailable"));
    const confirmation = vi.spyOn(questQueries, "findRewardUserSnapshot");
    await expect((await callerFor(pvpRankRouter, userId)).claimSeasonRewards()).rejects.toThrow("Reward payout unavailable");
    expect(confirmation).not.toHaveBeenCalled();
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ money: 0 });
  });

  it("propagates side-effecting canonical progression failures", async () => {
    const db = await getTestDatabase();
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_rank: "JONIN", reward_money: 100 }) }] }).where(eq(rankedSeason.id, "confirmation-season"));
    const progression = vi.spyOn(profile, "fetchUpdatedUser").mockRejectedValueOnce(new Error("Canonical progression unavailable"));
    await expect((await callerFor(pvpRankRouter, userId)).claimSeasonRewards()).rejects.toThrow("Canonical progression unavailable");
    expect(progression).toHaveBeenCalledTimes(1);
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ money: 100 });
  });

  it.each(["announcement", "recruit reward"] as const)("delivers a pending %s when reconciling a claimed profession reward", async (feedback) => {
    const db = await getTestDatabase();
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_medical_experience: 1 }) }] }).where(eq(rankedSeason.id, "confirmation-season"));
    const profileApi = await callerFor(profile.profileRouter, userId);
    const initial = await profileApi.getUser();
    await db.insert(notification).values({ userId, content: "A new event has started." });
    await db.update(userData).set(feedback === "announcement" ? { unreadNotifications: 1 } : { unreadRecruitRewards: 1 }).where(eq(userData.userId, userId));
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["pending-feedback-profile"];
    const read = vi.fn(() => profileApi.getUser());
    cache.setQueryDefaults(key, { queryFn: read });
    cache.setQueryData(key, initial);
    const revision = prepareUserUpdate(cache, key);
    try {
      const caller = await callerFor(pvpRankRouter, userId);
      const result = await caller.claimSeasonRewards();
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.message);
      expect(result.userPatch).toBeUndefined();
      expect(result.userDelta).toBeUndefined();
      expect(result.achievementProgress).toBeUndefined();
      await updateUserCache(cache, key, result.userPatch, { revision, delta: result.userDelta, achievementProgress: result.achievementProgress });
      expect(read).toHaveBeenCalledTimes(1);
      const name = feedback === "announcement" ? "A new event has started." : "Your recruits earned you 1 rank milestone reward";
      expect(cache.getQueryData<typeof initial>(key)?.notifications).toContainEqual(expect.objectContaining({ color: "toast", name }));
      expect(cache.getQueryData<typeof initial>(key)?.userData?.medicalExperience).toBe(1);
      expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ unreadNotifications: 0, unreadRecruitRewards: 0, medicalExperience: 1 });
      expect((await profileApi.getUser()).notifications.some((entry) => entry.color === "toast" && entry.name === name)).toBe(false);
      expect((await caller.claimSeasonRewards()).success).toBe(false);
    } finally { cache.clear(); }
  });

  it("reconciles a quest started by reward hydration before projecting its objectives", async () => {
    const db = await getTestDatabase();
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_medical_experience: 1 }) }] }).where(eq(rankedSeason.id, "confirmation-season"));
    const profileApi = await callerFor(profile.profileRouter, userId);
    const initial = await profileApi.getUser();
    await insertQuests([
      { id: "reward-chain", name: "Reward Chain", questType: "story", content: { objectives: [InstantNewQuestObjective.parse({ id: "next", task: "new_quest", newQuestIds: ["reward-next"] })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } },
      { id: "reward-next", name: "Next Quest", questType: "story", content: { objectives: [SimpleObjective.parse({ id: "level", task: "user_level", value: 50 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } },
    ]);
    await insertQuestHistory([{ userId, questId: "reward-chain", questType: "story" }]);
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["reward-chain-profile"];
    const read = vi.fn(() => profileApi.getUser());
    cache.setQueryDefaults(key, { queryFn: read });
    cache.setQueryData(key, initial);
    const revision = prepareUserUpdate(cache, key);
    try {
      const result = await (await callerFor(pvpRankRouter, userId)).claimSeasonRewards();
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.message);
      expect(result.userPatch).toBeUndefined();
      expect(result.userDelta).toBeUndefined();
      await updateUserCache(cache, key, result.userPatch, { revision, delta: result.userDelta, achievementProgress: result.achievementProgress });
      expect(read).toHaveBeenCalledTimes(1);
      expect(cache.getQueryData<typeof initial>(key)?.userData?.questData?.find((entry) => entry.id === "reward-next")?.goals[0]).toMatchObject({ id: "level", value: 50, done: true });
      expect(await db.query.questHistory.findMany({ where: eq(questHistory.questId, "reward-next") })).toHaveLength(1);
    } finally { cache.clear(); }
  });
});
