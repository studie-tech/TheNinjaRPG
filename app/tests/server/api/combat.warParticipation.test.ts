import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { MAP_WAR_TORN_BATTLEGROUND_SECTOR, WAR_ESPIONAGE_TARGET } from "@/drizzle/constants";
import { aiProfile, battle, battleAction, battleHistory, mpvpBattleQueue, mpvpBattleUser, quest, questHistory, territoryWar, userData, village, war, warAlly, warMercenary } from "@/drizzle/schema";
import { updateUser } from "@/libs/combat/database";
import { calcBattleResult } from "@/libs/combat/util";
import { Pusher, type PusherClient } from "@/libs/pusher";
import { fetchBattle, initiateBattle } from "@/server/api/routers/combat";
import { claimDailyQuestSlot } from "@/server/api/routers/quests";
import { warRouter } from "@/server/api/routers/war";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { defaultWarRules } from "@/validators/war";
import { insertQuestHistory, insertQuests, insertUsers } from "../../setup/factories";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

const pusher = { trigger: vi.fn(async () => {}) } as unknown as PusherClient;
const attackerId = "war-attacker";
const defenderId = "war-defender";
const readUser = async (id = attackerId) => (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, id) });

describeWithDatabase("war participation requires deliberate war activity", () => {
  beforeEach(async () => {
    await resetTables(battleAction, battleHistory, battle, aiProfile, questHistory, quest, mpvpBattleUser, mpvpBattleQueue, territoryWar, warMercenary, warAlly, war, village, userData);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "home", name: "Home", sector: 1, kageId: "home-kage" },
      { id: "enemy", name: "Enemy", sector: 2, kageId: "enemy-kage" },
    ]);
    await db.insert(war).values({ id: "active-war", type: "VILLAGE_WAR", status: "ACTIVE", attackerVillageId: "home", defenderVillageId: "enemy", combatStartedAt: new Date(Date.now() - 3600000), rules: defaultWarRules });
    await insertUsers([attackerId, defenderId].map((userId, index) => ({
      userId, username: userId, villageId: index ? "enemy" : "home", status: "AWAKE", rank: "JONIN", level: 100,
      experience: 1000, sector: 100, curHealth: 100, maxHealth: 100, curStamina: 100, maxStamina: 100,
      curChakra: 100, maxChakra: 100, regeneration: 0, warParticipantUntil: new Date(0), bracketImmunityLiftedUntil: new Date(0),
    })));
    await db.insert(aiProfile).values({ id: "Default", userId: "default-ai", rules: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { label: "Territory War PvP", sector: 100, event: true, guardian: false, expected: 1 },
    { label: "ordinary neutral PvP", sector: 100, event: false, guardian: false, expected: 0 },
    { label: "Wartorn PvP", sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR, event: false, guardian: false, expected: 1 },
    { label: "Territory War guardian", sector: 100, event: true, guardian: true, expected: 0 },
  ])("credits PvP missions for $label: $expected", async ({ sector, event, guardian, expected }) => {
    const db = await getTestDatabase();
    await insertQuests([{ id: "pvp-mission", name: "PvP mission", questType: "pvp", content: {
      objectives: [SimpleObjective.parse({ id: "kills", task: "pvp_kills", value: 3 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    await insertQuestHistory([{ userId: attackerId, questId: "pvp-mission", questType: "pvp" }]);
    await db.update(userData).set({ sector });
    if (event) {
      await insertUsers([{ userId: "quest-guardian", isAi: true, isWarCamp: true, sector, level: 100, curHealth: 100, maxHealth: 100 }]);
      await db.insert(territoryWar).values({ id: "quest-event", predecessorId: "initial", guardianId: "quest-guardian", sector, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 3600000) });
    }
    if (guardian) {
      await db.update(userData).set({ status: "QUEUED" }).where(eq(userData.userId, attackerId));
      await db.insert(mpvpBattleQueue).values({ id: "quest-team", battleId: "quest-battle", battleType: "TERRITORY_WAR", territoryWarId: "quest-event", attackerEntityId: "village:home", defenderEntityId: "quest-guardian", sector });
      await db.insert(mpvpBattleUser).values({ id: "quest-member", clanBattleId: "quest-team", userId: attackerId, side: "ATTACKER", slot: 0 });
    }
    const started = await initiateBattle({
      client: db, userIds: [attackerId], targetIds: [guardian ? "quest-guardian" : defenderId], sector,
      ...(guardian ? { territoryWar: (await db.query.territoryWar.findFirst())!, clanBattle: { queueId: "quest-team", battleId: "quest-battle" } } : {}),
    }, guardian ? "TERRITORY_WAR" : "COMBAT");
    expect(started.success, started.message).toBe(true);
    const snapshot = (await fetchBattle(db, started.battleId!))!;
    expect(snapshot.extraState.territoryWar !== undefined).toBe(event);
    snapshot.usersState.find((user) => user.userId !== attackerId)!.curHealth = 0;
    await updateUser(db, pusher, snapshot, calcBattleResult(snapshot, attackerId)!, attackerId);
    expect((await readUser())!.questData?.find((tracker) => tracker.id === "pvp-mission")?.goals.find((goal) => goal.id === "kills")?.value ?? 0).toBe(expected);
  });

  it.each(["ARENA", "QUEST", "TRAINING", "COMBAT"] as const)("winning %s against an enemy-village NPC preserves immunity and the participation timer", async (battleType) => {
    const db = await getTestDatabase();
    const immunityUntil = battleType === "COMBAT" ? new Date(0) : new Date(Date.now() + 3600000);
    await db.update(userData).set({ isAi: true, inArena: true }).where(eq(userData.userId, defenderId));
    await db.update(userData).set({ immunityUntil }).where(eq(userData.userId, attackerId));
    const started = await initiateBattle({ client: db, userIds: [attackerId], targetIds: [defenderId] }, battleType);
    expect(started.success, started.message).toBe(true);
    expect((await readUser())!.warParticipantUntil.getTime()).toBe(0);
    const snapshot = (await fetchBattle(db, started.battleId!))!;
    expect(Object.keys(snapshot.extraState.wars)).toContain("active-war");
    snapshot.usersState.find((user) => user.isAi)!.curHealth = 0;
    const result = calcBattleResult(snapshot, attackerId)!;
    expect(result.didWin).toBe(1);
    await updateUser(db, pusher, snapshot, result, attackerId);
    const settled = (await readUser())!;
    expect(settled).toMatchObject({ battleId: null, status: "AWAKE" });
    if (battleType !== "COMBAT") expect(settled.immunityUntil.getTime()).toBe(immunityUntil.getTime());
    expect(settled.warParticipantUntil.getTime()).toBe(0);
    expect(settled.bracketImmunityLiftedUntil.getTime()).toBe(0);
  });

  it.each(["attacker", "defender"])("flags only the initiating enemy-player attacker when the %s wins", async (winner) => {
    const db = await getTestDatabase();
    const started = await initiateBattle({ client: db, userIds: [attackerId], targetIds: [defenderId] }, "COMBAT");
    expect(started.success, started.message).toBe(true);
    const participation = (await readUser())!.warParticipantUntil;
    expect(participation.getTime()).toBeGreaterThan(Date.now());
    expect((await readUser(defenderId))!.warParticipantUntil.getTime()).toBe(0);
    const snapshot = (await fetchBattle(db, started.battleId!))!;
    snapshot.usersState.find((user) => user.userId === (winner === "attacker" ? defenderId : attackerId))!.curHealth = 0;
    for (const id of [attackerId, defenderId]) {
      const result = calcBattleResult(snapshot, id)!;
      expect(result.didWin).toBe(Number(id === (winner === "attacker" ? attackerId : defenderId)));
      await updateUser(db, pusher, snapshot, result, id);
    }
    expect((await readUser())!.warParticipantUntil).toEqual(participation);
    expect((await readUser(defenderId))!.warParticipantUntil.getTime()).toBe(0);
  });

  it("does not extend an existing participation timer after an arena win", async () => {
    const db = await getTestDatabase();
    const participation = new Date(Date.now() + 60000);
    await db.update(userData).set({ isAi: true, inArena: true }).where(eq(userData.userId, defenderId));
    await db.update(userData).set({ warParticipantUntil: participation }).where(eq(userData.userId, attackerId));
    const started = await initiateBattle({ client: db, userIds: [attackerId], targetIds: [defenderId] }, "ARENA");
    expect(started.success, started.message).toBe(true);
    const snapshot = (await fetchBattle(db, started.battleId!))!;
    snapshot.usersState.find((user) => user.isAi)!.curHealth = 0;
    await updateUser(db, pusher, snapshot, calcBattleResult(snapshot, attackerId)!, attackerId);
    expect((await readUser())!.warParticipantUntil).toEqual(participation);
  });

  it("still flags a deliberate shrine attack against an AI defender", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ isAi: true }).where(eq(userData.userId, defenderId));
    const started = await initiateBattle({ client: db, userIds: [attackerId], targetIds: [defenderId] }, "SHRINE_WAR");
    expect(started.success, started.message).toBe(true);
    const participant = (await readUser())!;
    expect(participant.warParticipantUntil.getTime()).toBeGreaterThan(Date.now());
    expect(participant.bracketImmunityLiftedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it.each(["mission", "war"])("only a war quest claim flags participation: %s", async (questType) => {
    const db = await getTestDatabase();
    const user = (await readUser())!;
    expect(await claimDailyQuestSlot(db, user, questType)).toBe(true);
    const claimed = (await readUser())!;
    expect(claimed.warParticipantUntil.getTime() > Date.now()).toBe(questType === "war");
    expect(claimed.bracketImmunityLiftedUntil.getTime() > Date.now()).toBe(questType === "war");
  });

  it.each(["espionage", "sabotage"] as const)("starting %s still flags participation and removes immunity", async (task) => {
    const db = await getTestDatabase();
    await insertQuests([{ id: task, name: task, questType: "war", questRank: "C", content: {
      objectives: [SimpleObjective.parse({ id: task, task, durationSeconds: 30, value: 10 })],
      reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [],
    } }]);
    await db.update(userData).set({ sector: task === "espionage" ? 2 : 100, immunityUntil: new Date(Date.now() + 3600000) }).where(eq(userData.userId, attackerId));
    await db.update(war).set({ objectiveState: {
      attackerEspionage: task === "sabotage" ? WAR_ESPIONAGE_TARGET : 0,
      defenderEspionage: 0,
      objectives: [{ villageId: "enemy", sector: 100, hp: 10000, maxHp: 10000, isReserve: false, destroyed: false }],
    } }).where(eq(war.id, "active-war"));
    const api = callerForDatabase(warRouter, attackerId, db);
    const started = await api.startWarMission({ warId: "active-war", questId: task, objectiveId: task });
    expect(started.success, started.message).toBe(true);
    const participant = (await readUser())!;
    expect(participant.warParticipantUntil.getTime()).toBeGreaterThan(Date.now());
    expect(participant.bracketImmunityLiftedUntil.getTime()).toBeGreaterThan(Date.now());
    expect(participant.immunityUntil.getTime()).toBe(0);
  });
});
