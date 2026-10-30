import { RANKED_ENTRY_COST } from "@/drizzle/constants";
import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { anbuSquad, war, quest, questHistory, rankedSeason, rankedUserRewards, userData, village } from "@/drizzle/schema";
import { pvpRankRouter } from "@/server/api/routers/pvprank";
import { fetchUpdatedUser, profileRouter } from "@/server/api/routers/profile";
import { withRequestScope } from "@/server/requestScope";
import { userDeltaResponseSchema } from "@/validators/userCache";
import { ObjectiveReward } from "@/validators/rewards";
import { InstantNewQuestObjective, SimpleObjective } from "@/validators/objectives";
import { insertQuests, insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

describeWithDatabase("ranked season reward loyalty", () => {
  beforeEach(async () => {
    await resetTables(questHistory, quest, rankedUserRewards, rankedSeason, userData, village, anbuSquad, war);
    const db = await getTestDatabase();
    await db.insert(village).values({ id: "reward-village", name: "Reward village", kageId: "", tokens: 0 });
    await insertUsers([{ userId: "claimant", villageId: "reward-village", joinedVillageAt: new Date(Date.now() - 100 * 86_400_000), villagePrestige: 0, money: 0 }]);
    await db.insert(rankedSeason).values({ id: "season", name: "Season", description: "", startDate: new Date(0), endDate: new Date(0), rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_tokens: 1000, reward_prestige: 1000, reward_money: 1000 }) }] });
    await db.insert(rankedUserRewards).values({ id: "prize", userId: "claimant", seasonId: "season", division: "Wood" });
  });

  it("retains confirmed ANBU points through the shared response parser after a warmed read", async () => {
    const db = await getTestDatabase();
    await db.insert(anbuSquad).values({ id: "reward-squad", name: "Reward squad", image: "", villageId: "reward-village", kageOrderId: "", leaderOrderId: "" });
    await db.update(userData).set({ anbuId: "reward-squad" }).where(eq(userData.userId, "claimant"));
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_anbupoints: 50 }) }] }).where(eq(rankedSeason.id, "season"));
    const result = await withRequestScope(async () => {
      await fetchUpdatedUser({ client: db, userId: "claimant" });
      return (await callerFor(pvpRankRouter, "claimant")).claimSeasonRewards();
    });
    expect(result).toMatchObject({ success: true, userPatch: { anbuId: "reward-squad", anbuSquad: { id: "reward-squad", name: "Reward squad", points: 50 } } });
    const parsed = userDeltaResponseSchema.parse(result);
    expect(parsed.userPatch).toMatchObject({ anbuId: "reward-squad", anbuSquad: { id: "reward-squad", points: 50 }, sageModeId: null, sageMode: null });
    expect(await db.query.anbuSquad.findFirst({ where: eq(anbuSquad.id, "reward-squad") })).toMatchObject({ points: 50 });
  });

  it("rebuilds faction notices when a reward moves the player to a different village", async () => {
    const db = await getTestDatabase();
    await db.insert(village).values({ id: "new-village", name: "AKIKAZE", sector: 2, kageId: "" });
    await db.insert(war).values({ id: "former-war", type: "SECTOR_WAR", status: "ACTIVE", attackerVillageId: "other-village", defenderVillageId: "reward-village", sector: 30 });
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_village_membership: "AKIKAZE" }) }] }).where(eq(rankedSeason.id, "season"));
    const result = await (await callerFor(pvpRankRouter, "claimant")).claimSeasonRewards();
    expect(result).toMatchObject({ success: true, userPatch: { villageId: "new-village", village: { id: "new-village" }, activeWars: [] } });
  });

  it("returns derived progression for rank rewards without another profile request", async () => {
    const db = await getTestDatabase();
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_rank: "JONIN", reward_money: 100 }) }] }).where(eq(rankedSeason.id, "season"));
    const result = await (await callerFor(pvpRankRouter, "claimant")).claimSeasonRewards();
    expect(result).toMatchObject({ success: true, userDelta: {}, userPatch: { rank: "JONIN", money: 100, villageId: "reward-village" } });
    expect(result).toMatchObject({ userPatch: { effectiveMasteries: expect.any(Object), maxEnergy: expect.any(Number) } });
  });

  it("returns consumed quest feedback when reward hydration requires a canonical profile", async () => {
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
    const profile = await callerFor(profileRouter, "claimant");
    expect((await profile.getUser()).userData?.userQuests).toEqual([]);
    const result = await (await callerFor(pvpRankRouter, "claimant")).claimSeasonRewards();
    expect(result.success).toBe(true);
    const parsed = userDeltaResponseSchema.parse(result);
    expect(parsed.userPatch).toBeUndefined();
    expect(parsed.announcements).toContain("Started new quest: New Child Mission");
    const canonical = await profile.getUser();
    expect(canonical.userData?.userQuests.some((entry) => entry.questId === "child-mission")).toBe(true);
    expect(canonical.notifications.some((entry) => entry.name === "Started new quest: New Child Mission")).toBe(false);
  });

  it.each([false, true])("scales earned prestige and tokens once, with outlaw=%s", async (isOutlaw) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ isOutlaw }).where(eq(userData.userId, "claimant"));
    const caller = await callerFor(pvpRankRouter, "claimant");
    const amount = isOutlaw ? 1000 : 1130;
    const result = await caller.claimSeasonRewards();
    expect(result).toMatchObject({ success: true, userDelta: {}, userPatch: { money: 1000, villagePrestige: amount, village: { id: "reward-village", tokens: amount } }, rewards: { reward_tokens: amount, reward_prestige: amount, reward_money: 1000 } });
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
