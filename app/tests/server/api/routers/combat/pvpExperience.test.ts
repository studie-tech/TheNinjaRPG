import { combatSharedCooldown, jutsuEquipLimit } from "@/drizzle/schema";
import { equipLimitFixture } from "../../../../setup/jutsuEquipLimits";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { getTableColumns, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { type BattleType, WAR_SECTORWAR_AI_SHRINE_REDUCE } from "@/drizzle/constants";
import { battle, battleHistory, userData } from "@/drizzle/schema";
import type { CompleteBattle } from "@/libs/combat/types";
import { calcBattleResult } from "@/libs/combat/util";
import { Pusher } from "@/libs/pusher";
import { initiateBattle } from "@/server/api/routers/combat";
import type { DrizzleClient } from "@/server/db";
import { makeUser } from "../../../../libs/combat/helpers/battleScenario";

const participant = (userId: string, villageId: string, isAi = false) => ({
  ...Object.fromEntries(
    Object.entries(getTableColumns(userData)).map(([key, column]) => [
      key,
      column.default && typeof column.default === "object" && "queryChunks" in column.default
        ? new Date()
        : column.default ?? null,
    ]),
  ),
  ...makeUser({ userId, username: userId, controllerId: userId, villageId, isAi, experience: 3339000, rank: "JONIN", status: "AWAKE", pvpStreak: 4, clanId: "clan" }),
  items: [], jutsus: [], userSkills: [], queue: [], cookingJobs: [], raidBuffs: [], userQuests: [], completedQuests: [],
  bounties: [], bountySignups: [], bloodline: null, sageMode: null, village: null, clan: null,
  regenAt: new Date(), joinedVillageAt: new Date(),
});

const startBattle = async (battleType: BattleType, repeats: number, defenderAi = false, team?: {
  users: ReturnType<typeof participant>[];
  userIds: string[];
  targetIds: string[];
}) => {
  const users = team?.users ?? [participant("attacker", "a"), participant("defender", "b", defenderAi)];
  let saved: CompleteBattle | undefined;
  const historyReads: SQL[] = [];
  const phases: string[] = [];
  const client = {
    query: new Proxy({}, { get: (_target, key) => ({
      findMany: async () => key === "userData" ? structuredClone(users) : [],
      findFirst: async () => key === "aiProfile" ? { id: "Default", rules: [], includeDefaultRules: false } : undefined,
    }) }),
    select: () => ({ from: (table: object) => {
        if (table === combatSharedCooldown) return { orderBy: async () => [] };
        if (table === jutsuEquipLimit) return { orderBy: async () => equipLimitFixture };
      const rows = table === battleHistory ? [{ count: repeats }] : table === userData ? [{ average: 0 }] : [];
      const builder = {
        innerJoin: () => builder,
        where: (predicate: SQL) => {
          if (table === battleHistory) { historyReads.push(predicate); phases.push("history"); }
          return builder;
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return builder;
    } }),
    insert: (table: object) => ({ values: async (value: unknown) => {
      phases.push("write");
      if (table === battle) saved = value as CompleteBattle;
      return { rowsAffected: 1 };
    } }),
    update: () => ({ set: () => ({ where: async () => ({ rowsAffected: users.filter((user) => !user.isAi).length }) }) }),
  } as unknown as DrizzleClient;
  expect((await initiateBattle({ client, userIds: team?.userIds ?? ["attacker"], targetIds: team?.targetIds ?? ["defender"], biome: "default" }, battleType)).success).toBe(true);
  if (!saved) throw new Error("Battle was not inserted");
  saved.groundEffects = [];
  return { saved, historyReads, phases };
};

describe("repeat-opponent PvP XP at battle initiation", () => {
  beforeEach(() => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });
  afterEach(() => vi.restoreAllMocks());

  it("allows a bracket-7 initiator to attack Elite Jonin with a lower-bracket ally", async () => {
    const result = await startBattle("COMBAT", 0, false, {
      users: [participant("attacker", "a"), { ...participant("ally", "a"), experience: 2_000_000 }, { ...participant("defender", "b"), rank: "ELITE JONIN" }],
      userIds: ["attacker", "ally"], targetIds: ["defender"],
    });
    expect(result.saved.usersState.filter(user => !user.isAi)).toHaveLength(3);
  });

  it("uses the initiator's ordinary bracket even when an Elite Jonin ally joins", async () => {
    const result = await startBattle("COMBAT", 0, false, {
      users: [{ ...participant("attacker", "a"), experience: 2_000_000 }, { ...participant("ally", "a"), rank: "ELITE JONIN" }, { ...participant("defender", "b"), experience: 2_000_000 }],
      userIds: ["attacker", "ally"], targetIds: ["defender"],
    });
    expect(result.saved.usersState.filter(user => !user.isAi)).toHaveLength(3);
  });

  it.each([
    ["COMBAT", 2, false, "Won", 83.33, 1 / 3],
    ["SHRINE_WAR", 0, false, "Won", 250, 1],
    ["SHRINE_WAR", 2, false, "Won", 83.33, 1],
    ["SHRINE_WAR", 2, false, "Lost", 33.33, 1],
    ["SHRINE_WAR", 2, false, "Draw", 33.33, 1],
    ["SHRINE_WAR", 2, false, "Fled", 0, 1],
    ["SHRINE_WAR", 2, true, "Won", 0, 1],
  ] as const)("%s with %s prior meetings, AI=%s, outcome=%s awards %s XP", async (battleType, repeats, defenderAi, outcome, xp, scaling) => {
    const { saved, historyReads, phases } = await startBattle(battleType, repeats, defenderAi);
    expect(historyReads).toHaveLength(1);
    expect(phases.indexOf("history")).toBeLessThan(phases.indexOf("write"));
    const query = new MySqlDialect().sqlToQuery(historyReads[0]!);
    expect(query.params.slice(0, 4)).toEqual(["attacker", "defender", "defender", "attacker"]);
    const historyCutoff = new Date(`${String(query.params[4]).replace(" ", "T")}Z`);
    expect(Math.abs(historyCutoff.getTime() - (Date.now() - 3600000))).toBeLessThan(2000);
    expect(saved.rewardScaling).toBe(scaling);
    expect(saved.extraState.pvpExperienceScaling).toBe(battleType === "SHRINE_WAR" && !defenderAi ? 1 / (repeats + 1) : undefined);

    const attacker = saved.usersState.find((user) => user.userId === "attacker")!;
    const defender = saved.usersState.find((user) => user.controllerId === "defender")!;
    attacker.curHealth = outcome === "Lost" || outcome === "Draw" ? 0 : 100;
    defender.curHealth = outcome === "Won" || outcome === "Draw" ? 0 : 100;
    attacker.fledBattle = outcome === "Fled";
    const result = calcBattleResult(saved, "attacker");
    expect(result?.pvpExperience).toBe(xp);
    expect(result?.weeklyPvpKills).toBe(outcome === "Won" && !defenderAi ? 1 : 0);
    if (battleType === "SHRINE_WAR") expect(result?.pvpStreak).toBe(4);
  });

  it("reduces only human shrine PvP XP while retaining shrine damage and other rewards", async () => {
    const { saved } = await startBattle("SHRINE_WAR", 2);
    saved.extraState.wars["sector-war"] = { id: "sector-war", type: "SECTOR_WAR", attackerVillageId: "a", defenderVillageId: "b", sector: 7, warAllies: [], attackerVillage: { name: "A" }, defenderVillage: { name: "B" } } as never;
    saved.usersState.find((user) => user.userId === "defender")!.curHealth = 0;
    const baseline = structuredClone(saved);
    delete baseline.extraState.pvpExperienceScaling;
    const before = calcBattleResult(baseline, "attacker");
    const after = calcBattleResult(saved, "attacker");
    if (!before || !after) throw new Error("Shrine battle did not finish");
    expect(before?.pvpExperience).toBe(250);
    expect(after?.pvpExperience).toBe(83.33);
    expect(after?.shrineChangeHp).toBe(-WAR_SECTORWAR_AI_SHRINE_REDUCE);
    expect(after?.shrineInfo).toEqual({ 7: -WAR_SECTORWAR_AI_SHRINE_REDUCE });
    expect(after?.money).toBeGreaterThan(0);
    expect(after?.clanPoints).toBe(1);
    expect(after).toEqual({ ...before, pvpExperience: 83.33 });
  });
});
