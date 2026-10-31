import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { BLOODLINE_COST, ELEMENTAL_MASTERY_CAP, REMOVAL_COST } from "@/drizzle/constants";
import { bloodline, bloodlineRolls, gameSetting, notification, quest, questHistory, skillTree, userData, userSkill, userVote } from "@/drizzle/schema";
import { calcEnergy } from "@/libs/profile";
import { bloodlineRouter } from "@/server/api/routers/bloodline";
import { miscRouter } from "@/server/api/routers/misc";
import { fetchUpdatedUser, profileRouter } from "@/server/api/routers/profile";
import { skillTreeRouter } from "@/server/api/routers/skillTree";
import { trainRouter } from "@/server/api/routers/train";
import { IncreaseMasteryTag, IncreaseMaxPoolsTag } from "@/validators/combat";
import { petSkillFixture } from "../../../libs/pets/helpers/abilities";
import { insertUsers } from "../../../setup/factories";
import { countUserReads } from "../../../setup/userReads";
import { callerForDatabase, describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../../setup/testDatabase";

const userId = "progress-cache";
const effects = [
  IncreaseMasteryTag.parse({ power: 50, calculation: "static", masteryTypes: ["Ninjutsu"] }),
  IncreaseMaxPoolsTag.parse({ power: 100, calculation: "static", poolsAffected: ["Energy"] }),
];

describeWithDatabase("confirmed progression cache responses", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await resetTables(bloodlineRolls, bloodline, notification, questHistory, quest, userSkill, skillTree, userVote, gameSetting, userData);
    await insertUsers([{ userId, username: "ProgressCache", role: "OWNER", rank: "JONIN", level: 50,
      primaryElement: "Fire", secondaryElement: "Water", status: "AWAKE", isOutlaw: true,
      regeneration: 20, ninjutsuMastery: 100, reputationPoints: 1000, seichiSilver: 200,
      skillPoints: 5, updatedAt: new Date(), regenAt: new Date(), }]);
    const db = await getTestDatabase();
    await db.insert(userVote).values({ id: "progress-votes", userId, secret: "cache0001", lastVoteAt: new Date() });
    await db.insert(bloodline).values({ id: "cache-line", name: "Cache Line", rank: "D", image: "",
      description: "Cache fixture", regenIncrease: 7, effects });
  });

  it("returns purchased lineage, the confirmed debit and passive changes", async () => {
    const db = await getTestDatabase();
    const counted = countUserReads(db);
    const result = await callerForDatabase(bloodlineRouter, userId, counted.client).purchaseBloodline({ bloodlineId: "cache-line" });
    expect(result.success).toBe(true);
    expect(result.userPatch).toMatchObject({ bloodlineId: "cache-line", bloodline: { id: "cache-line" },
      bloodlineReskinId: null, activeReskin: null, bloodright: [], bloodrightSpent: 0, regeneration: 27,
      regenerationWithoutTimedBuffs: 27, maxEnergy: calcEnergy(50) + 100,
      effectiveMasteries: { ninjutsuMastery: 150 } });
    expect(result.userPatch?.updatedAt).toBeInstanceOf(Date);
    expect(result.userDelta).toEqual({ reputationPoints: -BLOODLINE_COST.D });
    expect(counted.getReads()).toBe(1);
  });

  it.each([false, true])("returns the saved Bloodright refund and correct removal charge (natural=%s)", async (natural) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ bloodlineId: "cache-line", bloodright: [{ skillId: "old-tier", cost: 77 }], bloodrightSpent: 77 }).where(eq(userData.userId, userId));
    if (natural) await db.insert(bloodlineRolls).values({ id: "natural-line", userId, bloodlineId: "cache-line", type: "NATURAL" });
    const result = await callerForDatabase(bloodlineRouter, userId, db).removeBloodline();
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({
      bloodlineId: null, seichiSilver: 277, bloodright: [], bloodrightSpent: 0,
      reputationPoints: 1000 - (natural ? 0 : REMOVAL_COST),
    });
  });

  it("publishes activated skills and derived pool/mastery values without spending skill points", async () => {
    const db = await getTestDatabase();
    await db.insert(skillTree).values(petSkillFixture({ id: "cache-skill", effects }));
    // Hydrate any first-login bookkeeping before isolating the activation response.
    await fetchUpdatedUser({ client: db, userId });
    const counted = countUserReads(db);
    const result = await callerForDatabase(skillTreeRouter, userId, counted.client).purchaseSkill({ skillId: "cache-skill" });
    expect(result.success).toBe(true);
    expect(result.userPatch?.userSkills).toEqual([expect.objectContaining({ skillId: "cache-skill", activated: true })]);
    expect(result.userPatch?.maxEnergy).toBe(calcEnergy(50) + 100);
    expect(counted.getReads()).toBe(1);
    expect(result.userPatch?.effectiveMasteries?.ninjutsuMastery).toBe(150);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))?.skillPoints).toBe(5);
  });

  it("keeps a completed global skill reset canonical for concurrent skill sources", async () => {
    const db = await getTestDatabase();
    await db.insert(skillTree).values(petSkillFixture({ id: "reset-skill", effects }));
    await db.insert(userSkill).values({ id: "reset-entry", userId, skillId: "reset-skill", activated: true });
    await fetchUpdatedUser({ client: db, userId });
    const result = await callerForDatabase(skillTreeRouter, userId, db).resetAllUsersSkillPoints();
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(await db.query.userSkill.findMany()).toEqual([]);
  });

  it("publishes only the accepted elemental selection", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ elementalMastery: { Earth: ELEMENTAL_MASTERY_CAP } }).where(eq(userData.userId, userId));
    const caller = callerForDatabase(trainRouter, userId, db);
    const accepted = await caller.selectTrainedElement({ element: "Earth" });
    expect(accepted).toMatchObject({ success: true, userPatch: { activeTrainedElement: "Earth" } });
    const rejected = await caller.selectTrainedElement({ element: "Wind" });
    expect(rejected.success).toBe(false);
    expect(rejected.userPatch).toBeUndefined();
  });

  it("returns active global boost navigation and recalculated regeneration", async () => {
    const db = await getTestDatabase();
    const result = await callerForDatabase(miscRouter, userId, db).setEventGameSetting({ setting: "regenGainMultiplier", multiplier: "2", days: 1 });
    expect(result).toMatchObject({ success: true, userPatch: { regeneration: 40, regenerationWithoutTimedBuffs: 40 },
      boostNavigation: { href: "/profile", label: "regen", notice: { color: "green", group: "Active boosts" } } });
    expect(result.boostNavigation?.notice?.name).toContain("2X regen");
    const disabled = await callerForDatabase(miscRouter, userId, db).setEventGameSetting({ setting: "regenGainMultiplier", multiplier: "2", days: 0 });
    expect(disabled).toMatchObject({ success: true, userPatch: { regeneration: 20 }, boostNavigation: { notice: null } });
  });

  it("publishes announcements without delivering the actor receipt inside the mutation", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "other-reader", username: "OtherReader" }]);
    const { result, statements } = await recordQueries(() => callerForDatabase(miscRouter, userId, db).submitNotification({ content: "A committed announcement", senderId: userId }));
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect(result.announcements).toBeUndefined();
    const lastWrite = statements.reduce((last, statement, index) => /^\s*(update|insert|delete)/i.test(statement) ? index : last, -1);
    expect(statements.slice(lastWrite + 1).some((statement) => /^\s*select/i.test(statement))).toBe(false);
    expect(await db.query.notification.findMany()).toHaveLength(1);
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ unreadNotifications: 1 });
    expect((await callerForDatabase(profileRouter, userId, db).getUser()).notifications).toContainEqual(expect.objectContaining({ name: "A committed announcement", color: "toast" }));
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({ unreadNotifications: 0 });
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "other-reader") }))?.unreadNotifications).toBe(1);
    expect((await callerForDatabase(profileRouter, userId, db).getUser()).notifications.some((entry) => entry.name === "A committed announcement")).toBe(false);
  });
});
