import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { getUserCaps, MAX_SKILL_POINTS, SENSEI_MAX_STUDENT_LEVEL } from "@/drizzle/constants";
import { bloodline, item, quest, questHistory, userData, userItem, userQueue, userVote } from "@/drizzle/schema";
import { calcCP, calcEnergy, calcHP, calcLevelRequirements, calcSP } from "@/libs/profile";
import { getEnergyQueue } from "@/libs/queue";
import { fetchUpdatedUser, getUserProgressionUpdate, profileRouter } from "@/server/api/routers/profile";
import { MoveToObjective, SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertItems, insertQuests, insertUsers, insertUserItems } from "../../setup/factories";
import { queueEnergy, readEnergyQueue } from "../../setup/queues";
import { beforeStatements } from "../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const USER_ID = "progression-user";
const seed = async (changes: Partial<typeof userData.$inferInsert> = {}) => {
  await insertUsers([{ userId: USER_ID, username: "ProgressionUser", rank: "JONIN", role: "USER", level: 30, experience: calcLevelRequirements(40), isOutlaw: true, status: "AWAKE", regeneration: 0, primaryElement: "Fire", secondaryElement: "Water", curHealth: 20, curChakra: 30, curStamina: 40, curEnergy: 50, ...changes }]);
  await (await getTestDatabase()).insert(userVote).values({ id: "progression-vote", userId: USER_ID, secret: "prog001", lastVoteAt: new Date() });
};
const read = async () => {
  const user = await (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, USER_ID) });
  if (!user) throw new Error("Missing progression user");
  return user;
};
const assign = (ninjutsuMastery = 0, offence = 0) => ({ offence, defence: 0, strength: 0, speed: 0, intelligence: 0, willpower: 0, ninjutsuMastery, genjutsuMastery: 0, taijutsuMastery: 0, bukijutsuMastery: 0 });

describeWithDatabase("confirmed progression cache responses against MySQL", () => {
  beforeEach(async () => resetTables(userQueue, questHistory, quest, userVote, userItem, item, userData, bloodline));
  afterEach(() => vi.restoreAllMocks());

  it.each([0, MAX_SKILL_POINTS])("returns level pools and capped skill points when starting with %s points", async (skillPoints) => {
    await seed({ skillPoints });
    const result = await (await callerFor(profileRouter, USER_ID)).levelUp();
    expect(result.success).toBe(true);
    const saved = await read();
    expect(result.userPatch).toMatchObject({ level: 31, maxHealth: calcHP(31), maxChakra: calcCP(31), maxStamina: calcSP(31), maxEnergy: calcEnergy(31), skillPoints: Math.min(skillPoints + 1, MAX_SKILL_POINTS), updatedAt: saved.updatedAt, curHealth: saved.curHealth, curChakra: saved.curChakra, curStamina: saved.curStamina, curEnergy: saved.curEnergy });
    expect(saved.skillPoints).toBe<number | undefined>(result.userPatch?.skillPoints);
  });

  it("clears sensei at the final student level without a second profile fetch", async () => {
    await seed({ level: SENSEI_MAX_STUDENT_LEVEL, senseiId: "sensei-id" });
    const database = await getTestDatabase();
    const actualRead = database.query.userData.findFirst.bind(database.query.userData);
    let profileReads = 0;
    vi.spyOn(database.query.userData, "findFirst").mockImplementation(((config: Parameters<typeof actualRead>[0]) => { if (config?.with) profileReads++; return actualRead(config); }) as never);
    const result = await (await callerFor(profileRouter, USER_ID)).levelUp();
    expect(result.userPatch?.senseiId).toBeNull();
    expect((await read()).senseiId).toBeNull();
    expect(profileReads).toBe(1);
  });

  it("introduces newly eligible achievement progress while withholding its static definition", async () => {
    await insertQuests([{ id: "level-achievement", questType: "achievement", requiredLevel: 31, content: { objectives: [SimpleObjective.parse({ id: "level-goal", task: "user_level", value: 31 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    await seed();
    const result = await (await callerFor(profileRouter, USER_ID)).levelUp();
    expect(result.success).toBe(true);
    expect(result.achievementProgress).toEqual(expect.arrayContaining([expect.objectContaining({ questId: "level-achievement" })]));
    expect(result.achievementProgress?.find(entry => entry.questId === "level-achievement")).not.toHaveProperty("quest");
    expect(result.userPatch?.userQuests?.some(entry => entry.questId === "level-achievement")).toBe(false);
    expect(result.userPatch?.questData?.find(entry => entry.id === "level-achievement")?.goals).toEqual(expect.arrayContaining([expect.objectContaining({ id: "level-goal", value: 31, done: true })]));
    expect((await read()).questData?.some(entry => entry.id === "level-achievement")).toBe(false);
  });

  it("keeps reconciliation when a newly eligible tier needs bootstrapping", async () => {
    await insertQuests([{ id: "new-tier", questType: "tier", requiredLevel: 31, content: { objectives: [SimpleObjective.parse({ id: "tier-goal", task: "user_level", value: 40 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    await seed();
    const result = await (await callerFor(profileRouter, USER_ID)).levelUp();
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect((await read()).level).toBe(31);
  });

  it("rejects a level write after an independent level change without emitting a stale patch", async () => {
    await seed();
    const database = await getTestDatabase();
    const raced = callerForDatabase(profileRouter, USER_ID, beforeStatements(database, userData, [async () => database.update(userData).set({ level: 31 }).where(eq(userData.userId, USER_ID))]));
    const result = await raced.levelUp();
    expect(result.success).toBe(false);
    expect(result.userPatch).toBeUndefined();
    expect((await read()).level).toBe(31);
  });

  it("marks rejected passive settlement for reconciliation even when level-up can subsequently succeed", async () => {
    await seed({ updatedAt: new Date(Date.now() - 600_000), regenAt: new Date(Date.now() - 600_000) });
    const database = await getTestDatabase();
    const raced = callerForDatabase(profileRouter, USER_ID, beforeStatements(database, userData, [async () => database.update(userData).set({ updatedAt: new Date(), curEnergy: 17 }).where(eq(userData.userId, USER_ID))]));
    const result = await raced.levelUp();
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    expect((await read()).curEnergy).toBe(17);
  });

  it("masks hidden achievement coordinates in both definitions and trackers without mutating canonical state", async () => {
    await insertQuests([{ id: "secret-achievement", questType: "achievement", content: { objectives: [MoveToObjective.parse({ id: "secret-goal", task: "move_to_location", sector: 8, longitude: 4, latitude: 5, hideLocation: true })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
    await seed({ sector: 1, questData: [{ id: "secret-achievement", startAt: new Date().toISOString(), goals: [{ id: "secret-goal", value: 0, done: false, collected: false, recentlyDied: false, sector: 8, longitude: 4, latitude: 5, locationChecked: true }] }] });
    const snapshot = await fetchUpdatedUser({ client: await getTestDatabase(), userId: USER_ID });
    if (!snapshot.user) throw new Error("Missing hydrated user");
    const result = getUserProgressionUpdate(snapshot.user, snapshot.publishedAchievementIds);
    const publicGoal = result.userPatch.questData?.find(entry => entry.id === "secret-achievement")?.goals[0];
    for (const field of ["sector", "longitude", "latitude"]) expect(publicGoal).not.toHaveProperty(field);
    expect(result.userPatch.userQuests?.find(entry => entry.questId === "secret-achievement")?.quest.content.objectives[0]).toMatchObject({ sector: 1337, longitude: 1337, latitude: 1337 });
    expect(snapshot.user.questData?.find(entry => entry.id === "secret-achievement")?.goals[0]).toMatchObject({ sector: 8, longitude: 4, latitude: 5 });
    expect(result.achievementProgress).toEqual([]);
  });

  it("returns new mastery and Energy capacity when XP allocation makes worn gear usable", async () => {
    await seed({ ninjutsuMastery: 10, earnedExperience: 100 });
    await insertItems([{ id: "xp-armor", itemType: "ARMOR", requiredNinjutsuMastery: 100, effects: [{ type: "increasemastery", masteryTypes: ["Ninjutsu"], power: 500, powerPerLevel: 0, calculation: "static", rounds: 1 }, { type: "increasemaxpools", poolsAffected: ["Energy"], power: 50, powerPerLevel: 0, calculation: "static", rounds: 1 }] } as never]);
    await insertUserItems([{ id: "xp-worn-armor", userId: USER_ID, itemId: "xp-armor", equipped: "CHEST", durability: 100, level: 1 }]);
    const result = await (await callerFor(profileRouter, USER_ID)).useUnusedExperiencePoints(assign(90));
    expect(result.success).toBe(true);
    expect(result.userPatch).toMatchObject({ ninjutsuMastery: 100, earnedExperience: 10, effectiveMasteries: { ninjutsuMastery: 600 }, maxEnergy: calcEnergy(30) + 50 });
    expect((await read()).ninjutsuMastery).toBe(100);
  });

  it("matches the integer XP balance debit when only fractional mastery cap room remains", async () => {
    const { mastery_cap } = getUserCaps("JONIN");
    await seed({ ninjutsuMastery: mastery_cap - 1.64, earnedExperience: 100 });
    const result = await (await callerFor(profileRouter, USER_ID)).useUnusedExperiencePoints(assign(10));
    const saved = await read();
    expect(result.success).toBe(true);
    expect(saved.ninjutsuMastery).toBe(mastery_cap);
    expect(saved.earnedExperience).toBe(98);
    expect(result.userPatch).toMatchObject({ ninjutsuMastery: saved.ninjutsuMastery, earnedExperience: saved.earnedExperience, experience: saved.experience });
  });

  it("defers XP allocation reconciliation when a pending Energy queue can also grant stats", async () => {
    await seed({ earnedExperience: 100, curEnergy: 100 });
    await queueEnergy(USER_ID, [{ stat: "defence", energy: 40 }]);
    const result = await (await callerFor(profileRouter, USER_ID)).useUnusedExperiencePoints(assign(0, 10));
    expect(result.success).toBe(true);
    expect(result.userPatch).toBeUndefined();
    const saved = await read();
    expect(saved.offence).toBe(20);
    expect(saved.defence).toBe(10);
    expect(saved.curEnergy).toBe(100);
    expect(await readEnergyQueue(USER_ID)).toHaveLength(1);
    const settled = await fetchUpdatedUser({ client: await getTestDatabase(), userId: USER_ID });
    expect(settled.user?.defence).toBeGreaterThan(saved.defence);
    expect(getEnergyQueue(settled.user!)).toEqual([]);
  });
});
