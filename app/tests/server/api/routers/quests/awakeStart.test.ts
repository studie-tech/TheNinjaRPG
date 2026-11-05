import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { quest, questHistory, userData, village, villageStructure } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { questsRouter } from "@/routers/quests";
import { DialogObjective, InstantWinLoseObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

// Medical missions are single-attempt dialog chains; dialog choices require an awake player.
const content = {
  objectives: [
    DialogObjective.parse({ id: "talk", task: "dialog", description: "Diagnose", nextObjectiveId: [{ text: "Treat", nextObjectiveId: "win" }] }),
    InstantWinLoseObjective.parse({ id: "win", task: "win_quest" }),
  ],
  reward: ObjectiveReward.parse({ reward_medical_experience: 100 }),
  sceneBackground: "",
  sceneCharacters: [],
};

const readUser = async () => (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, "medic") });
const readHistory = async () => (await getTestDatabase()).query.questHistory.findMany({ where: eq(questHistory.userId, "medic") });

describeWithDatabase("mission hall action recovery", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(questHistory, quest, villageStructure, village, userData);
    await insertUsers([{ userId: "medic", rank: "JONIN", level: 50, status: "ASLEEP", autoWakeUp: false, villageId: "home", sector: 0,
      regeneration: 0, primaryElement: "Fire", secondaryElement: "Water" }]);
    const database = await getTestDatabase();
    await database.insert(village).values({ id: "home", name: "Home", sector: 0, kageId: "kage" });
    await database.insert(villageStructure).values({ id: "hall", villageId: "home", name: "Mission Hall", route: "/missionhall", image: "", curSp: 1000 });
    await insertQuests([{ id: "bloom", name: "Bloom", questType: "medical", questRank: "D", medicalRank: "NOVICE",
      consecutiveObjectives: true, hidden: false, maxAttempts: 1, maxCompletes: 1, content }]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("respects sleep opt-out for specific and random medical starts without spending the attempt", async () => {
    const api = await callerFor(questsRouter, "medic");
    const blocked = { success: false, message: expect.stringContaining("asleep") };
    expect(await api.startQuest({ questId: "bloom", userSector: 0 })).toMatchObject(blocked);
    expect(await api.startRandom({ type: "medical", rank: "D", userLevel: 50, userSector: 0, userVillageId: "home" })).toMatchObject(blocked);
    expect((await readUser())?.dailyMedicalMissions).toBe(0);
    expect(await readHistory()).toHaveLength(0);
  });

  it.each(["specific", "random"] as const)("recovers an opted-in actor inside the %s endpoint", async (kind) => {
    const database = await getTestDatabase();
    await database.update(userData).set({ autoWakeUp: true }).where(eq(userData.userId, "medic"));
    // The leaf router exercises endpoint preparation without an app-router middleware preflight.
    const api = await callerFor(questsRouter, "medic");
    const result = kind === "specific"
      ? await api.startQuest({ questId: "bloom", userSector: 0 })
      : await api.startRandom({ type: "medical", rank: "D", userLevel: 50, userSector: 0, userVillageId: "home" });
    expect(result).toMatchObject({ success: true, actionNotice: "This action woke you up." });
    expect(await readUser()).toMatchObject({ status: "AWAKE", dailyMedicalMissions: 1 });
    expect(await readHistory()).toHaveLength(1);
  });

  it("lets the same player start and progress the mission once awake", async () => {
    await (await getTestDatabase()).update(userData).set({ status: "AWAKE" }).where(eq(userData.userId, "medic"));
    const api = await callerFor(questsRouter, "medic");
    expect((await api.startQuest({ questId: "bloom", userSector: 0 })).success).toBe(true);
    expect((await readUser())?.dailyMedicalMissions).toBe(1);
    expect((await api.checkRewards({ questId: "bloom", nextObjectiveId: "win" })).success).toBe(true);
    expect(await readHistory()).toMatchObject([{ questId: "bloom", completed: 1 }]);
  });
});
