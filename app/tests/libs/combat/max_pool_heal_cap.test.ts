import { describe, expect, it } from "bun:test";
import { applyEffects } from "@/libs/combat/process";
import type {
  BattleUserState,
  CombatAction,
  CompleteBattle,
  UserEffect,
} from "@/libs/combat/types";
import { applyPoolAdjustmentsToBase, getEffectiveMaxPool } from "@/libs/combat/util";
import type { PoolType } from "@/drizzle/constants";
import { makeBattleUser, makeDamageEffect, makeEffect } from "./helpers/battleScenario";

/**
 * Equipment with `increasemaxpools` raises a combatant's maximum pools for the
 * battle. Healing, absorb, lifesteal, vamp and poison must cap the current pools
 * at that effective maximum, not at the base maximum stored on the user; otherwise
 * the first heal of the fight silently strips the bonus (e.g. 6250/6250 HP with a
 * +1200 armor bonus dropping to 5050 on the first absorb tick).
 */

const ROUND = 2;
const BASE_MAX = 5050;
const BONUS = 1200;

const makeAction = (): CombatAction => ({ chakraCost: 0, staminaCost: 0 }) as CombatAction;

const makeBattle = (
  usersState: BattleUserState[],
  usersEffects: UserEffect[],
): CompleteBattle =>
  ({
    battleType: "COMBAT",
    round: ROUND,
    usersState,
    usersEffects,
    groundEffects: [],
    extraState: {},
  }) as unknown as CompleteBattle;

/** Armor-granted pool bonus, realized the way battle initiation realizes gear tags. */
const makeArmorPoolBonus = (
  userId: string,
  pools: PoolType[] = ["Health", "Chakra", "Stamina"],
): UserEffect =>
  makeEffect(
    "increasemaxpools",
    { power: BONUS, calculation: "static", rounds: 20, poolsAffected: pools },
    {
      id: `armor-pools-${userId}`,
      creatorId: userId,
      targetId: userId,
      fromType: "armor",
      isNew: false,
      castThisRound: false,
      createdRound: 0,
      targetType: "user",
    },
  );

/**
 * A user that entered battle at full base pools while wearing the armor: the
 * battle-start pass lifts current pools to base + bonus.
 */
const makeArmoredUser = (
  id: string,
  armor: UserEffect,
  overrides: Partial<BattleUserState> = {},
) => {
  const user = makeBattleUser(id, {
    curHealth: BASE_MAX,
    maxHealth: BASE_MAX,
    curChakra: BASE_MAX,
    maxChakra: BASE_MAX,
    curStamina: BASE_MAX,
    maxStamina: BASE_MAX,
    ...overrides,
  });
  applyPoolAdjustmentsToBase(user, [armor]);
  return user;
};

const makeAttack = (creatorId: string, targetId: string, power = 1): UserEffect =>
  makeDamageEffect({
    id: `damage-${creatorId}-${targetId}`,
    creatorId,
    targetId,
    isNew: true,
    castThisRound: true,
    createdRound: ROUND,
    rounds: 0,
    targetType: "user",
    calculation: "static",
    power,
  } as Partial<UserEffect>);

/** Static heal; static heal power is applied as `power * 10` pool points. */
const makeHeal = (userId: string, pools: PoolType[], power: number): UserEffect =>
  makeEffect(
    "heal",
    { power, calculation: "static", poolsAffected: pools },
    {
      id: `heal-${userId}`,
      creatorId: userId,
      targetId: userId,
      isNew: true,
      castThisRound: true,
      createdRound: ROUND,
      rounds: 0,
      targetType: "user",
    },
  );

const findUser = (battle: CompleteBattle, userId: string) => {
  const user = battle.usersState.find((u) => u.userId === userId);
  if (!user) throw new Error(`missing ${userId}`);
  return user;
};

describe("armor pool bonus survives in-battle healing", () => {
  it("lifts current pools above the base max at battle start", () => {
    const armor = makeArmorPoolBonus("player");
    const user = makeArmoredUser("player", armor);
    expect(user.curHealth).toBe(BASE_MAX + BONUS);
    expect(getEffectiveMaxPool(user, [armor], "Health")).toBe(BASE_MAX + BONUS);
  });

  it("caps a heal at the effective max instead of the base max", () => {
    const armor = makeArmorPoolBonus("player");
    const player = makeArmoredUser("player", armor);
    player.curHealth = BASE_MAX + BONUS - 300;
    player.curChakra = BASE_MAX + BONUS - 300;
    player.curStamina = BASE_MAX + BONUS - 300;
    const enemy = makeBattleUser("enemy");
    const battle = makeBattle(
      [player, enemy],
      [armor, makeHeal("player", ["Health", "Chakra", "Stamina"], 10)],
    );

    const { newBattle } = applyEffects(battle, "player", makeAction());
    const after = findUser(newBattle, "player");

    expect(after.curHealth).toBe(BASE_MAX + BONUS - 200);
    expect(after.curChakra).toBe(BASE_MAX + BONUS - 200);
    expect(after.curStamina).toBe(BASE_MAX + BONUS - 200);
  });

  it("never heals past the effective max", () => {
    const armor = makeArmorPoolBonus("player");
    const player = makeArmoredUser("player", armor);
    player.curHealth = BASE_MAX + BONUS - 50;
    const enemy = makeBattleUser("enemy");
    const battle = makeBattle([player, enemy], [armor, makeHeal("player", ["Health"], 50)]);

    const { newBattle } = applyEffects(battle, "player", makeAction());

    expect(findUser(newBattle, "player").curHealth).toBe(BASE_MAX + BONUS);
  });

  it("keeps the bonus when absorb converts an incoming hit to health", () => {
    const armor = makeArmorPoolBonus("player");
    const player = makeArmoredUser("player", armor);
    const enemy = makeBattleUser("enemy");
    const absorb = makeEffect(
      "absorb",
      { power: 40, calculation: "percentage", rounds: 10, poolsAffected: ["Health"] },
      {
        id: "absorb-player",
        creatorId: "player",
        targetId: "player",
        isNew: false,
        castThisRound: false,
        createdRound: 0,
        targetType: "user",
      },
    );
    const battle = makeBattle(
      [player, enemy],
      [armor, absorb, makeAttack("enemy", "player", 10)],
    );

    const { newBattle } = applyEffects(battle, "enemy", makeAction());
    const after = findUser(newBattle, "player");

    // The hit plus partial absorb leaves the player below full, but far above the base max
    expect(after.curHealth).toBeGreaterThan(BASE_MAX);
    expect(after.curHealth).toBeLessThanOrEqual(BASE_MAX + BONUS);
  });

  it("does not drop the bonus across subsequent rounds without healing", () => {
    const armor = makeArmorPoolBonus("player");
    const player = makeArmoredUser("player", armor);
    const enemy = makeBattleUser("enemy");
    let battle = makeBattle([player, enemy], [armor]);

    for (let i = 0; i < 3; i++) {
      battle = applyEffects(battle, "player", makeAction()).newBattle;
      battle.round += 1;
    }

    const after = findUser(battle, "player");
    expect(after.curHealth).toBe(BASE_MAX + BONUS);
    expect(after.curChakra).toBe(BASE_MAX + BONUS);
    expect(after.curStamina).toBe(BASE_MAX + BONUS);
  });
});
