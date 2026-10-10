import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { MasteryNames, TOTAL_MASTERY_CAP } from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import { masteryGainUpdates, masteryRankUpdate } from "@/server/utils/masteryProgression";
import { insertUsers } from "../../setup/factories";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const id = "mastery-concurrency";
const read = async () => (await (await getTestDatabase()).select().from(userData).where(eq(userData.userId, id)))[0]!;
const grant = async (gains: Parameters<typeof masteryGainUpdates>[0]) => (await getTestDatabase()).update(userData).set(masteryGainUpdates(gains)).where(eq(userData.userId, id));

describeWithDatabase("atomic mastery caps", () => {
  beforeEach(async () => { await resetTables(userData); });
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
});
