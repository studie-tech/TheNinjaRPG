import { describe, expect, it } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import { performAIaction } from "@/libs/combat/ai_v2";
import type { BattleUserState, CompleteBattle } from "@/libs/combat/types";
import { TerrainHex } from "@/libs/hexgrid";
import { makeAiBattle, makeAiUser } from "./helpers/aiScenario";

// The summons below have no jutsu/item and empty pools, so performAIaction reaches
// the no-action branch with the real hexgrid module and no pathfinding stub.

/** Summon-shaped AI with empty pools, so nothing is affordable. */
const mkUser = (over: Partial<BattleUserState>): BattleUserState =>
  makeAiUser({
    curHealth: 100,
    maxHealth: 100,
    curChakra: 0,
    maxChakra: 0,
    curStamina: 0,
    maxStamina: 0,
    originalLevel: 1,
    isOriginal: false,
    ...over,
  });

const makeBattle = (users: BattleUserState[]): CompleteBattle =>
  makeAiBattle({
    battleType: "COMBAT",
    activeUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    roundStartAt: new Date(),
    width: 5,
    height: 5,
    usersState: users,
    extraState: { aiProfiles: {} },
  });

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

  it("ends the turn of a non-piloted AI summon that has no affordable action", () => {
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
    // A summon is its owner's resource: with no affordable action it forfeits the
    // rest of its turn instead of self-killing like a stuck AI opponent.
    expect(after?.curHealth).toBe(50);
    expect(after?.actionPoints).toBe(0);
  });
});
