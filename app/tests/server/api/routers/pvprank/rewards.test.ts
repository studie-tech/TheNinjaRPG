import { RANKED_ENTRY_COST } from "@/drizzle/constants";
import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { rankedSeason, rankedUserRewards, userData, village } from "@/drizzle/schema";
import { pvpRankRouter } from "@/server/api/routers/pvprank";
import { ObjectiveReward } from "@/validators/rewards";
import { insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

describeWithDatabase("ranked season reward loyalty", () => {
  beforeEach(async () => {
    await resetTables(rankedUserRewards, rankedSeason, userData, village);
    const db = await getTestDatabase();
    await db.insert(village).values({ id: "reward-village", name: "Reward village", kageId: "", tokens: 0 });
    await insertUsers([{ userId: "claimant", villageId: "reward-village", joinedVillageAt: new Date(Date.now() - 100 * 86_400_000), villagePrestige: 0, money: 0 }]);
    await db.insert(rankedSeason).values({ id: "season", name: "Season", description: "", startDate: new Date(0), endDate: new Date(0), rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_tokens: 1000, reward_prestige: 1000, reward_money: 1000 }) }] });
    await db.insert(rankedUserRewards).values({ id: "prize", userId: "claimant", seasonId: "season", division: "Wood" });
  });

  it("returns derived progression for rank rewards without another profile request", async () => {
    const db = await getTestDatabase();
    await db.update(rankedSeason).set({ rewards: [{ division: "Wood", rewards: ObjectiveReward.parse({ reward_rank: "JONIN", reward_money: 100 }) }] }).where(eq(rankedSeason.id, "season"));
    const result = await (await callerFor(pvpRankRouter, "claimant")).claimSeasonRewards();
    expect(result).toMatchObject({ success: true, userDelta: {}, userPatch: { rank: "JONIN", money: 100, villageId: "reward-village" } });
    expect(result).toMatchObject({ userPatch: { effectiveMasteries: expect.any(Object), maxEnergy: expect.any(Number) } });
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
