import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { Grid, rectangle } from "honeycomb-grid";
import { TerrainHex } from "@/libs/hexgrid";
import { aiProfile, battle, battleHistory, dataBattleAction, logBattleLengths, quest, questHistory, userData } from "@/drizzle/schema";
import { saveUsage, updateBattle, updateUser } from "@/libs/combat/database";
import { DefeatOpponents, ObjectiveTracker } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { getTargetUser } from "@/libs/combat/actions";
import { getBattleSpawnLocations } from "@/libs/combat/participants";
import { calcBattleResult, getDistanceToClosestEnemy } from "@/libs/combat/util";
import { Pusher, type PusherClient } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import { dataRouter } from "@/server/api/routers/data";
import { insertUsers, insertQuests, insertQuestHistory } from "../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";
import { makeBattleUser, makeCompleteBattle } from "./helpers/battleScenario";

const scenario = (battleType: "QUEST" | "OVERWORLD", enemyHealth = 100) => makeCompleteBattle({
  battleType, rewardScaling: 1,
  usersState: [
    makeBattleUser("hero", { direction: "left", villageId: "home", longitude: 3, latitude: 1 }),
    makeBattleUser("guide", { direction: "left", isAi: true, villageId: "elsewhere", longitude: 3, latitude: 2 }),
    makeBattleUser("enemy", { direction: "right", isAi: true, villageId: "home", longitude: 8, latitude: 1, curHealth: enemyHealth }),
  ],
});

describe("quest ally teams", () => {
  for (const type of ["QUEST", "OVERWORLD"] as const) {
    it(`${type} continues until enemies fall, ignoring ally village`, () => {
      expect(calcBattleResult(scenario(type), "hero", [])).toBeNull();
      expect(calcBattleResult(scenario(type, 0), "hero", [])?.didWin).toBe(1);
    });
    it(`${type} measures distance to enemies rather than nearby allies`, () => {
      expect(getDistanceToClosestEnemy(scenario(type), "hero")).toBeGreaterThan(1);
    });
  }
  it("allows ALLY actions on a different-village NPC but not a same-village enemy", () => {
    const { usersState } = scenario("QUEST");
    const guide = usersState[1];
    const enemy = usersState[2];
    const grid = new Grid(TerrainHex, rectangle({ width: 12, height: 10 }));
    if (!guide || !enemy) throw new Error("Expected NPC fixtures");
    guide.hex = grid.getHex({ col: guide.longitude, row: guide.latitude });
    enemy.hex = grid.getHex({ col: enemy.longitude, row: enemy.latitude });
    if (!guide.hex || !enemy.hex) throw new Error("Expected fixture hexes");
    expect(getTargetUser(usersState, "ALLY", guide.hex, "hero", true)?.userId).toBe("guide");
    expect(getTargetUser(usersState, "ALLY", enemy.hex, "hero", true)).toBeUndefined();
  });
  it("enumerates finite distinct spawn cells even on small fields", () => {
    for (const direction of ["left", "right"] as const) {
      const locations = getBattleSpawnLocations(9, 8, direction);
      expect(locations.length).toBeGreaterThan(0);
      expect(new Set(locations.map((l) => `${l.x},${l.y}`)).size).toBe(locations.length);
      expect(locations.every((l) => direction === "left" ? l.x <= 4 : l.x > 4)).toBe(true);
    }
  });
});

describeWithDatabase("NPC ally battle initiation", () => {
  beforeEach(async () => {
    await resetTables(battle, battleHistory, userData, aiProfile, quest, questHistory, dataBattleAction, logBattleLengths);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    const database = await getTestDatabase();
    await database.insert(aiProfile).values({ id: "Default", userId: "template", rules: [] });
    await insertUsers([
      { userId: "hero", username: "hero", status: "AWAKE", level: 50, experience: 20000000, rank: "JONIN" },
      { userId: "template", username: "template", isAi: true, level: 10, rank: "GENIN" },
      { userId: "friendly", username: "friendly", isAi: true, level: 10, rank: "GENIN" },
      { userId: "other-player", username: "other-player", status: "AWAKE" },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  for (const type of ["QUEST", "OVERWORLD"] as const) {
    it(`${type} records enemy levels with no ally and either ally ordering`, async () => {
      const client = await getTestDatabase();
      for (const order of ["no-ally", "hero-first", "ally-first"] as const) {
        const snapshot = scenario(type, 0);
        snapshot.version = 1;
        for (const user of snapshot.usersState) {
          user.level = user.userId === "hero" ? 50 : user.userId === "guide" ? 10 : 40;
        }
        if (order === "no-ally") snapshot.usersState = snapshot.usersState.filter((u) => u.userId !== "guide");
        if (order === "ally-first") snapshot.usersState = [snapshot.usersState[1]!, snapshot.usersState[0]!, snapshot.usersState[2]!];
        await client.insert(battle).values(snapshot);
        const result = calcBattleResult(snapshot, "hero", []);
        expect(result?.didWin).toBe(1);
        const claim = await updateBattle(client, result, "hero", snapshot, snapshot.version);
        expect(claim).not.toBeNull();
        await claim?.finishBattle();
      }
      const rows = await client.query.logBattleLengths.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ battleType: type, winnerLevel: 50, loserLevel: 40, count: 3 });
      const caller = await callerFor(dataRouter, "hero");
      const statistics = await caller.getBattleLengthStatistics({ battleTypes: [type], minLoserLevel: 40, maxLoserLevel: 40 });
      expect(statistics[0]?.count).toBe(3);
      expect(await caller.getBattleLengthStatistics({ battleTypes: [type], minLoserLevel: 10, maxLoserLevel: 10 })).toEqual([]);
    });
  }

  it("clones the same template onto both teams, preloads AI profiles and excludes allies from reward scaling", async () => {
    const client = await getTestDatabase();
    const result = await initiateBattle({ client, userIds: ["hero"], allyAiIds: ["template", "template"], targetIds: ["template"] }, "QUEST");
    expect(result.success).toBe(true);
    const saved = await client.query.battle.findFirst();
    if (!saved) throw new Error("Expected battle");
    const allies = saved.usersState.filter((u) => u.isAi && u.direction === "left");
    const enemies = saved.usersState.filter((u) => u.direction === "right");
    expect(allies).toHaveLength(2);
    expect(enemies).toHaveLength(1);
    expect(new Set(saved.usersState.map((u) => u.userId)).size).toBe(4);
    expect(allies.every((u) => u.longitude <= Math.floor(saved.width / 2))).toBe(true);
    expect(enemies.every((u) => u.longitude > Math.floor(saved.width / 2))).toBe(true);
    expect(saved.extraState.aiProfiles.Default).toBeDefined();
    expect(saved.rewardScaling).toBe(1);
    expect(await client.query.battleHistory.findMany()).toHaveLength(1);
    const npc = await client.query.userData.findFirst({ where: (u, { eq }) => eq(u.userId, "template") });
    expect(npc?.battleId).toBeNull();
  });

  it("rejects player accounts and missing NPC templates before writing", async () => {
    const client = await getTestDatabase();
    for (const id of ["other-player", "missing"]) {
      const result = await initiateBattle({ client, userIds: ["hero"], allyAiIds: [id], targetIds: ["template"] }, "QUEST");
      expect(result.success).toBe(false);
    }
    expect(await client.query.battle.findMany()).toHaveLength(0);
  });

  it("rejects teams that exceed the spawn capacity without hanging or writing", async () => {
    const client = await getTestDatabase();
    const result = await initiateBattle({ client, userIds: ["hero"], allyAiIds: Array(100).fill("template"), targetIds: ["template"] }, "QUEST");
    expect(result).toEqual({ success: false, message: "Too many NPCs for this battlefield" });
    expect(await client.query.battle.findMany()).toHaveLength(0);
  });

  it("records opposite outcomes when the same NPC template fights on both teams", async () => {
    const client = await getTestDatabase();
    const snapshot = scenario("QUEST", 0);
    for (const npc of snapshot.usersState.filter((u) => u.isAi)) npc.controllerId = "template";
    const result = calcBattleResult(snapshot, "hero", []);
    await saveUsage(client, snapshot, result, "hero");
    const rows = await client.query.dataBattleAction.findMany();
    expect(rows.filter((r) => r.type === "ai").map((r) => r.battleWon).sort()).toEqual([0, 1]);
  });

  it("credits only enemies in defeat objectives, never a friendly NPC", async () => {
    const client = await getTestDatabase();
    await insertQuests(["friendly", "template"].map((id) => ({
      id: `defeat-${id}`, questType: "mission", hidden: false, maxCompletes: 100, maxAttempts: 100,
      content: { objectives: [DefeatOpponents.parse({
        id: "goal", task: "defeat_opponents", opponentAIs: [{ ids: [id], number: 1 }],
        sector: 999, longitude: 0, latitude: 0,
      })], reward: ObjectiveReward.parse({}), sceneCharacters: [], sceneBackground: "" },
    })));
    await insertQuestHistory(["friendly", "template"].map((id) => ({ userId: "hero", questId: `defeat-${id}`, questType: "mission" })));
    await client.update(userData).set({ questData: ["friendly", "template"].map((id) => ({
      id: `defeat-${id}`, startAt: new Date().toISOString(), goals: [ObjectiveTracker.parse({ id: "goal" })],
    })) }).where(eq(userData.userId, "hero"));
    await initiateBattle({ client, userIds: ["hero"], allyAiIds: ["friendly"], targetIds: ["template"] }, "QUEST");
    const snapshot = await client.query.battle.findFirst();
    if (!snapshot) throw new Error("Expected battle");
    for (const npc of snapshot.usersState) npc.curHealth = npc.direction === "left" ? 100 : 0;
    const result = calcBattleResult(snapshot, "hero", []);
    const pusher = { trigger: vi.fn(async () => {}) } as unknown as PusherClient;
    await updateUser(client, pusher, snapshot, result, "hero");
    const saved = await client.query.userData.findFirst({ where: (u, { eq }) => eq(u.userId, "hero") });
    expect(saved?.questData?.find((q) => q.id === "defeat-friendly")?.goals[0]?.done).toBe(false);
    expect(saved?.questData?.find((q) => q.id === "defeat-template")?.goals[0]?.done).toBe(true);
  });

});
