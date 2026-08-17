import { describe, it, expect, vi } from "vitest";
import { Grid, rectangle } from "honeycomb-grid";
import { performAIaction } from "@/libs/combat/ai_v2";
import type { CompleteBattle, BattleUserState } from "@/libs/combat/types";

// Provide a concrete PathCalculator stub so this test is not poisoned by
// actions.test.ts, which mocks @/libs/hexgrid with PathCalculator: vi.fn()
// (Bun shares the module cache across files run in the same process).
// We re-export everything else from the real module; only PathCalculator
// is replaced with a minimal implementation that returns an empty path,
// which is enough to drive a piloted/non-piloted summon to the no-action branch.
// Self-contained SYNC mock (Bun's vi.mock shares one registry across files and
// provides neither importOriginal nor a safe async dynamic import). We supply a
// real honeycomb Hex for grid construction, stub the pathfinder, and return no
// hex from findHex so ai_v2's pathfinding short-circuits to the no-action branch.
vi.mock("@/libs/hexgrid", () => {
  const { defineHex } = require("honeycomb-grid") as typeof import("honeycomb-grid");
  class StubPathCalculator {
    constructor(_grid: unknown) {}
    getShortestPath(_origin: unknown, _target: unknown) {
      return [];
    }
  }
  return {
    TerrainHex: defineHex({ dimensions: 1 }),
    findHex: () => undefined,
    getPossibleActionTiles: () => new Set(),
    PathCalculator: StubPathCalculator,
  };
});

// Avoid loading the real DB/env when transitive imports touch @/server/db.
vi.mock("@/server/db", () => ({ drizzleDB: {} }));

import { TerrainHex } from "@/libs/hexgrid";

const mkUser = (over: Partial<BattleUserState>): BattleUserState =>
  ({
    userId: "x",
    username: "x",
    controllerId: "x",
    isAi: true,
    isSummon: false,
    isPiloted: false,
    curHealth: 100,
    maxHealth: 100,
    curChakra: 0,
    maxChakra: 0,
    curStamina: 0,
    maxStamina: 0,
    fledBattle: false,
    leftBattle: false,
    longitude: 1,
    latitude: 1,
    actionPoints: 100,
    effects: [],
    jutsus: [],
    items: [],
    basicActions: [],
    round: 0,
    direction: "right",
    isAggressor: false,
    highestOffence: "ninjutsuOffence",
    highestDefence: "ninjutsuDefence",
    highestGenerals: [],
    iAmHere: true,
    originalLevel: 1,
    originalMoney: 0,
    originalLongitude: 1,
    originalLatitude: 1,
    isOriginal: false,
    usedGenerals: {} as Record<string, number>,
    usedStats: {} as Record<string, number>,
    moneyStolen: 0,
    allyVillage: false,
    usedActions: [],
    initiative: 0,
    relationIds: [],
    warIds: [],
    ...over,
  } as unknown as BattleUserState);

const makeBattle = (users: BattleUserState[]): CompleteBattle =>
  ({
    id: "test-battle",
    round: 1,
    battleType: "COMBAT",
    activeUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    roundStartAt: new Date(),
    background: "None",
    width: 5,
    height: 5,
    version: 1,
    rewardScaling: 1,
    forceKeepPools: false,
    usersState: users,
    usersEffects: [],
    groundEffects: [],
    extraState: {
      jutsus: {},
      jutsuReskins: {},
      items: {},
      bloodlines: {},
      aiProfiles: {},
      villages: {},
      clans: {},
      questData: {},
      anbuSquads: {},
      keystoneItems: {},
      wars: {},
      relations: {},
      userQuests: {},
      completedQuests: {},
      bounties: {},
      bountySignups: {},
    },
  } as unknown as CompleteBattle);

describe("performAIaction piloted-summon defensive guard", () => {
  it("does NOT self-kill a piloted summon that has no affordable action", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: 5, height: 5 }));

    const piloted = mkUser({
      userId: "summon1",
      username: "SummonOne",
      controllerId: "player1",
      isSummon: true,
      isPiloted: true,
      curHealth: 50,
      curChakra: 0,
      curStamina: 0,
      longitude: 1,
      latitude: 1,
    });

    const enemy = mkUser({
      userId: "enemy1",
      username: "EnemyOne",
      controllerId: "enemy1",
      isAi: false,
      longitude: 3,
      latitude: 3,
    });

    const battle = makeBattle([piloted, enemy]);
    const { nextBattle } = performAIaction(battle, grid, "summon1");
    const after = nextBattle.usersState.find((u) => u.userId === "summon1");
    // Piloted entity must NEVER be self-killed — its health stays intact
    expect(after?.curHealth).toBe(50);
  });

  it("DOES self-kill a non-piloted AI summon that has no affordable action", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: 5, height: 5 }));

    const aiSummon = mkUser({
      userId: "summon2",
      username: "AiSummon",
      controllerId: "player2",
      isSummon: true,
      isPiloted: false,
      curHealth: 50,
      curChakra: 0,
      curStamina: 0,
      longitude: 1,
      latitude: 1,
    });

    const enemy = mkUser({
      userId: "enemy2",
      username: "EnemyTwo",
      controllerId: "enemy2",
      isAi: false,
      longitude: 3,
      latitude: 3,
    });

    const battle = makeBattle([aiSummon, enemy]);
    const { nextBattle } = performAIaction(battle, grid, "summon2");
    const after = nextBattle.usersState.find((u) => u.userId === "summon2");
    // Non-piloted AI with no affordable action self-kills (existing behavior preserved)
    expect(after?.curHealth).toBe(0);
  });
});
