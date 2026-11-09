import { describe, expect, it } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import type { AiProfile } from "@/drizzle/schema";
import { availableUserActions, performBattleAction } from "@/libs/combat/actions";
import { performAIaction } from "@/libs/combat/ai_v2";
import { mergeLoadoutParticipants } from "@/libs/combat/summon";
import type {
  CombatQueryUser,
  CompleteBattle,
  ExtraState,
} from "@/libs/combat/types";
import { mergeExtraState } from "@/libs/combat/util";
import { TerrainHex } from "@/libs/hexgrid";
import type { DrizzleClient } from "@/server/db";
import { AiRule } from "@/validators/ai";
import { flatCombatStats } from "../../setup/combat";
import { makeCombatQueryUser, preloadBattle } from "./helpers/preload";

/**
 * updateCombatLoadout reprocesses a player whose loadout is swapped in from the
 * battle lobby, which loads every summon template that loadout can cast (here Tor
 * Tor and its nested Reptile King from "Summoning: Reptile Zoo"). The merge must
 * carry the templates' aiProfiles into the battle alongside their jutsus, items,
 * reskins, enemy skills and sage modes: without them getAiProfile returns
 * undefined, no rule (not even end turn) runs, and the AI fallback kills the
 * summon on the round it is summoned.
 */

const ZOO = "iWoiCf6NcredongvK-pJs";
const KING_SUMMON = "VnLuKCX1hXm1Hqf0k__XB";
const SHELL = "1Jtd6To2iyRK4ODNlhCHO";
const SWORD = "1BDtmLoEhwf78FbzAjwFW";
const TOR_AI = "y07BRyFf73zFzoEJIWwNY";
const KING_AI = "Bq8WA_8nIM_SYGnOblCDs";
const WIDTH = 12;
const HEIGHT = 10;

const jutsu = (id: string, over: Record<string, unknown>) => ({
  id, name: id, image: "", description: "", battleDescription: `%user uses ${id}`,
  jutsuType: "AI", jutsuRank: "D", requiredRank: "STUDENT", requiredLevel: 1,
  target: "OTHER_USER", range: 5, method: "SINGLE", cooldown: 0,
  actionCostPerc: 40, staminaCost: 0, chakraCost: 0, healthCost: 0,
  staminaCostReducePerLvl: 0, chakraCostReducePerLvl: 0, healthCostReducePerLvl: 0,
  extraBaseCost: 0, jutsuWeapon: "NONE", bloodlineId: "", villageId: "",
  hidden: false, injectableInBattle: false, battleUsageType: "BOTH",
  elementClassification: "None", requiredSkillId: null,
  ...over,
});

const summonTag = (aiId: string, aiHp: number, rounds: number) => ({
  type: "summon", aiId, aiHp, power: 50, rounds, powerPerLevel: 0,
  calculation: "percentage", target: "INHERIT", friendlyFire: "FRIENDLY",
  description: "summon", direction: "offence",
});

const zoo = jutsu(ZOO, {
  target: "EMPTY_GROUND", range: 2, jutsuType: "NORMAL", battleUsageType: "PVP",
  effects: [
    summonTag(TOR_AI, 3000, 3),
    { type: "injectjutsus", power: 100, rounds: 2, target: "SELF", jutsuIds: [KING_SUMMON],
      powerPerLevel: 0, calculation: "static", friendlyFire: "ALL",
      description: "inject", direction: "offence" },
  ],
});
const kingSummon = jutsu(KING_SUMMON, {
  target: "EMPTY_GROUND", range: 2, jutsuType: "SPECIAL", battleUsageType: "PVP",
  injectableInBattle: true, effects: [summonTag(KING_AI, 2000, 4)],
});
const shell = jutsu(SHELL, {
  target: "ALLY", method: "ALL", actionCostPerc: 60, cooldown: 6,
  effects: [{ type: "decreasedamagetaken", power: 20, powerPerLevel: 0, rounds: 2,
    calculation: "percentage", target: "INHERIT", friendlyFire: "ALL",
    statTypes: ["Ninjutsu"], description: "shell", direction: "offence" }],
});
const sword = jutsu(SWORD, {
  effects: [{ type: "damage", power: 45, powerPerLevel: 0, calculation: "formula",
    statTypes: ["Highest"], generalTypes: ["Highest"], elements: [], rounds: 0,
    target: "INHERIT", friendlyFire: "ENEMIES", description: "dmg", direction: "offence" }],
});

const rule = (r: unknown) => AiRule.parse(r);
const torProfile = {
  id: "profile-tor", userId: TOR_AI, includeDefaultRules: true,
  rules: [rule({ conditions: [],
    action: { type: "use_combo_action", target: "CLOSEST_ALLY", comboIds: [SHELL] } })],
} as unknown as AiProfile;
const kingProfile = {
  id: "profile-king", userId: KING_AI, includeDefaultRules: true,
  rules: [rule({ conditions: [{ type: "distance_lower_than", value: 5, target: "RANDOM_OPPONENT" }],
    action: { type: "use_specific_jutsu", target: "RANDOM_OPPONENT", jutsuId: SWORD } })],
} as unknown as AiProfile;
const defaultProfile = { id: "Default", rules: [], includeDefaultRules: true } as unknown as AiProfile;

const userJutsu = (owner: string, j: ReturnType<typeof jutsu>) => ({
  id: `${owner}-${j.id}`, userId: owner, jutsuId: j.id, level: 1, experience: 0,
  equipped: true, jutsu: j,
});

const queryUser = (id: string, over: Record<string, unknown> = {}): CombatQueryUser =>
  makeCombatQueryUser(id, {
    ...flatCombatStats(100), villageId: "village", rank: "JONIN", isAi: false, isSummon: false,
    bloodlineId: null, longitude: 0, latitude: 0,
    ...over,
  });

const torTemplate = queryUser(TOR_AI, {
  username: "Tor Tor", isAi: true, level: 30, aiProfileId: torProfile.id, aiProfile: torProfile,
  jutsus: [userJutsu(TOR_AI, shell), userJutsu(TOR_AI, kingSummon)],
});
const kingTemplate = queryUser(KING_AI, {
  username: "Reptile King", isAi: true, isSummon: true, level: 75,
  aiProfileId: kingProfile.id, aiProfile: kingProfile, jutsus: [userJutsu(KING_AI, sword)],
});

/** Serves the summon template lookups processUsersForBattle issues, in call order. */
const templateClient = () => {
  const queue = [[torTemplate], [kingTemplate]];
  return {
    query: { userData: { findMany: async () => queue.shift() ?? [] } },
  } as unknown as DrizzleClient;
};

const process = (client: DrizzleClient, users: CombatQueryUser[], left?: string[]) =>
  preloadBattle(users, {
    client, defaultProfile, width: WIDTH, height: HEIGHT, leftSideUserIds: left,
  });

/**
 * Initiate a PvP battle with no summon jutsu equipped, then swap in a loadout
 * holding Reptile Zoo, merging the reprocessed player exactly like
 * updateCombatLoadout does.
 */
const battleAfterLoadoutSwap = async () => {
  const thabiento = queryUser("user_thab");
  const luka = queryUser("user_luka");
  const init = await process(templateClient(), [luka, thabiento], ["user_luka"]);
  expect(init.extraState.aiProfiles[torProfile.id]).toBeUndefined();
  const battle = {
    id: "b1", battleType: "COMBAT", round: 1, version: 1, activeUserId: "user_thab",
    createdAt: new Date(0), updatedAt: new Date(0), roundStartAt: new Date(),
    background: "", width: WIDTH, height: HEIGHT, rewardScaling: 1, forceKeepPools: false,
    usersState: init.usersState, usersEffects: init.userEffects, groundEffects: [],
    extraState: init.extraState,
  } as unknown as CompleteBattle;

  // Loadout swap: reprocess only the swapping player with Reptile Zoo equipped.
  const swapped = await process(templateClient(), [
    queryUser("user_thab", { jutsus: [userJutsu("user_thab", zoo)] }),
  ]);
  const otherUserState = battle.usersState.filter((u) => u.controllerId !== "user_thab");
  const original = battle.usersState.find((u) => u.userId === "user_thab");
  if (swapped.usersState[0] && original) {
    swapped.usersState[0].direction = original.direction;
  }
  const added = mergeLoadoutParticipants(otherUserState, swapped.usersState);
  battle.usersState = [...otherUserState, ...added];
  battle.usersEffects = [...battle.usersEffects, ...swapped.userEffects];
  mergeExtraState(battle.extraState, swapped.extraState);
  return { battle, swapped };
};

const place = (battle: CompleteBattle, userId: string, longitude: number, latitude: number) => {
  const user = battle.usersState.find((u) => u.userId === userId);
  if (!user) throw new Error(`missing ${userId}`);
  user.longitude = longitude;
  user.latitude = latitude;
};

describe("summons from a loadout swapped in mid-lobby", () => {
  it("carries the summon templates' AI profiles into the battle", async () => {
    const { battle } = await battleAfterLoadoutSwap();
    expect(battle.extraState.aiProfiles[torProfile.id]).toBeDefined();
    expect(battle.extraState.aiProfiles[kingProfile.id]).toBeDefined();
    const templates = battle.usersState.filter((u) => u.isSummonTemplate);
    expect(templates.map((t) => t.controllerId).sort()).toEqual([KING_AI, TOR_AI].sort());
  });

  it("does not duplicate templates the battle already holds on a second swap", async () => {
    const { battle } = await battleAfterLoadoutSwap();
    const again = await process(templateClient(), [
      queryUser("user_thab", { jutsus: [userJutsu("user_thab", zoo)] }),
    ]);
    const others = battle.usersState.filter((u) => u.controllerId !== "user_thab");
    const added = mergeLoadoutParticipants(others, again.usersState);
    expect(added.map((u) => u.userId)).toEqual([again.usersState[0]!.userId]);
  });

  it("lets Tor Tor and Reptile King act on their first turn", async () => {
    const { battle: initial } = await battleAfterLoadoutSwap();
    let battle = initial;
    const grid = new Grid(TerrainHex, rectangle({ width: WIDTH, height: HEIGHT }));
    place(battle, "user_thab", 6, 5);
    place(battle, "user_luka", 3, 5);
    const cast = (actionId: string, longitude: number, latitude: number) => {
      const action = availableUserActions(battle, "user_thab", true, true).find(
        (a) => a.id === actionId,
      );
      if (!action) throw new Error(`missing ${actionId}`);
      battle = performBattleAction({
        battle, action, grid, actorId: "user_thab",
        longitude, latitude,
      }).newBattle;
    };
    cast(ZOO, 5, 5);
    cast(KING_SUMMON, 5, 4);

    const summons = battle.usersState.filter((u) => u.isSummon && !u.isSummonTemplate);
    expect(summons.map((s) => s.username).sort()).toEqual(["Reptile King", "Tor Tor"]);
    for (const summon of summons) {
      const result = performAIaction(battle, grid, summon.userId);
      battle = result.nextBattle;
      expect(result.aiDescriptions.join(" ")).not.toMatch(/give up|hesitates/);
      expect(result.nextActionId).toBeDefined();
      const after = battle.usersState.find((u) => u.userId === summon.userId);
      expect(after?.curHealth).toBeGreaterThan(0);
    }
  });
});

describe("mergeExtraState", () => {
  it("copies every static lookup map and initializes missing ones", () => {
    const target = { jutsus: { a: { id: "a" } } } as unknown as Partial<ExtraState>;
    const source = {
      jutsus: { b: { id: "b" } }, jutsuReskins: { r: {} }, items: { i: {} },
      bloodlines: { bl: {} }, enemySkills: { s: [] }, sageModes: { sm: {} },
      villages: { v: {} }, anbuSquads: { an: {} }, keystoneItems: { k: {} },
      wars: { w: {} }, aiProfiles: { p: {} }, relations: { rel: {} }, clans: { c: {} },
      questData: { u: [] },
    } as unknown as Partial<ExtraState>;
    mergeExtraState(target, source);
    expect(Object.keys(target.jutsus ?? {}).sort()).toEqual(["a", "b"]);
    for (const key of [
      "jutsuReskins", "items", "bloodlines", "enemySkills", "sageModes", "villages",
      "anbuSquads", "keystoneItems", "wars", "aiProfiles", "relations", "clans",
    ] as const) {
      expect(Object.keys(target[key] ?? {})).toHaveLength(1);
    }
    // Per-user data is not a static lookup map and stays untouched.
    expect(target.questData).toBeUndefined();
  });

  it("is a no-op for a missing source", () => {
    const target = { aiProfiles: {} } as unknown as Partial<ExtraState>;
    expect(mergeExtraState(target, undefined)).toEqual({ aiProfiles: {} } as never);
  });
});
