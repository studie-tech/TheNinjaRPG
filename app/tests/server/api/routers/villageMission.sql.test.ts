import { beforeEach, expect, it, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { BUILDING_UPGRADE_BASE_COST, BUILDING_UPGRADE_PER_LEVEL_COST, WAR_SHRINE_CAPTURE_WARHEALTH_DMG } from "@/drizzle/constants";
import { battle, clan, userData, village, villageStructure, quest, questHistory, war, warKill } from "@/drizzle/schema";
import { updateBattle, updateWars } from "@/libs/combat/database";
import type { CompleteBattle, CombatResult } from "@/libs/combat/types";
import { SimpleObjective } from "@/validators/objectives";
import { ObjectiveReward, PostProcessedRewardSchema } from "@/validators/rewards";
import { villageMissionRouter } from "@/server/api/routers/villageMission";
import { kageRouter } from "@/server/api/routers/kage";
import { commitQuestObjectiveRewards, questsRouter } from "@/server/api/routers/quests";
import * as socials from "@/libs/socials";
import { recordVillageMissionProgress } from "@/server/utils/villageMission";
import { accrueVillageStructureMaintenance } from "@/server/utils/villageMaintenance";
import { insertUsers, insertQuests, insertQuestHistory } from "../../../setup/factories";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, recordQueries, resetTables, runRawSql } from "../../../setup/testDatabase";
import { makeBattleUser, makeCompleteBattle } from "../../../libs/combat/helpers/battleScenario";

const state = async () => (await getTestDatabase()).query.village.findFirst({ where: eq(village.id, "v1") });
const leader = async () => callerFor(villageMissionRouter, "leader");
const objective = { id: "effort", task: "combined_mission_effort", description: "Complete missions together", value: 14 };

describeWithDatabase("Village Missions and maintenance on real MySQL", () => {
  beforeEach(async () => {
    await resetTables(battle, clan, userData, village, villageStructure, quest, questHistory, war, warKill);
    const db = await getTestDatabase();
    await insertUsers([
      { userId: "leader", username: "leader", villageId: "v1" },
      { userId: "member", username: "member", villageId: "v1" },
      { userId: "outsider", username: "outsider", villageId: "v2" },
    ]);
    await db.insert(village).values({ id: "v1", name: "Test village", kageId: "leader", type: "VILLAGE", tokens: 500_000, structureMaintenanceMonth: "2026-09" });
    await db.insert(villageStructure).values({ id: "bank", name: "Bank", route: "/bank", image: "", villageId: "v1", level: 1 });
    await insertQuests([1, 2].map((id) => ({ id: `mission-${id}`, name: `Mission ${id}`, questType: "village_mission", questRank: "S", hidden: false, consecutiveObjectives: false, content: { reward: ObjectiveReward.parse({ reward_tokens: 100_000 }), objectives: [SimpleObjective.parse(objective)], sceneBackground: "", sceneCharacters: [] } })));
  });

  it("saves a Village Mission without scenes while retaining ordinary quest scene validation", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "OWNER" }).where(eq(userData.userId, "leader"));
    const entry = await db.query.quest.findFirst({ where: eq(quest.id, "mission-1") });
    if (!entry) throw new Error("Missing mission fixture");
    const caller = await callerFor(questsRouter, "leader");
    const discord = spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
    try {
      expect((await caller.update({ id: entry.id, data: { ...entry, name: "Edited shared mission" } })).success).toBe(true);
      expect((await db.query.quest.findFirst({ where: eq(quest.id, entry.id) }))?.name).toBe("Edited shared mission");
      const result = await caller.update({ id: entry.id, data: { ...entry, questType: "mission", questRank: "D", content: { ...entry.content, objectives: [SimpleObjective.parse({ ...objective, task: "pvp_kills" })] } } });
      expect(result.success).toBe(false);
      expect(result.message).toContain("sceneCharacters");
    } finally {
      discord.mockRestore();
    }
  });

  it("retires personal attempts on conversion and refuses personal Village Mission rewards", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "OWNER" }).where(eq(userData.userId, "leader"));
    await db.update(quest).set({ questType: "mission", questRank: "D" }).where(eq(quest.id, "mission-1"));
    await insertQuestHistory([
      { id: "open", userId: "member", questId: "mission-1", questType: "mission", previousCompletes: 3 },
      { id: "finished", userId: "outsider", questId: "mission-1", questType: "mission", completed: 1, previousCompletes: 4, endAt: new Date("2026-09-01") },
    ]);
    const entry = await db.query.quest.findFirst({ where: eq(quest.id, "mission-1") });
    if (!entry) throw new Error("Missing mission fixture");
    const discord = spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
    try {
      const caller = await callerFor(questsRouter, "leader");
      expect((await caller.update({ id: entry.id, data: { ...entry, questType: "village_mission", questRank: "S" } })).success).toBe(true);
    } finally {
      discord.mockRestore();
    }
    const open = await db.query.questHistory.findFirst({ where: eq(questHistory.id, "open") });
    const finished = await db.query.questHistory.findFirst({ where: eq(questHistory.id, "finished") });
    expect(open?.endAt).not.toBeNull();
    expect(open?.completed).toBe(0);
    expect(open?.previousCompletes).toBe(3);
    expect(open?.questType).toBe("mission");
    expect(finished?.endAt).toEqual(new Date("2026-09-01"));
    expect(finished?.previousCompletes).toBe(4);
    expect(finished?.questType).toBe("mission");
    // A stale or legacy personal assignment must still never enter the generic reward path.
    await db.update(questHistory).set({ endAt: null }).where(eq(questHistory.id, "open"));
    const member = await callerFor(questsRouter, "member");
    expect((await member.checkRewards({ questId: entry.id })).success).toBe(false);
    expect((await state())?.tokens).toBe(500_000);
    expect((await db.query.questHistory.findFirst({ where: eq(questHistory.id, "open") }))?.completed).toBe(0);
  });

  it("ordinary members cannot select; racing starts leave exactly one active mission", async () => {
    expect((await (await callerFor(villageMissionRouter, "member")).select({ villageId: "v1" })).success).toBe(false);
    const caller = await leader();
    const results = await Promise.all([caller.select({ villageId: "v1" }), caller.select({ villageId: "v1" })]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect((await state())?.activeMission).not.toBeNull();
    expect(await (await callerFor(villageMissionRouter, "outsider")).get({ id: "v1" })).toBeNull();
  });

  it("staff cancel a rerolled mission without a village penalty and immediately start fresh", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "MODERATOR" }).where(eq(userData.userId, "member"));
    const caller = await leader();
    await caller.select({ villageId: "v1" });
    await caller.select({ villageId: "v1", missionId: (await state())!.activeMission!.id });
    await recordVillageMissionProgress(db, "v1", "member", { combined_mission_effort: 7 });
    const before = (await state())!;
    const staff = await callerFor(villageMissionRouter, "member");
    expect((await staff.get({ id: "v1" }))?.isStaff).toBe(true);
    expect((await staff.cancel({ villageId: "v1", missionId: before.activeMission!.id })).success).toBe(true);
    expect(await state()).toEqual({ ...before, activeMission: null });
    expect((await staff.select({ villageId: "v1" })).success).toBe(true);
    const after = (await state())!;
    expect(after.tokens).toBe(before.tokens);
    expect(after.activeMission?.rerolled).toBe(false);
    expect(after.activeMission?.baseline).toEqual(after.missionCounters);
    expect((await staff.cancel({ villageId: "v1", missionId: before.activeMission!.id })).success).toBe(false);
    expect(await state()).toEqual(after);
  });

  it("rejects cancellation by ordinary Kage, members, banned staff and staff outside the village", async () => {
    const db = await getTestDatabase();
    await (await leader()).select({ villageId: "v1" });
    const before = (await state())!;
    const input = { villageId: "v1", missionId: before.activeMission!.id };
    for (const userId of ["leader", "member", "outsider"]) {
      expect((await (await callerFor(villageMissionRouter, userId)).cancel(input)).success).toBe(false);
    }
    await db.update(userData).set({ role: "MODERATOR", isBanned: true }).where(eq(userData.userId, "member"));
    expect((await (await callerFor(villageMissionRouter, "member")).cancel(input)).success).toBe(false);
    await db.update(userData).set({ role: "MODERATOR" }).where(eq(userData.userId, "outsider"));
    expect((await (await callerFor(villageMissionRouter, "outsider")).cancel(input)).success).toBe(false);
    expect(await state()).toEqual(before);
  });

  it.each([true, false])("rejects a stale personal reward snapshot after content conversion (resolved=%s)", async (resolved) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "OWNER" }).where(eq(userData.userId, "leader"));
    await db.update(userData).set({ money: 100 }).where(eq(userData.userId, "member"));
    await db.update(quest).set({ questType: "mission", questRank: "D" }).where(eq(quest.id, "mission-1"));
    await insertQuestHistory([{ id: "personal", userId: "member", questId: "mission-1", questType: "mission" }]);
    const user = await db.query.userData.findFirst({
      where: eq(userData.userId, "member"),
      with: { userQuests: { with: { quest: true } }, completedQuests: true, items: { with: { item: true } } },
    });
    const history = user?.userQuests[0];
    if (!user || !history) throw new Error("Missing personal quest fixture");
    const discord = spyOn(socials, "callDiscordContent").mockResolvedValue(undefined);
    try {
      const editor = await callerFor(questsRouter, "leader");
      expect((await editor.update({ id: history.questId, data: { ...history.quest, questType: "village_mission", questRank: "S" } })).success).toBe(true);
    } finally {
      discord.mockRestore();
    }
    const retired = await db.query.questHistory.findFirst({ where: eq(questHistory.id, history.id) });
    const claim = await commitQuestObjectiveRewards({
      client: db, userId: user.userId, user: user as never,
      rewards: PostProcessedRewardSchema.parse({ reward_money: 25 }),
      trackers: [], userQuest: history as never, resolved,
      notifications: [], consequences: [], existingHistory: history,
    });
    expect(claim.outcome).toBe("state_changed");
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "member") }))?.money).toBe(100);
    expect(await db.query.questHistory.findFirst({ where: eq(questHistory.id, history.id) })).toEqual(retired);
    // The current content guard also rejects a legacy attempt whose endAt was never retired.
    await db.update(questHistory).set({ endAt: null }).where(eq(questHistory.id, history.id));
    expect((await commitQuestObjectiveRewards({
      client: db, userId: user.userId, user: user as never,
      rewards: PostProcessedRewardSchema.parse({ reward_money: 25 }),
      trackers: [], userQuest: history as never, resolved,
      notifications: [], consequences: [], existingHistory: history,
    })).outcome).toBe("state_changed");
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "member") }))?.money).toBe(100);
  });

  it("pays a completed quest while skipping chained Village Missions, retired S-rank missions and NPC-only destinations", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ money: 100 }).where(eq(userData.userId, "member"));
    await insertQuests([
      { id: "parent", name: "Parent", questType: "event" },
      { id: "legacy-s", name: "Retired S mission", questType: "mission", questRank: "S" },
      { id: "npc-only", name: "NPC quest", questType: "overworld" },
      { id: "ordinary-a", name: "Ordinary A mission", questType: "mission", questRank: "A" },
    ]);
    await insertQuestHistory([{ id: "parent-history", userId: "member", questId: "parent", questType: "event" }]);
    const user = await db.query.userData.findFirst({
      where: eq(userData.userId, "member"),
      with: { userQuests: { with: { quest: true } }, completedQuests: true, items: { with: { item: true } } },
    });
    const history = user?.userQuests[0];
    if (!user || !history) throw new Error("Missing parent quest fixture");
    const claim = await commitQuestObjectiveRewards({
      client: db, userId: user.userId, user: user as never,
      rewards: PostProcessedRewardSchema.parse({ reward_money: 25 }),
      trackers: [], userQuest: history as never, resolved: true,
      notifications: [],
      consequences: [{ type: "start_quest", ids: ["mission-1", "legacy-s", "npc-only", "ordinary-a"] }],
      existingHistory: history,
    });
    expect(claim.outcome).toBe("claimed");
    if (claim.outcome === "claimed") {
      expect(claim.postNotifications.filter((message) => message.startsWith("Started new quest:"))).toEqual(["Started new quest: Ordinary A mission"]);
    }
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "member") }))?.money).toBe(125);
    const histories = await db.query.questHistory.findMany({ where: eq(questHistory.userId, "member") });
    expect(histories.map((entry) => entry.questId).sort()).toEqual(["ordinary-a", "parent"]);
    expect(histories.find((entry) => entry.questId === "parent")?.completed).toBe(1);
    expect(histories.find((entry) => entry.questId === "ordinary-a")?.completed).toBe(0);
  });

  it("aggregates villagers atomically, denies early claims and grants a concurrent reward once", async () => {
    const db = await getTestDatabase();
    const caller = await leader();
    await caller.select({ villageId: "v1" });
    const missionId = (await state())?.activeMission?.id;
    expect((await caller.claim({ villageId: "v1", missionId })).success).toBe(false);
    await recordVillageMissionProgress(db, "v1", "outsider", { combined_mission_effort: 100 });
    await Promise.all(Array.from({ length: 14 }, (_, i) => recordVillageMissionProgress(db, "v1", i % 2 ? "member" : "leader", { combined_mission_effort: 1 })));
    expect((await caller.get({ id: "v1" }))?.mission?.objectives[0]?.current).toBe(14);
    const results = await Promise.all([caller.claim({ villageId: "v1", missionId }), caller.claim({ villageId: "v1", missionId })]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect((await state())?.tokens).toBe(600_000);
    expect((await state())?.activeMission).toBeNull();
    await caller.select({ villageId: "v1" });
    expect((await caller.get({ id: "v1" }))?.mission?.objectives[0]?.current).toBe(0);
  });

  it("returns the confirmed mission clear and token delta without a postwrite SELECT", async () => {
    const db = await getTestDatabase();
    const caller = await leader();
    await caller.select({ villageId: "v1" });
    const missionId = (await state())!.activeMission!.id;
    await recordVillageMissionProgress(db, "v1", "member", { combined_mission_effort: 14 });
    const { result, statements } = await recordQueries(() => caller.claim({ villageId: "v1", missionId }));
    expect(result).toMatchObject({ success: true,
      userPatch: { village: { id: "v1", activeMission: null } },
      userDelta: { village: { id: "v1", tokens: 100_000 } },
    });
    const lastWrite = statements.reduce((last, statement, index) => /^\s*(update|insert|delete)/i.test(statement) ? index : last, -1);
    expect(statements.slice(lastWrite + 1).some((statement) => /^\s*select/i.test(statement))).toBe(false);
    expect((await caller.claim({ villageId: "v1", missionId })).success).toBe(false);
    expect(await state()).toMatchObject({ tokens: 600_000, activeMission: null });
  });

  it.each([[100_000, 113_000], [50, 57]])("rounds %s Village Mission tokens with the claiming Kage's loyalty exactly once", async (rewardTokens, expectedTokens) => {
    const db = await getTestDatabase();
    await db.update(quest).set({ content: { reward: ObjectiveReward.parse({ reward_tokens: rewardTokens }), objectives: [SimpleObjective.parse(objective)], sceneBackground: "", sceneCharacters: [] } }).where(eq(quest.questType, "village_mission"));
    await db.update(userData).set({ joinedVillageAt: new Date(Date.now() - 100 * 86_400_000) }).where(eq(userData.userId, "leader"));
    const caller = await leader();
    await caller.select({ villageId: "v1" });
    const missionId = (await state())?.activeMission?.id;
    await recordVillageMissionProgress(db, "v1", "member", { combined_mission_effort: 14 });
    const results = await Promise.all([caller.claim({ villageId: "v1", missionId }), caller.claim({ villageId: "v1", missionId })]);
    const successful = results.filter((result) => result.success);
    expect(successful).toHaveLength(1);
    expect(successful[0]).toMatchObject({ success: true, message: `${expectedTokens.toLocaleString()} tokens awarded to the village`, userPatch: { village: { id: "v1", activeMission: null } }, userDelta: { village: { id: "v1", tokens: expectedTokens } } });
    expect((await state())?.tokens).toBe(500_000 + expectedTokens);
    expect((await state())?.activeMission).toBeNull();
    expect((await caller.claim({ villageId: "v1", missionId })).success).toBe(false);
    expect((await state())?.tokens).toBe(500_000 + expectedTokens);
  });

  it("persists group PvP credit with the battle version claim and prevents another winner crediting it", async () => {
    const db = await getTestDatabase();
    await (await leader()).select({ villageId: "v1" });
    const original = makeCompleteBattle({ id: "group-credit", version: 1, usersState: [
      makeBattleUser("member", { villageId: "v1", direction: "left" }),
      makeBattleUser("leader", { villageId: "v1", direction: "left" }),
      makeBattleUser("foe-a", { villageId: "v2", direction: "right", curHealth: 0, leftBattle: true }),
      makeBattleUser("foe-b", { villageId: "v2", direction: "right", curHealth: 0, leftBattle: true }),
    ] });
    await db.insert(battle).values(original);
    const settle = async (snapshot: CompleteBattle, userId: string, friendsLeft: number) => {
      snapshot.usersState.find((entry) => entry.userId === userId)!.leftBattle = true;
      const result = { didWin: 1, friendsLeft, targetsLeft: 0 } as CombatResult;
      const claim = await updateBattle(db, result, userId, snapshot, snapshot.version);
      if (claim) await recordVillageMissionProgress(db, "v1", userId, { pvp_kills: result.villageMissionPvpKills ?? 0 });
      return claim;
    };
    const claims = await Promise.all([settle(structuredClone(original), "member", 1), settle(structuredClone(original), "leader", 1)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await state())?.missionCounters.pvp_kills).toBe(2);
    const saved = await db.query.battle.findFirst({ where: eq(battle.id, original.id) });
    if (!saved) throw new Error("Missing persisted battle");
    const credited = saved.usersState.find((entry) => entry.villageMissionPvpCredited);
    expect(credited).toBeDefined();
    // Pool changes after settlement must not release the persisted credit marker.
    credited!.curHealth = 0;
    const otherWinner = credited!.userId === "member" ? "leader" : "member";
    expect(await settle(saved as CompleteBattle, otherWinner, 0)).not.toBeNull();
    expect((await state())?.missionCounters.pvp_kills).toBe(2);
  });

  it("rerolls to a different mission once and starts a new baseline", async () => {
    const db = await getTestDatabase(); const caller = await leader();
    await caller.select({ villageId: "v1" });
    const initial = (await state())?.activeMission;
    await recordVillageMissionProgress(db, "v1", "member", { combined_mission_effort: 7 });
    const results = await Promise.all([caller.select({ villageId: "v1", missionId: initial?.id }), caller.select({ villageId: "v1", missionId: initial?.id })]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    const rerolled = (await state())?.activeMission;
    expect(rerolled?.questId).not.toBe(initial?.questId);
    expect((await caller.get({ id: "v1" }))?.mission?.objectives[0]?.current).toBe(0);
    expect((await caller.select({ villageId: "v1", missionId: rerolled?.id })).success).toBe(false);
  });

  it("bills once per UTC month, pays automatically and carries insufficient-funds debt", async () => {
    const db = await getTestDatabase(); const now = new Date("2026-10-01T00:00:00Z");
    await Promise.all([accrueVillageStructureMaintenance(db, now), accrueVillageStructureMaintenance(db, now)]);
    expect((await state())?.tokens).toBe(400_000);
    expect((await state())?.structureMaintenanceDue).toBe(0);
    await db.update(village).set({ tokens: 0 }).where(eq(village.id, "v1"));
    await accrueVillageStructureMaintenance(db, new Date("2026-12-01T00:00:00Z"));
    expect((await state())?.structureMaintenanceDue).toBe(200_000);
    const kage = await callerFor(kageRouter, "leader");
    expect((await kage.upgradeStructure({ structureId: "bank", villageId: "v1" })).success).toBe(false);
    await db.update(village).set({ tokens: 200_000 }).where(eq(village.id, "v1"));
    const payments = await Promise.all([kage.payStructureMaintenance({ villageId: "v1" }), kage.payStructureMaintenance({ villageId: "v1" })]);
    expect(payments.filter((r) => r.success)).toHaveLength(1);
    expect((await state())?.tokens).toBe(0);
  });

  it("racing structure upgrades charge only once and reject maximum level", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(kageRouter, "leader", synchronizeUpgradeClaims(db));
    const results = await Promise.all([caller.upgradeStructure({ structureId: "bank", villageId: "v1" }), caller.upgradeStructure({ structureId: "bank", villageId: "v1" })]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect((await state())?.tokens).toBe(350_000);
    expect((await db.query.villageStructure.findFirst({ where: eq(villageStructure.id, "bank") }))?.level).toBe(2);
    await db.update(villageStructure).set({ level: 10 }).where(eq(villageStructure.id, "bank"));
    expect((await caller.upgradeStructure({ structureId: "bank", villageId: "v1" })).success).toBe(false);
    expect((await state())?.tokens).toBe(350_000);
  });
  it("credits only shrine HP actually removed, including simultaneous overkill and ended wars", async () => {
    const db = await getTestDatabase();
    await (await leader()).select({ villageId: "v1" });
    const battle = await shrineBattle("VILLAGE_WAR");
    const notifications: string[] = [];
    const settle = async () => {
      const result = shrineResult(-10);
      await updateWars(db, {} as never, battle, result, "member");
      notifications.push(...result.notifications);
    };
    await Promise.all([settle(), settle()]);
    expect((await state())?.missionCounters.siege_operation).toBe(15);
    const captured = await db.query.war.findFirst({ where: eq(war.id, "w1") });
    expect(captured?.defenderShrineHp).toBe(0);
    expect(captured?.defenderShrineStatus).toBe("CAPTURED");
    expect(captured?.defenderWarHealth).toBe(WAR_SHRINE_CAPTURE_WARHEALTH_DMG * 2);
    expect(notifications.filter((message) => message.includes("shrine captured"))).toHaveLength(1);
    await settle();
    expect((await state())?.missionCounters.siege_operation).toBe(15);
    expect(notifications.filter((message) => message.includes("shrine captured"))).toHaveLength(1);
    await db.update(war).set({ defenderShrineHp: 50, endedAt: new Date() }).where(eq(war.id, "w1"));
    await settle();
    expect((await state())?.missionCounters.siege_operation).toBe(15);
    expect((await db.query.war.findFirst({ where: eq(war.id, "w1") }))?.defenderShrineHp).toBe(50);
  });

  it("rejects a failed shrine statement without partial damage, credit, capture or notification", async () => {
    const db = await getTestDatabase();
    await (await leader()).select({ villageId: "v1" });
    const battle = await shrineBattle("VILLAGE_WAR");
    const result = shrineResult(-20);
    await runRawSql("CREATE TRIGGER reject_shrine_credit BEFORE UPDATE ON Village FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Reject shrine credit'");
    try {
      await expect(updateWars(db, {} as never, battle, result, "member")).rejects.toMatchObject({ cause: { message: "Reject shrine credit" } });
    } finally {
      await runRawSql("DROP TRIGGER reject_shrine_credit");
    }
    expect((await state())?.missionCounters.siege_operation ?? 0).toBe(0);
    const saved = await db.query.war.findFirst({ where: eq(war.id, "w1") });
    expect(saved?.defenderShrineHp).toBe(15);
    expect(saved?.defenderShrineStatus).toBe("ACTIVE");
    expect(saved?.defenderWarHealth).toBe(WAR_SHRINE_CAPTURE_WARHEALTH_DMG * 3);
    expect(result.notifications).toEqual([]);
  });

  it.each([
    { type: "SECTOR_WAR" as const, isAi: false, change: 10 },
    { type: "SECTOR_WAR" as const, isAi: true, change: -10 },
    { type: "VILLAGE_WAR" as const, isAi: true, change: -10 },
    { type: "SECTOR_WAR" as const, isAi: false, change: -10 },
    { type: "VILLAGE_WAR" as const, isAi: false, change: -10 },
  ])("settles $type shrine changes without a transaction (AI=$isAi, change=$change)", async ({ type, isAi, change }) => {
    const db = await getTestDatabase();
    await (await leader()).select({ villageId: "v1" });
    const battle = await shrineBattle(type);
    battle.usersState[0]!.isAi = isAi;
    const noTransactions = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "transaction") throw new Error("Unexpected shrine transaction");
        return Reflect.get(target, property, receiver);
      },
    });
    await updateWars(noTransactions, {} as never, battle, shrineResult(change), "member");
    expect((await db.query.war.findFirst({ where: eq(war.id, "w1") }))?.defenderShrineHp).toBe(15 + change);
    expect((await state())?.missionCounters.siege_operation ?? 0).toBe(!isAi && change < 0 ? -change : 0);
  });

  it("captures a shrine and credits its remaining HP with one update and no application fetch", async () => {
    const db = await getTestDatabase();
    await (await leader()).select({ villageId: "v1" });
    const battle = await shrineBattle("VILLAGE_WAR");
    const result = shrineResult(-20);
    const queries = await recordQueries(() => updateWars(db, {} as never, battle, result, "member"));
    expect(queries.statements.filter((statement) => /^\s*UPDATE\b/i.test(statement))).toHaveLength(1);
    expect(queries.statements.some((statement) => /^\s*(SELECT|BEGIN|START TRANSACTION|COMMIT)\b/i.test(statement))).toBe(false);
    expect((await state())?.missionCounters.siege_operation).toBe(15);
    expect(result.notifications.filter((message) => message.includes("shrine captured"))).toHaveLength(1);
  });

  for (const type of ["SECTOR_WAR", "VILLAGE_WAR", "WAR_RAID"] as const) {
    it.each(["unrelated", "opposing", "supporting", "opposing-supporter"] as const)(`${type} keeps siege missions with participating villages (%s teammate)`, async (affiliation) => {
      const db = await getTestDatabase();
      await (await leader()).select({ villageId: "v1" });
      const activeMission = (await state())!.activeMission;
      await db.insert(village).values([
        { id: "v2", name: "Defending village", sector: 2, kageId: "outsider", type: "VILLAGE", activeMission },
        { id: "v3", name: "Third village", sector: 3, kageId: "teammate", type: "VILLAGE", activeMission },
      ]);
      const teammateVillageId = affiliation === "opposing" ? "v2" : "v3";
      await insertUsers([{ userId: "teammate", username: "teammate", villageId: teammateVillageId }]);
      const battle = await shrineBattle(type);
      battle.usersState[0]!.isAggressor = true;
      battle.usersState.push(makeBattleUser("teammate", { direction: "left", villageId: teammateVillageId, sector: 12 }));
      if (affiliation === "supporting" || affiliation === "opposing-supporter") {
        battle.extraState.wars.w1!.warAllies.push({ villageId: "v3", supportVillageId: affiliation === "supporting" ? "v1" : "v2" } as never);
      }
      await updateWars(db, {} as never, battle, shrineResult(-10), "teammate");
      expect((await db.query.war.findFirst({ where: eq(war.id, "w1") }))?.defenderShrineHp).toBe(5);
      expect((await db.query.village.findFirst({ where: eq(village.id, teammateVillageId) }))?.missionCounters.siege_operation ?? 0).toBe(affiliation === "supporting" ? 10 : 0);
      expect((await state())?.missionCounters.siege_operation ?? 0).toBe(0);
    });
  }

  it.each(["outlaw", "membership", "inactive", "town"])("applies shrine damage without mission credit when the current village eligibility changed (%s)", async (reason) => {
    const db = await getTestDatabase();
    await (await leader()).select({ villageId: "v1" });
    const battle = await shrineBattle("VILLAGE_WAR");
    if (reason === "outlaw") await db.update(userData).set({ isOutlaw: true }).where(eq(userData.userId, "member"));
    if (reason === "membership") await db.update(userData).set({ villageId: "v2" }).where(eq(userData.userId, "member"));
    if (reason === "inactive") await db.update(village).set({ activeMission: null }).where(eq(village.id, "v1"));
    if (reason === "town") await db.update(village).set({ type: "STRONGHOLD" }).where(eq(village.id, "v1"));
    const result = shrineResult(-20);
    await updateWars(db, {} as never, battle, result, "member");
    const saved = await db.query.war.findFirst({ where: eq(war.id, "w1") });
    expect(saved?.defenderShrineHp).toBe(0);
    expect(saved?.defenderShrineStatus).toBe("CAPTURED");
    expect(saved?.defenderWarHealth).toBe(WAR_SHRINE_CAPTURE_WARHEALTH_DMG * 2);
    expect((await state())?.missionCounters.siege_operation ?? 0).toBe(0);
    expect(result.notifications.filter((message) => message.includes("shrine captured"))).toHaveLength(1);
  });

  it("upgrades a town with clan points in one guarded write, charging only one concurrent upgrade", async () => {
    const db = await getTestDatabase();
    await db.update(village).set({ type: "STRONGHOLD", leaderUpdatedAt: new Date("2020-01-01") }).where(eq(village.id, "v1"));
    await db.insert(clan).values({ id: "c1", name: "Faction", image: "", villageId: "v1", founderId: "leader", leaderId: "leader", leaderOrderId: "order", points: 500_000 });
    await db.update(userData).set({ clanId: "c1" }).where(eq(userData.userId, "leader"));
    const noTransactions = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "transaction") throw new Error("Unexpected upgrade transaction");
        return Reflect.get(target, property, receiver);
      },
    });
    const caller = callerForDatabase(kageRouter, "leader", synchronizeUpgradeClaims(noTransactions));
    const results = await Promise.all([1, 2].map(() => caller.upgradeStructure({ structureId: "bank", villageId: "v1", clanId: "c1" })));
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect((await db.query.clan.findFirst({ where: eq(clan.id, "c1") }))?.points).toBe(500_000 - BUILDING_UPGRADE_BASE_COST - BUILDING_UPGRADE_PER_LEVEL_COST);
    expect((await state())?.tokens).toBe(500_000);
    expect((await db.query.villageStructure.findFirst({ where: eq(villageStructure.id, "bank") }))?.level).toBe(2);
    // Membership can change after the endpoint's upfront reads but before the guarded write.
    await db.update(villageStructure).set({ level: 1 }).where(eq(villageStructure.id, "bank"));
    await db.update(clan).set({ points: 500_000 }).where(eq(clan.id, "c1"));
    const revoked = new Proxy(noTransactions, {
      get(target, property, receiver) {
        if (property === "execute") return async (...args: Parameters<typeof db.execute>) => {
          await db.update(userData).set({ clanId: null }).where(eq(userData.userId, "leader"));
          return db.execute(...args);
        };
        return Reflect.get(target, property, receiver);
      },
    });
    const staleCaller = callerForDatabase(kageRouter, "leader", revoked);
    expect((await staleCaller.upgradeStructure({ structureId: "bank", villageId: "v1", clanId: "c1" })).success).toBe(false);
    expect((await db.query.clan.findFirst({ where: eq(clan.id, "c1") }))?.points).toBe(500_000);
    expect((await db.query.villageStructure.findFirst({ where: eq(villageStructure.id, "bank") }))?.level).toBe(1);
  });

});

/** Persist the war and preload opposing teams for shrine capture and mission-credit tests. */
const shrineBattle = async (type: "SECTOR_WAR" | "VILLAGE_WAR" | "WAR_RAID") => {
  const db = await getTestDatabase();
  await db.insert(war).values({ id: "w1", attackerVillageId: "v1", defenderVillageId: "v2", type, status: "ACTIVE", sector: 12, defenderShrineHp: 15, defenderShrineMaxHp: 100, defenderWarHealth: WAR_SHRINE_CAPTURE_WARHEALTH_DMG * 3 });
  const persisted = await db.query.war.findFirst({ where: eq(war.id, "w1") });
  return { battleType: "COMBAT", usersState: [
    { userId: "member", direction: "left", villageId: "v1", isAi: false, sector: 12 },
    { userId: "outsider", direction: "right", villageId: "v2", isAi: false, sector: 12 },
  ], extraState: { wars: { w1: { ...persisted, warAllies: [] } } } } as unknown as CompleteBattle;
};

const shrineResult = (change: number) => ({ didWin: 1, shrineChangeHp: change, villageWarShrineInfo: { w1: { attacker: 0, defender: change } }, warHealthChange: 0, notifications: [] } as unknown as CombatResult);

/** Both requests must load the same level before either guarded upgrade can commit. */
const synchronizeUpgradeClaims = (db: Awaited<ReturnType<typeof getTestDatabase>>) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "execute") return async (...args: Parameters<typeof db.execute>) => {
        if (++writes === 2) release();
        await ready;
        return db.execute(...args);
      };
      return Reflect.get(target, property, receiver);
    },
  });
};
