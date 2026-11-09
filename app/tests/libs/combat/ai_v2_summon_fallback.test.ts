import { describe, expect, it } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import { performAIaction } from "@/libs/combat/ai_v2";
import type { BattleUserState, CompleteBattle, ExtraState } from "@/libs/combat/types";
import { TerrainHex } from "@/libs/hexgrid";
import { ActionEndTurn, AiRule } from "@/validators/ai";
import { makeEffect } from "../../setup/combat";
import { makeAiBattle, makeAiUser } from "./helpers/aiScenario";

/**
 * Safety nets for summons whose AI cannot pick an action. A summon is the
 * player's resource: it must never be killed by the "exhausted" fallback that
 * ends stuck AI opponents.
 */

const WIDTH = 10;
const HEIGHT = 8;

const mkUser = (over: Partial<BattleUserState>): BattleUserState =>
  makeAiUser({
    isAi: false,
    villageId: "v",
    direction: "left",
    rank: "JONIN",
    longitude: 0,
    latitude: 0,
    originalLongitude: 0,
    originalLatitude: 0,
    level: 60,
    originalLevel: 60,
    ...over,
  });

const mkBattle = (
  summon: Partial<BattleUserState>,
  aiProfiles: Record<string, unknown>,
): CompleteBattle =>
  makeAiBattle({
    battleType: "COMBAT",
    activeUserId: "summon",
    roundStartAt: new Date(),
    width: WIDTH,
    height: HEIGHT,
    usersState: [
      mkUser({
        userId: "user_owner",
        username: "Owner",
        controllerId: "user_owner",
        longitude: 4,
        latitude: 3,
      }),
      mkUser({
        userId: "user_foe",
        username: "Foe",
        controllerId: "user_foe",
        direction: "right",
        longitude: 8,
        latitude: 3,
      }),
      mkUser({
        userId: "summon",
        username: "Tor Tor",
        controllerId: "user_owner",
        isAi: true,
        isSummon: true,
        longitude: 5,
        latitude: 3,
        ...summon,
      }),
    ],
    extraState: { aiProfiles: aiProfiles as ExtraState["aiProfiles"] },
  });

const defaultProfile = {
  id: "Default",
  name: "Default",
  includeDefaultRules: true,
  rules: [AiRule.parse({ conditions: [], action: ActionEndTurn.parse({}) })],
};

describe("performAIaction for a summon", () => {
  it("falls back to the Default profile when its own profile is missing", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: WIDTH, height: HEIGHT }));
    const battle = mkBattle(
      { aiProfileId: "missing-profile" },
      { Default: defaultProfile },
    );
    const { nextBattle, aiDescriptions, nextActionId } = performAIaction(
      battle,
      grid,
      "summon",
    );
    expect(nextActionId).toBeDefined();
    expect(aiDescriptions.join(" ")).not.toMatch(/give up|hesitates/);
    const summon = nextBattle.usersState.find((u) => u.userId === "summon");
    expect(summon?.curHealth).toBe(5000);
  });

  it("ends its turn instead of dying when no action is possible", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: WIDTH, height: HEIGHT }));
    // No profile at all and no Default either: nothing can be chosen.
    const battle = mkBattle({ aiProfileId: "missing-profile" }, {});
    const { nextBattle, aiDescriptions, nextActionId } = performAIaction(
      battle,
      grid,
      "summon",
    );
    expect(nextActionId).toBeUndefined();
    expect(aiDescriptions).toEqual(["Tor Tor hesitates and ends its turn"]);
    const summon = nextBattle.usersState.find((u) => u.userId === "summon");
    expect(summon?.curHealth).toBe(5000);
    expect(summon?.actionPoints).toBe(0);
  });

  it("still lets a stuck non-summon AI give up", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: WIDTH, height: HEIGHT }));
    const battle = mkBattle({ isSummon: false, aiProfileId: "missing-profile" }, {});
    const { nextBattle, aiDescriptions } = performAIaction(battle, grid, "summon");
    expect(aiDescriptions).toEqual(["Tor Tor is exhausted and has to give up"]);
    expect(nextBattle.usersState.find((u) => u.userId === "summon")?.curHealth).toBe(0);
  });

  it("makes a stuck raid boss end its turn instead of zeroing its shared HP", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: WIDTH, height: HEIGHT }));
    const battle = {
      ...mkBattle({ isSummon: false, aiProfileId: "missing-profile" }, {}),
      battleType: "RAID",
    } as CompleteBattle;
    const { nextBattle, aiDescriptions } = performAIaction(battle, grid, "summon");
    expect(aiDescriptions).toEqual(["Tor Tor hesitates and ends its turn"]);
    const boss = nextBattle.usersState.find((u) => u.userId === "summon");
    expect(boss?.curHealth).toBe(5000);
    expect(boss?.actionPoints).toBe(0);
  });

  it("still ticks damage over time on a stuck raid boss", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: WIDTH, height: HEIGHT }));
    const dot = makeEffect(
      "damage",
      { power: 100, calculation: "static", rounds: 3 },
      {
        id: "dot",
        creatorId: "user_foe",
        targetId: "summon",
        targetType: "user",
        isNew: false,
        createdRound: 0,
        timeTracker: {},
        fromType: "jutsu",
      },
    );
    const battle = {
      ...mkBattle({ isSummon: false, aiProfileId: "missing-profile" }, {}),
      battleType: "RAID",
    } as CompleteBattle;
    battle.usersEffects = [dot];
    const { nextBattle, aiDescriptions } = performAIaction(battle, grid, "summon");
    expect(aiDescriptions).toEqual(["Tor Tor hesitates and ends its turn"]);
    const boss = nextBattle.usersState.find((u) => u.userId === "summon");
    expect(boss?.curHealth).toBeLessThan(5000);
    expect(boss?.curHealth).toBeGreaterThan(0);
    expect(boss?.actionPoints).toBe(0);
  });
});
