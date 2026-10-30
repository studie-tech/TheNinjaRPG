import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { getTableColumns, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { aiProfile, battle, dungeon, dungeonMember, dungeonRun, jutsu, userData, userJutsu } from "@/drizzle/schema";
import { prepareEncounterWaves } from "@/libs/combat/encounters";
import type { CombatQueryUser } from "@/libs/combat/types";
import { Pusher } from "@/libs/pusher";
import { SAGE_MODE_ACTIVATION_JUTSU } from "@/libs/sageMode";
import { initiateBattle, processUsersForBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import { makeTag, makeUser } from "../../../../libs/combat/helpers/battleScenario";
import { dungeonBattleState, dungeonContent } from "../../../../setup/dungeon";
import { insertUsers } from "../../../../setup/factories";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const participant = (userId: string, summons: string[] = []): CombatQueryUser => ({
  ...Object.fromEntries(Object.entries(getTableColumns(userData)).map(([key, column]) => [
    key,
    column.default && typeof column.default === "object" && "queryChunks" in column.default
      ? new Date() : (column.default ?? null),
  ])),
  ...makeUser({ userId, username: userId, isAi: true, rank: "JONIN", experience: 3339000, status: "AWAKE" }),
  items: [], jutsus: [], aiProfile: null, bloodline: null, village: null,
  userSkills: summons.map((aiId) => ({
    skillId: `summon-${aiId}`,
    skill: { target: "ENEMIES", effects: [makeTag("summon", { aiId })] },
  })),
}) as unknown as CombatQueryUser;

type TemplateCache = NonNullable<Parameters<typeof processUsersForBattle>[1]["summonTemplateCache"]>;
const prepare = (client: DrizzleClient, ids: string[], cache?: TemplateCache) =>
  processUsersForBattle(client, {
    users: [participant("caster", ids)], settings: [], relations: [], wars: [], villages: [],
    defaultProfile: { id: "Default", userId: "default", rules: [], includeDefaultRules: false },
    battleType: "QUEST", hide: false, leftSideUserCount: 0, isSummon: false,
    width: 13, height: 9, summonTemplateCache: cache,
  });

const database = (rows: CombatQueryUser[]) => {
  const reads: string[][] = [];
  const findMany = vi.fn(async ({ where }: { where: SQL }) => {
    const ids = new MySqlDialect().sqlToQuery(where).params as string[];
    reads.push(ids);
    return structuredClone(rows.filter((row) => ids.includes(row.userId)));
  });
  return { client: { query: { userData: { findMany } } } as unknown as DrizzleClient, reads };
};

describe("summon template preparation scope", () => {
  it("reads a shared source once across five ordered waves with independent states and effects", async () => {
    const source = participant("shared");
    source.effects = [makeTag("increasemaxpools", { power: 75, powerPerLevel: 0, calculation: "static", poolsAffected: ["Chakra"] })];
    source.jutsus = [{
      id: "source-owned", userId: "shared", jutsuId: "source-action", level: 1,
      experience: 0, equipped: true,
      jutsu: { ...SAGE_MODE_ACTIVATION_JUTSU, id: "source-action", effects: [], jutsuType: "NORMAL", requiredRank: "STUDENT" },
    }] as unknown as CombatQueryUser["jutsus"];
    const { client, reads } = database([source]);
    const cache: TemplateCache = new Map();
    const opening = await prepare(client, ["shared"], cache);
    const waves = Array.from({ length: 5 }, (_, index) => ({ aiIds: [`caster-${index}`], delayRounds: index }));
    const seen: string[] = [];
    const encounter = await prepareEncounterWaves(waves, opening, async (wave) => {
      seen.push(wave.aiIds[0]!);
      return prepare(client, ["shared"], cache);
    });
    expect(reads).toEqual([["shared"]]);
    expect(seen).toEqual(["caster-1", "caster-2", "caster-3", "caster-4"]);
    expect(encounter.pendingWaves.map((wave) => wave.delayRounds)).toEqual([1, 2, 3, 4]);
    const states = [opening.usersState, ...encounter.pendingWaves.map((wave) => wave.users)];
    const effects = [opening.userEffects, ...encounter.pendingWaves.map((wave) => wave.effects)].flat();
    const summons = states.map((state) => state.find((user) => user.controllerId === "shared")!);
    expect(summons.every((user) => user.isSummonTemplate && user.curHealth === 0)).toBe(true);
    expect(new Set(summons.map((user) => user.userId)).size).toBe(5);
    expect(new Set(effects.map((effect) => effect.id)).size).toBe(effects.length);
    expect(effects.filter((effect) => summons.some((user) => user.userId === effect.targetId))).toHaveLength(5);
    summons[0]!.actionPoints = 0;
    summons[0]!.jutsus[0]!.lastUsedRound = 100;
    expect(summons.slice(1).every((user) => user.actionPoints === 100)).toBe(true);
    expect(summons.slice(1).every((user) => user.jutsus[0]!.lastUsedRound !== 100)).toBe(true);
    opening.extraState.enemySkills!["summon-shared"]![0]!.power = 999;
    const later = await prepare(client, ["shared"], cache);
    expect(later.extraState.enemySkills!["summon-shared"]![0]!.power).not.toBe(999);
    expect(await cache.get("shared")).toEqual([source]);
  });

  it("shares pending reads without re-executing a Drizzle-style thenable", async () => {
    let executions = 0;
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    const queried = new Promise<void>((resolve) => { started = resolve; });
    const client = { query: { userData: { findMany: () => ({
      then: (resolve: (rows: CombatQueryUser[]) => unknown) => {
        executions++;
        started();
        return ready.then(() => resolve([participant("shared")]));
      },
    }) } } } as unknown as DrizzleClient;
    const cache: TemplateCache = new Map();
    const results = Promise.all([prepare(client, ["shared"], cache), prepare(client, ["shared"], cache)]);
    await queried;
    expect(executions).toBe(1);
    release();
    const [first, second] = await results;
    expect(executions).toBe(1);
    expect(first.usersState[1]!.userId).not.toBe(second.usersState[1]!.userId);
  });

  it("batches new IDs, remembers absent templates, and isolates later preparations", async () => {
    const { client, reads } = database([participant("a"), participant("b"), participant("c")]);
    const cache: TemplateCache = new Map();
    await prepare(client, ["a", "a", "absent"], cache);
    const next = await prepare(client, ["a", "absent", "b", "c"], cache);
    expect(reads).toEqual([["a", "absent"], ["b", "c"]]);
    expect(next.usersState.map((user) => user.controllerId)).toEqual(["caster", "a", "b", "c"]);
    await prepare(client, ["a"]);
    await prepare(client, ["a"]);
    expect(reads.slice(2)).toEqual([["a"], ["a"]]);
  });

  it("passes the cache into recursive summon preparation", async () => {
    const { client, reads } = database([participant("parent", ["child"]), participant("child")]);
    const cache: TemplateCache = new Map();
    await prepare(client, ["parent"], cache);
    await prepare(client, ["parent"], cache);
    expect(reads).toEqual([["parent"], ["child"]]);
  });

  it("retains cached database order while selecting only the current wave's templates", async () => {
    const { client, reads } = database([participant("b"), participant("a")]);
    const cache: TemplateCache = new Map();
    const first = await prepare(client, ["a", "b", "absent"], cache);
    const repeated = await prepare(client, ["a", "b"], cache);
    const subset = await prepare(client, ["a"], cache);
    const absent = await prepare(client, ["absent"], cache);
    expect(reads).toEqual([["a", "b", "absent"]]);
    expect(first.usersState.map((user) => user.controllerId)).toEqual(["caster", "b", "a"]);
    expect(repeated.usersState.map((user) => user.controllerId)).toEqual(["caster", "b", "a"]);
    expect(subset.usersState.map((user) => user.controllerId)).toEqual(["caster", "a"]);
    expect(absent.usersState.map((user) => user.controllerId)).toEqual(["caster"]);
  });
});

describeWithDatabase("initiated wave summon preloads", () => {
  beforeEach(async () => {
    await resetTables(dungeonMember, battle, aiProfile, dungeon, dungeonRun, userData, jutsu, userJutsu);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("loads the shared summon once during dungeon initiation", async () => {
    const client = await getTestDatabase();
    const members = ["preload-a", "preload-b", "preload-c"];
    await insertUsers([
      ...members.map((userId) => ({ userId, username: userId, status: "QUEUED" as const, level: 50, rank: "JONIN" as const })),
      { userId: "caster", username: "Caster", isAi: true, level: 50, rank: "JONIN" as const },
      { userId: "shared", username: "Shared", isAi: true, level: 50, rank: "JONIN" as const },
    ]);
    await client.insert(jutsu).values({
      id: "preload-summon", name: "Summon", description: "Summon", battleDescription: "Summon", image: "/jutsu.png",
      effects: [makeTag("summon", { aiId: "shared" })], target: "EMPTY_GROUND", range: 3, requiredRank: "STUDENT", jutsuType: "NORMAL",
    });
    await client.insert(userJutsu).values({ id: "preload-owned", userId: "caster", jutsuId: "preload-summon", equipped: true });
    await client.insert(aiProfile).values({ id: "Default", userId: "caster", rules: [] });
    const reads = vi.spyOn(client.query.userData, "findMany");
    const waves = Array.from({ length: 5 }, (_, index) => ({ aiIds: ["caster"], delayRounds: index ? 1 : 0 }));
    const meta = dungeonBattleState({ runState: { ...dungeonBattleState().runState, memberIds: members } });
    const content = dungeonContent();
    content.tiers[0]![0]!.waves = waves;
    await client.insert(dungeon).values({ id: "preload-definition", content, updatedAt: new Date() });
    await client.insert(dungeonRun).values({
      id: meta.runId, dungeonId: "preload-definition", leaderId: members[0]!, content,
      state: meta.runState, status: "FIGHTING", version: meta.runVersion,
      battleId: "preload-battle", expiresAt: new Date(meta.expiresAt), createdAt: new Date(),
    });
    await client.insert(dungeonMember).values(members.map((userId) => ({ runId: meta.runId, userId, activeUserId: userId })));
    const result = await initiateBattle({
      client, userIds: members, targetIds: waves.flatMap((wave) => wave.aiIds),
      coop: { kind: "dungeon", ...meta, battleId: "preload-battle", waves },
    }, "QUEST");
    expect(result).toMatchObject({ success: true });
    // One participant query and one summon query, rather than a summon query per wave.
    expect(reads).toHaveBeenCalledTimes(2);
    const saved = (await client.query.battle.findFirst())!;
    const pending = saved.extraState.encounter!.pendingWaves;
    expect(pending).toHaveLength(4);
    for (const users of [saved.usersState, ...pending.map((wave) => wave.users)]) {
      expect(users.filter((user) => user.controllerId === "shared" && user.isSummonTemplate)).toHaveLength(1);
      expect(users.filter((user) => user.controllerId === "caster" && !user.isSummon)).toHaveLength(1);
    }
  });
});
