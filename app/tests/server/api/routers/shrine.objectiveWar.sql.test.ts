import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  SHRINE_BATTLE_LOBBY_SECONDS,
  WAR_ESPIONAGE_TARGET,
  WAR_OBJECTIVES_PER_SIDE,
} from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  battleHistory,
  gameSetting,
  mpvpBattleQueue,
  mpvpBattleUser,
  notification,
  questHistory,
  sector,
  userData,
  village,
  villageAlliance,
  war,
  warAlly,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { shrineRouter } from "@/server/api/routers/shrine";
import { startDeclaredWar } from "@/server/utils/war";
import { insertUsers } from "../../../setup/factories";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("shrine lobby objective war eligibility", () => {
  let lobbyId = "";
  let warId = "";

  beforeEach(async () => {
    await resetTables(
      battleHistory, battle, mpvpBattleUser, mpvpBattleQueue, aiProfile, gameSetting,
      notification, warAlly, war, sector, questHistory, userData, villageAlliance, village,
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => Response.json(
      String(url).endsWith("/pipeline") ? [{ result: [59, 60] }] : { result: [59, 60] },
    ));
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "a", name: "a", sector: 100, kageId: "hero", tokens: 1000000 },
      { id: "b", name: "b", sector: 200, kageId: "foe", tokens: 1000000 },
    ]);
    await db.insert(villageAlliance).values({
      id: "enemy", villageIdA: "a", villageIdB: "b", status: "ENEMY",
    });
    await db.insert(sector).values([
      { sector: 101, villageId: "b" }, { sector: 102, villageId: "b" },
      { sector: 103, villageId: "a" }, { sector: 104, villageId: "a" },
    ]);
    await insertUsers([
      { userId: "hero", villageId: "a" }, { userId: "ally", villageId: "a" },
      { userId: "foe", villageId: "b" },
    ].map((user) => ({
      ...user, username: user.userId, status: "AWAKE", rank: "JONIN", experience: 1000,
      curHealth: 100, maxHealth: 100, curStamina: 100, maxStamina: 100,
      curChakra: 100, maxChakra: 100, sector: 101,
    })));
    await db.insert(aiProfile).values({ id: "Default", userId: "default-ai", rules: [] });

    // An enemy shrine lobby can already exist when elder approval selects its sector.
    const hero = callerForDatabase(shrineRouter, "hero", db);
    expect((await hero.challengeShrine({ sectorNumber: 101 })).success).toBe(true);
    lobbyId = (await db.query.mpvpBattleQueue.findFirst())!.id;
    for (const [userId, side] of [["ally", "ATTACKER"], ["foe", "DEFENDER"]] as const) {
      expect((await callerForDatabase(shrineRouter, userId, db).joinShrineBattle({
        shrineBattleId: lobbyId, side,
      })).success).toBe(true);
    }
    await db.update(mpvpBattleQueue).set({
      createdAt: new Date(Date.now() - (SHRINE_BATTLE_LOBBY_SECONDS + 1) * 1000),
    }).where(eq(mpvpBattleQueue.id, lobbyId));
    await db.insert(gameSetting).values({
      id: "OBJECTIVE_WAR_enabled", name: "OBJECTIVE_WAR_enabled", value: 1, time: new Date(),
    });
    expect(await startDeclaredWar(db, {
      attackerVillageId: "a", attackerVillageName: "a", defenderVillageId: "b",
      defenderVillageName: "b", initiatedByUserId: "hero", warType: "VILLAGE_WAR",
      targetStructureRoute: "/townhall",
    })).toBe(true);
    const declared = (await db.query.war.findFirst())!;
    warId = declared.id;
    expect(declared.objectiveState?.objectives).toHaveLength(WAR_OBJECTIVES_PER_SIDE * 2);
    expect(declared.objectiveState?.objectives).toContainEqual(expect.objectContaining({
      sector: 101, villageId: "b", destroyed: false,
    }));
    expect(declared.objectiveState?.attackerEspionage).toBe(0);
    expect(declared.combatStartedAt!.getTime()).toBeGreaterThan(Date.now());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTables(gameSetting);
  });

  it.each([
    ["hidden during notice", false, 0],
    ["revealed during notice", false, WAR_ESPIONAGE_TARGET],
    ["hidden during active combat", true, 0],
  ] as const)("rejects an existing lobby when its objective is %s", async (_name, active, espionage) => {
    const db = await getTestDatabase();
    const declared = (await db.query.war.findFirst({ where: eq(war.id, warId) }))!;
    await db.update(war).set({
      combatStartedAt: new Date(Date.now() + (active ? -3600000 : 3600000)),
      objectiveState: { ...declared.objectiveState!, attackerEspionage: espionage },
    }).where(eq(war.id, warId));

    const result = await callerForDatabase(shrineRouter, "hero", db).initiateShrineBattle({
      shrineBattleId: lobbyId,
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("unavailable until active combat and completed espionage");
    expect(await db.query.battle.findMany()).toHaveLength(0);
    expect(await db.query.battleHistory.findMany()).toHaveLength(0);
    expect((await db.query.mpvpBattleQueue.findFirst({
      where: eq(mpvpBattleQueue.id, lobbyId),
    }))?.battleId).toBeNull();
    expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(3);
    for (const user of await db.query.userData.findMany()) {
      expect(user.status).toBe("QUEUED");
      expect(user.battleId).toBeNull();
    }
  });

  it("allows the rejected lobby to retry after combat starts and espionage completes", async () => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(shrineRouter, "hero", db);
    expect((await caller.initiateShrineBattle({ shrineBattleId: lobbyId })).success).toBe(false);
    const declared = (await db.query.war.findFirst({ where: eq(war.id, warId) }))!;
    await db.update(war).set({
      combatStartedAt: new Date(Date.now() - 3600000),
      objectiveState: { ...declared.objectiveState!, attackerEspionage: WAR_ESPIONAGE_TARGET },
    }).where(eq(war.id, warId));

    const result = await caller.initiateShrineBattle({ shrineBattleId: lobbyId });
    expect(result.success, result.message).toBe(true);
    expect(result).not.toHaveProperty("userPatch");
    expect(result).not.toHaveProperty("userDelta");
    const saved = (await db.query.battle.findFirst({ where: eq(battle.id, result.battleId!) }))!;
    expect(saved.battleType).toBe("SHRINE_WAR");
    expect(saved.extraState.wars[warId]?.objectiveState?.attackerEspionage).toBe(WAR_ESPIONAGE_TARGET);
    expect((await db.query.mpvpBattleQueue.findFirst({
      where: eq(mpvpBattleQueue.id, lobbyId),
    }))?.battleId).toBe(saved.id);
    for (const user of await db.query.userData.findMany()) {
      expect(user.status).toBe("BATTLE");
      expect(user.battleId).toBe(saved.id);
    }
  });
});
