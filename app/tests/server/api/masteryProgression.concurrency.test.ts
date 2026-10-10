import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { MasteryNames, TOTAL_MASTERY_CAP } from "@/drizzle/constants";
import { userData, quest, questHistory } from "@/drizzle/schema";
import { masteryQuestTemplates } from "@/libs/masteryQuests";
import { isAvailableUserQuests } from "@/libs/quest";
import { masteryGainUpdates, masteryRankUpdate } from "@/server/utils/masteryProgression";
import { fetchQuestDiscoverySummaryCandidates } from "@/server/utils/questDiscovery";
import { insertUsers } from "../../setup/factories";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const id = "mastery-concurrency";
const read = async () => (await (await getTestDatabase()).select().from(userData).where(eq(userData.userId, id)))[0]!;
const grant = async (gains: Parameters<typeof masteryGainUpdates>[0]) => (await getTestDatabase()).update(userData).set(masteryGainUpdates(gains)).where(eq(userData.userId, id));

describeWithDatabase("atomic mastery caps", () => {
  beforeEach(async () => { await resetTables(userData, quest, questHistory); });
  it("shares the last total points between simultaneous multi-discipline grants", async () => {
    await insertUsers([{ userId: id, ...Object.fromEntries(MasteryNames.map(stat => [stat, 699999])), masteryRanks: Object.fromEntries(MasteryNames.map(stat => [stat, "MASTER"])) }]);
    await Promise.all([grant({ ninjutsuMastery: 10, genjutsuMastery: 10 }), grant({ taijutsuMastery: 10, sageMastery: 10 })]);
    const u = await read();
    expect(MasteryNames.reduce((sum, stat) => sum + u[stat], 0)).toBe(TOTAL_MASTERY_CAP);
    expect(MasteryNames.every(stat => u[stat] >= 699999)).toBe(true);
  });
  it("caps the current rank, advances only the next exam and ignores temporary bonuses", async () => {
    await insertUsers([{ userId: id, ninjutsuMastery: 374999 }]);
    await Promise.all([grant({ ninjutsuMastery: 10 }), grant({ ninjutsuMastery: 10 })]);
    expect((await read()).ninjutsuMastery).toBe(375000);
    const db = await getTestDatabase();
    await db.update(userData).set({ masteryRanks: masteryRankUpdate("ninjutsuMastery", "MASTER") }).where(eq(userData.userId, id));
    expect((await read()).masteryRanks).toEqual({});
    await db.update(userData).set({ masteryRanks: masteryRankUpdate("ninjutsuMastery", "NOVICE") }).where(eq(userData.userId, id));
    await grant({ ninjutsuMastery: 10 });
    expect(await read()).toMatchObject({ ninjutsuMastery: 375010, masteryRanks: { ninjutsuMastery: "NOVICE" } });
    await db.update(userData).set({ masteryRanks: masteryRankUpdate("ninjutsuMastery", "NOVICE") }).where(eq(userData.userId, id));
    expect((await read()).masteryRanks).toEqual({ ninjutsuMastery: "NOVICE" });
  });
  it("preserves earned values already above the total cap", async () => {
    await insertUsers([{ userId: id, ...Object.fromEntries(MasteryNames.map(stat => [stat, 1500000])), masteryRanks: { ninjutsuMastery: "LEGENDARY" } }]);
    await grant({ ninjutsuMastery: 100, genjutsuMastery: 100 });
    const user = await read();
    expect(MasteryNames.reduce((sum, stat) => sum + user[stat], 0)).toBe(9000000);
    expect(MasteryNames.every(stat => user[stat] === 1500000)).toBe(true);
  });
  it("awards the next rank below the default threshold without replaying or downgrading it", async () => {
    await insertUsers([{ userId: id, ninjutsuMastery: 599999.85, masteryRanks: { ninjutsuMastery: "NOVICE" } }]);
    const db = await getTestDatabase();
    const promote = (rank: Parameters<typeof masteryRankUpdate>[1]) => db.update(userData).set({ masteryRanks: masteryRankUpdate("ninjutsuMastery", rank) }).where(eq(userData.userId, id));
    await Promise.all([promote("ADEPT"), promote("ADEPT")]);
    expect(await read()).toMatchObject({ ninjutsuMastery: 599999.85, masteryRanks: { ninjutsuMastery: "ADEPT" } });
    await promote("NOVICE");
    await promote("LEGENDARY");
    expect((await read()).masteryRanks).toEqual({ ninjutsuMastery: "ADEPT" });
  });
  it("includes mastery gates and rank rewards in compact dashboard discovery without objectives", async () => {
    await insertUsers([{ userId: id, ninjutsuMastery: 599999.85, masteryRanks: { ninjutsuMastery: "NOVICE" } }]);
    const db = await getTestDatabase();
    const template = { ...masteryQuestTemplates()[1]!, hidden: false, questType: "event" as const, requiredNinjutsuMastery: 500000 };
    await db.insert(quest).values(template);
    const candidates = await fetchQuestDiscoverySummaryCandidates(db, id, { questTypes: ["event"] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ requiredNinjutsuMastery: 500000, content: { reward: { reward_mastery_stat: "ninjutsuMastery", reward_mastery_rank: "ADEPT" } } });
    expect(candidates[0]!.content).not.toHaveProperty("objectives");
    const user = { ...await read(), completedQuests: [] };
    expect(isAvailableUserQuests(candidates[0]!, user).check).toBe(true);
    expect(isAvailableUserQuests(candidates[0]!, { ...user, ninjutsuMastery: 499999 }).check).toBe(false);
  });
});
