import { describe, it, expect, vi } from "vitest";
import { Grid, rectangle } from "honeycomb-grid";
import { performAIaction } from "@/libs/combat/ai_v2";
import { ActionUseSpecificJutsu } from "@/validators/ai";
import type { BattleUserState, CompleteBattle } from "@/libs/combat/types";

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

const mkUser = (over: Partial<BattleUserState>): BattleUserState =>
  ({
    userId: "x", username: "x", controllerId: "x",
    isAi: true, isSummon: false, isPiloted: false,
    curHealth: 5000, maxHealth: 5000, curChakra: 5000, maxChakra: 5000,
    curStamina: 5000, maxStamina: 5000,
    fledBattle: false, leftBattle: false, longitude: 1, latitude: 1,
    actionPoints: 100, effects: [], jutsus: [], items: [], basicActions: [],
    round: 0, direction: "right", isAggressor: false,
    highestOffence: "ninjutsuOffence", highestDefence: "ninjutsuDefence",
    highestGenerals: [], iAmHere: true, level: 10,
    originalLevel: 10, originalMoney: 0, originalLongitude: 1, originalLatitude: 1,
    isOriginal: true, usedGenerals: {}, usedStats: {}, moneyStolen: 0,
    allyVillage: false, usedActions: [], initiative: 0,
    relationIds: [], warIds: [],
    ninjutsuOffence: 100, ninjutsuDefence: 100, genjutsuOffence: 100,
    genjutsuDefence: 100, taijutsuOffence: 100, taijutsuDefence: 100,
    bukijutsuOffence: 100, bukijutsuDefence: 100,
    strength: 100, intelligence: 100, willpower: 100, speed: 100,
    ...over,
  }) as unknown as BattleUserState;

const damageJutsu = {
  id: DAMAGE_JUTSU,
  name: "Test Strike",
  image: "", description: "", battleDescription: "%user strikes %target",
  jutsuType: "NORMAL", jutsuRank: "D", requiredRank: "STUDENT", requiredLevel: 1,
  target: "OTHER_USER", range: 5, method: "SINGLE", cooldown: 0,
  actionCostPerc: 40, staminaCost: 10, chakraCost: 0, healthCost: 0,
  staminaCostReducePerLvl: 0, chakraCostReducePerLvl: 0, healthCostReducePerLvl: 0,
  extraBaseCost: 0, jutsuWeapon: "NONE", bloodlineId: null, villageId: null,
  hidden: false, injectableInBattle: false, battleUsageType: "BOTH",
  effects: [{
    type: "damage", power: 20, powerPerLevel: 0, level: 1,
    calculation: "formula", statTypes: ["Ninjutsu"], generalTypes: [], elements: [],
    rounds: 0, target: "INHERIT", friendlyFire: "ENEMIES", description: "dmg",
  }],
};

const mkBattle = (human: BattleUserState): CompleteBattle =>
  ({
    id: "b1", battleType: "ARENA", round: 1, version: 1, activeUserId: human.userId,
    createdAt: new Date(0), updatedAt: new Date(0), roundStartAt: new Date(0),
    background: "", width: 10, height: 10, rewardScaling: 1, forceKeepPools: false,
    usersState: [
      human,
      mkUser({ userId: "foe", username: "Foe", controllerId: "foe",
        longitude: 3, latitude: 3 }),
    ],
    usersEffects: [], groundEffects: [],
    extraState: {
      jutsus: { [DAMAGE_JUTSU]: damageJutsu },
      jutsuReskins: {}, items: {}, bloodlines: {}, villages: {}, anbuSquads: {},
      keystoneItems: {}, wars: {}, relations: {}, clans: {},
      userQuests: {}, completedQuests: {}, questData: {}, bounties: {}, bountySignups: {},
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
      },
    },
  }) as unknown as CompleteBattle;

const mkHuman = (over: Partial<BattleUserState> = {}): BattleUserState =>
  mkUser({
    userId: "user_h1", username: "Human", controllerId: "user_h1",
    isAi: false, aiProfileId: PROFILE, longitude: 2, latitude: 2,
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
    // Out of stamina (attacks unaffordable) but enough chakra to meditate
    const human = mkHuman({ isAutoCombat: true, curStamina: 0, curHealth: 5000 });
    const { nextActionId } = performAIaction(mkBattle(human), grid, "user_h1");
    expect(nextActionId).toBe("meditate");
  });

  it("survives a turn taken after the last opponent has died", () => {
    const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 10 }));
    const human = mkHuman({ isAutoCombat: true });
    const battle = mkBattle(human);
    const foe = battle.usersState.find((u) => u.userId === "foe");
    if (foe) foe.curHealth = 0;
    // The caller settles a decided battle on this same tick, but it asks for the
    // turn first: reducing the empty enemy list used to throw here, and the
    // endpoint turned that into a notification the client retried forever.
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
