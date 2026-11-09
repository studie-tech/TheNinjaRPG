import { makeAiBattle, makeAiUser as mkUser } from "./helpers/aiScenario";
import { makeJutsu, makeTag } from "../../setup/combat";
import { describe, it, expect } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import { performAIaction } from "@/libs/combat/ai_v2";
import { ActionEndTurn, ActionUseSpecificJutsu } from "@/validators/ai";
import type { BattleUserState, CompleteBattle, ExtraState } from "@/libs/combat/types";
import { maskBattle } from "@/libs/combat/masking";

/**
 * Integration cover for auto combat at the ai_v2 CALL SITE: a human with
 * isAutoCombat=true (isAi stays false) must be picked up by performAIaction and
 * driven by their AI profile, while a plain human must remain untouched. Also
 * pins that the give-up path (curHealth = 0 when no rule matches) never fires
 * for auto-combat humans — they wait out the turn instead of dying.
 */

import { TerrainHex } from "@/libs/hexgrid";

const DAMAGE_JUTSU = "j-damage";
const PROFILE = "profile-1";

const damageJutsu = makeJutsu({
  id: DAMAGE_JUTSU,
  name: "Test Strike",
  battleDescription: "%user strikes %target",
  range: 5,
  staminaCost: 10,
  effects: [makeTag("damage", {
    power: 20, powerPerLevel: 0,
    calculation: "formula", statTypes: ["Ninjutsu"], generalTypes: [], elements: [],
    rounds: 0, target: "INHERIT", friendlyFire: "ENEMIES", description: "dmg",
  })],
});

const mkBattle = (human: BattleUserState): CompleteBattle =>
  makeAiBattle({
    battleType: "ARENA", activeUserId: human.userId, width: 10, height: 10,
    usersState: [
      human,
      mkUser({ userId: "foe", username: "Foe", controllerId: "foe",
        longitude: 3, latitude: 3 }),
    ],
    extraState: {
      jutsus: { [DAMAGE_JUTSU]: damageJutsu },
      aiProfiles: {
        [PROFILE]: {
          id: PROFILE, name: "always strike", includeDefaultRules: false,
          rules: [{
            conditions: [],
            action: ActionUseSpecificJutsu.parse({
              jutsuId: DAMAGE_JUTSU,
              target: "CLOSEST_OPPONENT",
            }),
          }],
        },
      } as unknown as ExtraState["aiProfiles"],
    },
  });

const mkHuman = (over: Partial<BattleUserState> = {}): BattleUserState =>
  mkUser({
    userId: "user_h1", username: "Human", controllerId: "user_h1",
    isAi: false, direction: "left", aiProfileId: PROFILE, longitude: 2, latitude: 2,
    jutsus: [{ id: "uj1", jutsuId: DAMAGE_JUTSU, level: 1, experience: 0,
               equipped: true, lastUsedRound: -99, originalCooldown: 0 }],
    ...over,
  });

describe("performAIaction auto combat", () => {
  it("drives a human on auto combat with their own AI profile", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
    const human = mkHuman({ isAutoCombat: true });
    const { nextActionId } = performAIaction(mkBattle(human), grid, "user_h1");
    expect(nextActionId).toBe(DAMAGE_JUTSU);
  });

  it("keeps a rejected auto-combat jutsu private when the next rule ends the turn", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
    const battle = structuredClone(
      mkBattle(mkHuman({ isAutoCombat: true, direction: "left" })),
    );
    battle.extraState.jutsus[DAMAGE_JUTSU]!.range = 1;
    Object.assign(battle.usersState[1]!, { longitude: 7, latitude: 2 });
    battle.extraState.aiProfiles[PROFILE]!.rules.push({
      conditions: [], action: ActionEndTurn.parse({}),
    });

    const { nextBattle, nextActionId, aiDescriptions } = performAIaction(
      battle,
      grid,
      "user_h1",
    );
    expect(nextActionId).toBe("wait");
    expect(aiDescriptions.map((description) => description.trim())).toEqual([
      "End Turn: Human stands and does nothing",
    ]);
    expect(nextBattle.extraState.revealedActions).toBeUndefined();
    for (const viewer of ["foe", "spectator"]) {
      expect(maskBattle(nextBattle, viewer).extraState.jutsus).not.toHaveProperty(DAMAGE_JUTSU);
    }
    const actor = nextBattle.usersState.find((u) => u.userId === "user_h1")!;
    expect(actor.usedActions).toEqual([{ id: "wait", type: "basic" }]);
    expect(actor.jutsus[0]?.lastUsedRound).toBe(-99);
    expect(actor.curStamina).toBe(5000);
    expect(maskBattle(nextBattle, "user_h1").extraState.jutsus).toHaveProperty(
      DAMAGE_JUTSU,
    );
  });

  it("reveals a successful auto-combat cast while preserving its usage and cooldown", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
    const battle = structuredClone(
      mkBattle(mkHuman({ isAutoCombat: true, direction: "left" })),
    );
    battle.extraState.jutsus[DAMAGE_JUTSU]!.statClassification = "Ninjutsu";

    const { nextBattle, nextActionId } = performAIaction(battle, grid, "user_h1");
    expect(nextActionId).toBe(DAMAGE_JUTSU);
    expect(nextBattle.extraState.revealedActions).toEqual({
      jutsuIds: [DAMAGE_JUTSU], itemIds: [],
    });
    const actor = nextBattle.usersState.find((u) => u.userId === "user_h1")!;
    expect(actor.usedActions).toEqual([{
      id: DAMAGE_JUTSU, type: "jutsu", masteryTypes: ["Ninjutsu"],
    }]);
    expect(actor.usedMasteries).toEqual({ ninjutsuMastery: 1 });
    expect(actor.jutsus[0]?.lastUsedRound).toBe(nextBattle.round);
    expect(actor.curStamina).toBeLessThan(5000);
    for (const viewer of ["foe", "spectator"]) {
      expect(maskBattle(nextBattle, viewer).extraState.jutsus).toHaveProperty(DAMAGE_JUTSU);
    }
  });

  it("leaves a plain human untouched (call-site filter)", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
    const human = mkHuman();
    const { nextBattle, nextActionId } = performAIaction(
      mkBattle(human),
      grid,
      "user_h1",
    );
    const after = nextBattle.usersState.find((u) => u.userId === "user_h1");
    expect(nextActionId).toBeUndefined();
    expect(after?.curHealth).toBe(5000);
  });

  it("meditates back to fighting shape when attacks are unaffordable", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
    // Out of stamina, so attacks are unaffordable.
    const human = mkHuman({ isAutoCombat: true, curStamina: 0, curHealth: 5000 });
    const { nextActionId } = performAIaction(mkBattle(human), grid, "user_h1");
    expect(nextActionId).toBe("meditate");
  });

  it("recovers an exhausted Student rather than idling indefinitely", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
    const human = mkHuman({
      isAutoCombat: true,
      rank: "STUDENT",
      curChakra: 0,
      curStamina: 0,
    });
    const { nextBattle, nextActionId } = performAIaction(mkBattle(human), grid, "user_h1");
    const after = nextBattle.usersState.find((u) => u.userId === "user_h1");
    expect(nextActionId).toBe("meditate");
    expect(after?.curChakra).toBeGreaterThan(0);
    expect(after?.curStamina).toBeGreaterThan(0);
  });

  it("survives a turn taken after the last opponent has died", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
    const human = mkHuman({ isAutoCombat: true });
    const battle = mkBattle(human);
    const foe = battle.usersState.find((u) => u.userId === "foe");
    if (foe) foe.curHealth = 0;
    // The caller settles a decided battle on this same tick, but it asks for the
    // turn first, so an empty enemy list must not throw: the endpoint would turn
    // the throw into a notification the client retries forever.
    const { nextBattle } = performAIaction(battle, grid, "user_h1");
    const after = nextBattle.usersState.find((u) => u.userId === "user_h1");
    expect(after?.curHealth).toBe(5000);
  });

  it("does NOT self-kill an auto-combat human whose rules produce no action", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
    // No jutsu, empty pools, no profile on the battle -> no rule can match
    const human = mkHuman({
      isAutoCombat: true,
      jutsus: [],
      curChakra: 0, curStamina: 0, curHealth: 50,
      aiProfileId: "missing-profile",
    });
    const { nextBattle } = performAIaction(mkBattle(human), grid, "user_h1");
    const after = nextBattle.usersState.find((u) => u.userId === "user_h1");
    expect(after?.curHealth).toBe(50);
  });
});
