import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { eq, getTableColumns } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { aiProfile, battle, dungeon, dungeonRun, jutsu, jutsuLoadout, userData, userJutsu } from "@/drizzle/schema";
import type { CombatQueryUser } from "@/libs/combat/types";
import { Pusher } from "@/libs/pusher";
import { combatRouter, initiateBattle, processUsersForBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import { JutsuValidator } from "@/validators/combat";
import { makeTag, makeUser } from "../../../../libs/combat/helpers/battleScenario";
import { dungeonBattleState, dungeonContent } from "../../../../setup/dungeon";
import { insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const defaults = (table: typeof jutsu | typeof userData | typeof userJutsu) =>
  Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, column]) => [
    key,
    column.default && typeof column.default === "object" && "queryChunks" in column.default
      ? new Date()
      : (column.default ?? null),
  ]));

const summonJutsu = (id: string, targets: readonly string[]) => ({
  ...defaults(jutsu),
  id,
  ...JutsuValidator.parse({
    ...defaults(jutsu), name: id, image: "/summon.png", description: "Summon",
    battleDescription: "Summon", jutsuType: "AI", jutsuRank: "D",
    requiredRank: "STUDENT", requiredLevel: 1, target: "EMPTY_GROUND", range: 1,
    method: "SINGLE", jutsuWeapon: "NONE", actionCostPerc: 40,
    effects: targets.map((aiId) => makeTag("summon", {
      aiId, aiHp: 500, power: 100, rounds: 3,
      appearAnimation: "/summon.png", appearSfx: "/summon.mp3",
    })),
  }),
}) as typeof jutsu.$inferSelect;

const participant = (userId: string, targets: readonly string[]): CombatQueryUser => ({
  ...defaults(userData),
  ...makeUser({
    userId, username: userId, controllerId: userId, isAi: true, rank: "JONIN",
    level: 100, experience: 3339000, status: "AWAKE",
    effects: [makeTag("increasestat", { power: 10, powerPerLevel: 0 })],
  }),
  items: [],
  jutsus: targets.length ? [{
    ...defaults(userJutsu), id: `owned-${userId}`, userId, jutsuId: `summon-${userId}`,
    jutsu: summonJutsu(`summon-${userId}`, targets), level: 1, equipped: true,
  }] : [],
  userSkills: [], queue: [], cookingJobs: [], raidBuffs: [], userQuests: [],
  completedQuests: [], bloodline: null, sageMode: null, village: null, clan: null,
  bounties: [], bountySignups: [],
}) as unknown as CombatQueryUser;

const preload = (edges: Record<string, readonly string[] | undefined>, roots: readonly string[] = ["A"], reverseRows = false) => {
  const reads: string[] = [];
  const dialect = new MySqlDialect();
  const client = { query: { userData: { findMany: async (options: { where: Parameters<typeof dialect.sqlToQuery>[0] }) => {
    if (reads.length >= 12) throw new Error("PROBE_CAP_REACHED");
    const ids = dialect.sqlToQuery(options.where).params.map(String);
    reads.push(...ids);
    const rows = ids.filter((id) => id in edges).map((id) => participant(id, edges[id]!));
    return reverseRows ? rows.reverse() : rows;
  } } } } as unknown as DrizzleClient;
  return {
    reads,
    process: () => processUsersForBattle(client, {
      users: roots.map((id) => participant(id, edges[id]!)), settings: [], relations: [],
      wars: [], villages: [], defaultProfile: { id: "Default", rules: [], includeDefaultRules: false } as never,
      battleType: "QUEST", hide: false, leftSideUserCount: 0, isSummon: false,
      width: 13, height: 9,
    }),
  };
};

describe("summon preload cycles", () => {
  it("rejects a two-template cycle before reading an ancestor again", async () => {
    const run = preload({ A: ["B"], B: ["A"] });
    await expect(run.process()).rejects.toThrow(/cyclic summon.*A.*B.*A/i);
    expect(run.reads).toEqual(["B"]);
  });

  it.each([
    { edges: { A: ["B"], B: ["C"], C: ["A"] }, roots: ["A"] },
  ])("rejects longer recursive cycles: $roots", async ({ edges, roots }) => {
    const run = preload(edges, roots);
    await expect(run.process()).rejects.toThrow(/cyclic summon/i);
    expect(run.reads.length).toBeLessThanOrEqual(2);
  });

  it.each([
    { edges: { A: ["A"] }, roots: ["A"] },
    { edges: { A: ["B"], B: ["A"] }, roots: ["A", "B"] },
  ])("preserves references already satisfied by the current batch: $roots", async ({ edges, roots }) => {
    const run = preload(edges, roots);
    const result = await run.process();
    expect(run.reads).toEqual([]);
    expect(result.usersState).toHaveLength(roots.length);
  });

  it("allows shared descendants and gives each processed copy independent state and effects", async () => {
    const run = preload({ A: ["B", "C", "B"], B: ["D"], C: [], D: ["C"] });
    const result = await run.process();
    expect(run.reads).toEqual(["B", "C", "D"]);
    const copies = result.usersState.filter((user) => user.controllerId === "C");
    expect(copies).toHaveLength(2);
    expect(new Set(copies.map((user) => user.userId)).size).toBe(2);
    expect(copies.every((user) => user.isSummonTemplate)).toBe(true);
    const effects = copies.map((copy) => result.userEffects.find((effect) => effect.targetId === copy.userId)!);
    expect(effects.every(Boolean)).toBe(true);
    expect(new Set(effects.map((effect) => effect.id)).size).toBe(2);
    copies[0]!.curChakra = 1;
    expect(copies[1]!.curChakra).not.toBe(1);
  });

  it("keeps concurrent preloads independent", async () => {
    const run = preload({ A: ["B"], B: [] }, ["A", "A"]);
    const [first, second] = await Promise.all([run.process(), run.process()]);
    expect(run.reads).toEqual(["B", "B"]);
    expect(first.usersState.filter((user) => user.controllerId === "A")).toHaveLength(2);
    expect(first.usersState.map((user) => user.userId).some((id) => second.usersState.some((user) => user.userId === id))).toBe(false);
  });

  it("preserves fetched template order when the database returns a different ID order", async () => {
    const run = preload({ A: ["B", "C"], B: [], C: [] }, ["A"], true);
    expect((await run.process()).usersState.map((user) => user.controllerId)).toEqual(["A", "C", "B"]);
  });
});

describeWithDatabase("cyclic summon battle admission", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(battle, aiProfile, dungeon, dungeonRun, userData, userJutsu, jutsu, jutsuLoadout);
    await insertUsers([
      ...["human", "teammate-a", "teammate-b"].map((userId) => ({ userId, username: userId, status: "AWAKE" as const, rank: "JONIN" as const, level: 100 })),
      ...["A", "B", "opener"].map((userId) => ({ userId, username: userId, isAi: true, rank: "JONIN" as const, level: 100 })),
    ]);
    const client = await getTestDatabase();
    await client.insert(aiProfile).values({ id: "Default", userId: "A", rules: [] });
    await client.insert(jutsu).values([summonJutsu("summon-A", ["B"]), summonJutsu("summon-B", ["A"])]);
    await client.insert(userJutsu).values(["A", "B"].map((userId) => ({ id: `owned-${userId}`, userId, jutsuId: `summon-${userId}`, equipped: true })));
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(["ordinary", "later wave"] as const)("rejects a cycle in an %s preload before claiming participants", async (mode) => {
    const client = await getTestDatabase();
    const members = ["human", "teammate-a", "teammate-b"];
    const meta = dungeonBattleState({ runState: { ...dungeonBattleState().runState, memberIds: members } });
    const waves = [{ aiIds: ["opener"], delayRounds: 0 }, { aiIds: ["A"], delayRounds: 1 }];
    if (mode === "later wave") {
      await client.update(userData).set({status: "QUEUED"});
      const content = dungeonContent();
      content.tiers[0]![0]!.waves = waves;
      await client.insert(dungeon).values({ id: "definition", content, updatedAt: new Date() });
      await client.insert(dungeonRun).values({
        id: meta.runId, dungeonId: "definition", leaderId: "human", content,
        state: meta.runState, status: "FIGHTING", version: meta.runVersion,
        battleId: "cycle-battle", expiresAt: new Date(meta.expiresAt), createdAt: new Date(),
      });
    }
    const result = await initiateBattle({
      client, userIds: mode === "ordinary" ? ["human"] : members, targetIds: mode === "ordinary" ? ["A"] : ["opener", "A"],
      ...(mode === "later wave" ? { coop: { kind: "dungeon" as const, ...meta, battleId: "cycle-battle", waves } } : {}),
    }, "QUEST");
    expect(result).toMatchObject({ success: false, message: expect.stringMatching(/cyclic summon.*report this to staff/i) });
    expect(await client.query.battle.findMany()).toHaveLength(0);
    expect(await client.query.userData.findFirst({ where: eq(userData.userId, "human") })).toMatchObject({ status: mode === "later wave" ? "QUEUED" : "AWAKE", battleId: null });
    expect(Pusher.prototype.trigger).not.toHaveBeenCalled();
  });

  it("reports a cyclic lobby loadout without replacing the saved battle", async () => {
    const client = await getTestDatabase();
    const created = await initiateBattle({ client, userIds: ["human"], targetIds: ["opener"] }, "SPARRING");
    expect(created.success).toBe(true);
    const before = (await client.query.battle.findFirst())!;
    await client.insert(jutsu).values({ ...summonJutsu("human-summon", ["A"]), jutsuType: "NORMAL" });
    await client.insert(userJutsu).values({ id: "human-owned", userId: "human", jutsuId: "human-summon", equipped: false });
    await client.insert(jutsuLoadout).values({ id: "cyclic-loadout", userId: "human", jutsuIds: ["human-summon"] });
    const result = await (await callerFor(combatRouter, "human")).updateCombatLoadout({ battleId: before.id, jutsuLoadoutId: "cyclic-loadout" });
    expect(result).toMatchObject({ success: false, message: expect.stringMatching(/cyclic summon/i) });
    expect(await client.query.battle.findFirst()).toEqual(before);
  });
});
