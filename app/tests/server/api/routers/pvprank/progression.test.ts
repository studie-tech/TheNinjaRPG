import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { anbuSquad, clan, gameSetting, quest, questHistory, raidDamageThreshold, raidParticipation, rankedSeason, rankedUserRewards, userData, userVote, village, war } from "@/drizzle/schema";
import { profileRouter } from "@/server/api/routers/profile";
import { raidsRouter } from "@/server/api/routers/raids";
import { withRequestScope } from "@/server/requestScope";
import { pvpRankRouter } from "@/server/api/routers/pvprank";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";
import { countUserReads } from "../../../../setup/userReads";

const userId = "reward-progress-player";
type Profile = Awaited<ReturnType<ReturnType<typeof profileRouter.createCaller>["getUser"]>>;
const goal = (profile: Profile | undefined) => profile?.userData?.questData?.find((entry) => entry.id === "reward-progress")?.goals.find((entry) => entry.id === "reward-goal");

const cachedProfile = (initial: Profile) => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["reward-progress-profile"];
  let refetches = 0;
  cache.setQueryDefaults(key, { queryFn: async () => { refetches += 1; throw new Error("Unexpected profile refetch"); } });
  cache.setQueryData(key, initial);
  const revision = prepareUserUpdate(cache, key);
  return { cache, key, revision, refetches: () => refetches, profile: () => cache.getQueryData<Profile>(key) };
};

describeWithDatabase("ranked rewards project automatic progression", () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => Response.json(
      String(url).endsWith("/pipeline") ? [{ result: [59, 60] }] : { result: [59, 60] },
    ));
    await resetTables(raidDamageThreshold, raidParticipation, rankedUserRewards, rankedSeason, questHistory, quest, userVote, userData, gameSetting, anbuSquad, clan, village, war);
    await insertUsers([{ userId, username: "RewardProgress", role: "USER", rank: "JONIN", level: 50,
      primaryElement: "Fire", secondaryElement: "Water", status: "AWAKE", isOutlaw: true,
      regeneration: 0, money: 0, reputationPoints: 0, reputationPointsTotal: 0, medicalExperience: 0,
      huntingExperience: 0, craftingExperience: 0, gatheringExperience: 0, updatedAt: new Date(), regenAt: new Date() }]);
    const db = await getTestDatabase();
    await db.insert(userVote).values({ id: "reward-progress-vote", userId, secret: "reward01", lastVoteAt: new Date() });
    await db.insert(rankedSeason).values({ id: "reward-season", name: "Reward Season", description: "", startDate: new Date(0), endDate: new Date(0), rewards: [] });
    await db.insert(rankedUserRewards).values({ id: "reward-receipt", userId, seasonId: "reward-season", division: "Wood" });
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["reputation_points", "reward_reputation", "reputationPointsTotal"],
    ["medical_experience", "reward_medical_experience", "medicalExperience"],
    ["hunting_experience", "reward_hunting_experience", "huntingExperience"],
    ["crafting_experience", "reward_crafting_experience", "craftingExperience"],
    ["gathering_experience", "reward_gathering_experience", "gatheringExperience"],
  ] as const)("persists and merges %s after %s without refetching", async (task, rewardField, savedField) => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "reward-progress", name: "Reward Progress", questType: "achievement", hidden: false,
      content: { objectives: [SimpleObjective.parse({ id: "reward-goal", task, value: 1 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ [rewardField]: 1 }) }] }).where(eq(rankedSeason.id, "reward-season"));
    const profile = await callerFor(profileRouter, userId);
    const cached = cachedProfile(await profile.getUser());
    expect(goal(cached.profile())).toMatchObject({ value: 0, done: false });
    const result = await (await callerFor(pvpRankRouter, userId)).claimSeasonRewards();
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    await updateUserCache(cached.cache, cached.key, result.userPatch, { revision: cached.revision, delta: result.userDelta, achievementProgress: result.achievementProgress });
    expect(cached.refetches()).toBe(0);
    expect(goal(cached.profile())).toMatchObject({ value: 1, done: true });
    const saved = await db.query.userData.findFirst({ where: eq(userData.userId, userId) });
    expect(saved?.[savedField]).toBe(1);
    expect(goal(await profile.getUser())).toEqual(goal(cached.profile()));
    cached.cache.clear();
  });

  it("advances a profession objective after a raid's pre-payout profile hydration", async () => {
    const db = await getTestDatabase();
    await insertQuests([
      { id: "reward-raid", questType: "raid" },
      { id: "reward-progress", questType: "achievement", hidden: false,
        content: { objectives: [SimpleObjective.parse({ id: "reward-goal", task: "medical_experience", value: 1 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } },
    ]);
    await db.insert(raidParticipation).values({ id: "reward-participation", questId: "reward-raid", userId, damageDealt: 100 });
    await db.insert(raidDamageThreshold).values({ id: "reward-threshold", questId: "reward-raid", damageRequired: 50, rewards: ObjectiveReward.parse({ reward_medical_experience: 1 }) });
    const profile = await callerFor(profileRouter, userId);
    const cached = cachedProfile(await profile.getUser());
    const result = await withRequestScope(async () => {
      await profile.getUser();
      return (await callerFor(raidsRouter, userId)).claimDamageReward({ questId: "reward-raid", thresholdId: "reward-threshold" });
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    await updateUserCache(cached.cache, cached.key, result.userPatch, { revision: cached.revision, delta: result.userDelta, achievementProgress: result.achievementProgress });
    expect(cached.refetches()).toBe(0);
    expect(goal(cached.profile())).toMatchObject({ value: 1, done: true });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ medicalExperience: 1 });
    cached.cache.clear();
  });

  it("keeps ordinary scalar rewards on the narrow confirmation path", async () => {
    const db = await getTestDatabase();
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_money: 100 }) }] }).where(eq(rankedSeason.id, "reward-season"));
    const counted = countUserReads(db);
    const result = await pvpRankRouter.createCaller({ drizzle: counted.client, userId } as never).claimSeasonRewards();
    expect(result).toMatchObject({ success: true, userPatch: { money: 100 } });
    if (!result.success) throw new Error(result.message);
    expect(result.userPatch).not.toHaveProperty("questData");
    expect(counted.getReads()).toBe(2);
  });

  it("merges automatic expulsion, faction cleanup and current faction notices", async () => {
    const db = await getTestDatabase();
    await db.insert(village).values([{ id: "reward-home", name: "Home", sector: 10, type: "VILLAGE", kageId: "other" }, { id: VILLAGE_SYNDICATE_ID, name: "Syndicate", sector: 20, type: "OUTLAW", kageId: "other" }]);
    await db.insert(anbuSquad).values({ id: "reward-squad", name: "Reward squad", memberCount: 2, image: "", villageId: "reward-home", kageOrderId: "", leaderOrderId: "" });
    await db.insert(clan).values({ id: "reward-clan", name: "Reward clan", image: "", leaderOrderId: "", villageId: "reward-home", founderId: "other", leaderId: "other" });
    await db.insert(war).values({ id: "reward-home-war", type: "SECTOR_WAR", status: "ACTIVE", attackerVillageId: "other", defenderVillageId: "reward-home", sector: 30 });
    await db.update(userData).set({ isOutlaw: false, villageId: "reward-home", villagePrestige: 0, anbuId: "reward-squad", clanId: "reward-clan", joinedVillageAt: new Date(Date.now() - 100 * 86_400_000) }).where(eq(userData.userId, userId));
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_prestige: -1 }) }] }).where(eq(rankedSeason.id, "reward-season"));
    const cached = cachedProfile(await (await callerFor(profileRouter, userId)).getUser());
    expect(cached.profile()?.notifications?.some((entry) => entry.name === "Sector under attack (Sector 30)")).toBe(true);
    const result = await (await callerFor(pvpRankRouter, userId)).claimSeasonRewards();
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    await updateUserCache(cached.cache, cached.key, result.userPatch, { revision: cached.revision, delta: result.userDelta, achievementProgress: result.achievementProgress });
    expect(cached.refetches()).toBe(0);
    expect(cached.profile()?.userData).toMatchObject({ villageId: VILLAGE_SYNDICATE_ID, village: { id: VILLAGE_SYNDICATE_ID }, isOutlaw: true, villagePrestige: 1, clanId: null, clan: null, anbuId: null, anbuSquad: null, activeWars: [] });
    expect(cached.profile()?.notifications?.some((entry) => entry.name.includes("Sector 30"))).toBe(false);
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ villageId: VILLAGE_SYNDICATE_ID, isOutlaw: true, anbuId: null, clanId: null });
    cached.cache.clear();
  });
});
