import { describe, expect, it } from "bun:test";

import { availableUserActions } from "@/libs/combat/actions";
import { applyEffects } from "@/libs/combat/process";
import {
  damageCalc,
  decreaseMastery,
  increaseMastery,
  increaseStats,
  updateStatUsage,
} from "@/libs/combat/tags";
import { dmgConfig } from "@/libs/combat/constants";
import type {
  BattleUserState,
  CompleteBattle,
  GroundEffect,
  UserEffect,
} from "@/libs/combat/types";
import { alignBattle, refreshMasteries } from "@/libs/combat/util";
import { effectiveMasteries } from "@/libs/mastery";
import type { ZodAllTags } from "@/validators/combat";
import {
  makeBattleUserItem,
  makeDamageEffect,
  makeEffect,
  makeUser,
} from "./helpers/battleScenario";

describe("increaseMastery", () => {
  it("raises the selected mastery without changing offence or defence", () => {
    const target = makeUser({
      userId: "user",
      ninjutsuMastery: 1000,
      offence: 2000,
      defence: 2000,
    });
    const effect = makeEffect(
      "increasemastery",
      {
        masteryTypes: ["Ninjutsu"],
        calculation: "static",
        power: 250,
        powerPerLevel: 0,
      },
      {
        isNew: false,
        castThisRound: false,
        targetId: "user",
      },
    );

    increaseMastery(effect, [], target);

    expect(target.ninjutsuMastery).toBe(1250);
    expect(target.offence).toBe(2000);
    expect(target.defence).toBe(2000);
  });
});

describe("decreaseMastery", () => {
  it("lowers the selected mastery without changing offence or defence", () => {
    const target = makeUser({
      userId: "user",
      ninjutsuMastery: 1000,
      offence: 2000,
      defence: 2000,
    });
    const effect = makeEffect(
      "decreasemastery",
      {
        masteryTypes: ["Ninjutsu"],
        calculation: "static",
        power: 250,
        powerPerLevel: 0,
      },
      {
        isNew: false,
        castThisRound: false,
        targetId: "user",
      },
    );

    decreaseMastery(effect, [], target);

    expect(target.ninjutsuMastery).toBe(750);
    expect(target.offence).toBe(2000);
    expect(target.defence).toBe(2000);
  });
});

describe("updateStatUsage", () => {
  it("credits both offence and defence when direction is both", () => {
    const user = makeUser({ userId: "user" });
    updateStatUsage(
      user,
      makeEffect("increasestat", {
        statTypes: ["Ninjutsu"],
        direction: "both",
      }),
    );
    expect(user.usedStats.offence).toBe(1);
    expect(user.usedStats.defence).toBe(1);
  });
});

describe("increaseStats", () => {
  it("reports the unified combat stats it changed, not the jutsu types listed", () => {
    const target = makeUser({ userId: "user", username: "Naruto", offence: 1000 });
    const effect = makeEffect(
      "increasestat",
      {
        statTypes: ["Ninjutsu"],
        direction: "offence",
        calculation: "static",
        power: 250,
        powerPerLevel: 0,
        rounds: 5,
      },
      { targetId: "user", isNew: true, castThisRound: false },
    );

    const info = increaseStats(effect, [], target);

    expect(info?.txt).toContain("Offence");
    expect(info?.txt).not.toContain("Ninjutsu");
  });
});


const GATED_JUTSU = "gated-jutsu";
const GATED_BLADE = "gated-blade";

/** A player holding a jutsu and a weapon that both require 500 Ninjutsu Mastery. */
const makeActor = (overrides: Partial<BattleUserState> = {}) =>
  makeUser({
    userId: "actor",
    ninjutsuMastery: 1000,
    jutsus: [
      {
        id: "user-jutsu-1",
        jutsuId: GATED_JUTSU,
        level: 1,
        equipped: true,
        experience: 0,
        lastUsedRound: -10,
        originalCooldown: 0,
        origin: "user",
      },
    ],
    items: [makeBattleUserItem({ id: "user-blade", itemId: GATED_BLADE })],
    ...overrides,
  });

const makeBattle = (
  users: BattleUserState[],
  usersEffects: UserEffect[] = [],
  round = 1,
): CompleteBattle =>
  ({
    id: "battle-1",
    battleType: "COMBAT",
    width: 5,
    height: 5,
    round,
    activeUserId: users[0]?.userId,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    updatedAt: new Date("2020-01-01T00:00:00Z"),
    roundStartAt: new Date("2020-01-01T00:00:00Z"),
    usersState: users,
    usersEffects,
    groundEffects: [],
    extraState: {
      dmgConfig,
      jutsus: {
        [GATED_JUTSU]: {
          id: GATED_JUTSU,
          name: "Gated Jutsu",
          image: "/jutsu.png",
          battleDescription: "test",
          target: "OTHER_USER",
          method: "SINGLE",
          range: 1,
          healthCost: 0,
          chakraCost: 0,
          staminaCost: 0,
          healthCostReducePerLvl: 0,
          chakraCostReducePerLvl: 0,
          staminaCostReducePerLvl: 0,
          actionCostPerc: 10,
          battleUsageType: "ANY",
          jutsuWeapon: "NONE",
          requiredNinjutsuMastery: 500,
          effects: [],
        },
      },
      jutsuReskins: {},
      items: {
        [GATED_BLADE]: {
          id: GATED_BLADE,
          name: "Gated Blade",
          image: "/blade.png",
          battleDescription: "test",
          itemType: "WEAPON",
          target: "OTHER_USER",
          method: "SINGLE",
          range: 1,
          healthCost: 0,
          chakraCost: 0,
          staminaCost: 0,
          healthCostReducePerLvl: 0,
          chakraCostReducePerLvl: 0,
          staminaCostReducePerLvl: 0,
          actionCostPerc: 10,
          cooldown: 0,
          maxDurability: 100,
          battleUsageType: "BOTH",
          requiredNinjutsuMastery: 500,
          effects: [],
        },
      },
      bloodlines: {},
      villages: {},
      anbuSquads: {},
      keystoneItems: {},
      wars: {},
      aiProfiles: {},
      relations: {},
      clans: {},
      userQuests: {},
      completedQuests: {},
      questData: {},
      bounties: {},
      bountySignups: {},
    },
  }) as unknown as CompleteBattle;

/** A residual Ninjutsu mastery tag on `targetId`, as applyEffects stores it once cast. */
const masteryEffect = (
  type: "increasemastery" | "decreasemastery",
  runtime: Partial<UserEffect> & Record<string, unknown>,
  tag: { power?: number; calculation?: "static" | "percentage"; rounds?: number } = {},
) =>
  makeEffect(
    type,
    {
      masteryTypes: ["Ninjutsu"],
      calculation: "static",
      power: 250,
      powerPerLevel: 0,
      rounds: 5,
      ...tag,
    },
    {
      id: `${type}-effect`,
      creatorId: "actor",
      targetId: "actor",
      targetType: "user",
      isNew: false,
      castThisRound: false,
      createdRound: 0,
      ...runtime,
    },
  );

const canUse = (battle: CompleteBattle, userId: string, actionId: string) =>
  availableUserActions(battle, userId, false).some((action) => action.id === actionId);

const actorOf = (battle: CompleteBattle, userId = "actor") =>
  battle.usersState.find((u) => u.userId === userId);

describe("applyEffects mastery persistence", () => {
  it.each(["increasemastery", "decreasemastery"] as const)(
    "preserves active ground %s when refreshing action gates",
    (type) => {
      const actor = makeActor({ ninjutsuMastery: 400 });
      const battle = makeBattle([actor], [], 2);
      battle.groundEffects = [
        {
          ...masteryEffect(type, {}, { power: 200 }),
          longitude: actor.longitude,
          latitude: actor.latitude,
        } as GroundEffect,
      ];
      const { newBattle } = applyEffects(battle, "actor");
      expect(actorOf(newBattle)?.ninjutsuMastery).toBe(
        type === "increasemastery" ? 600 : 200,
      );
      expect(canUse(newBattle, "actor", GATED_JUTSU)).toBe(type === "increasemastery");
      expect(newBattle.usersEffects).toHaveLength(0);
      expect(newBattle.groundEffects).toHaveLength(1);
    },
  );

  it.each([100, 0])("updates action gates after a %s%% bloodline seal", (chance) => {
    const buff = masteryEffect(
      "increasemastery",
      { fromType: "bloodline", actionId: "bloodline" },
      { power: 200, rounds: undefined },
    );
    const seal = makeEffect(
      "seal",
      { power: chance, powerPerLevel: 0, rounds: 3 },
      {
        id: "seal-effect",
        creatorId: "other",
        targetId: "actor",
        targetType: "user",
        isNew: true,
        createdRound: 2,
      },
    );
    const battle = makeBattle(
      [makeActor({ ninjutsuMastery: 400 }), makeUser({ userId: "other" })],
      [buff, seal],
      2,
    );
    refreshMasteries(battle.usersState, battle.usersEffects);
    expect(canUse(battle, "actor", GATED_JUTSU)).toBe(true);

    const { newBattle } = applyEffects(battle, "other");
    expect(actorOf(newBattle)?.ninjutsuMastery).toBe(chance === 100 ? 400 : 600);
    expect(canUse(newBattle, "actor", GATED_JUTSU)).toBe(chance === 0);
    expect(canUse(newBattle, "actor", GATED_BLADE)).toBe(chance === 0);
  });

  it("persists increasemastery onto the returned usersState without stacking", () => {
    const battle = makeBattle(
      [makeActor({ ninjutsuMastery: 1000 })],
      [masteryEffect("increasemastery", {})],
      2,
    );

    const first = applyEffects(battle, "actor");
    expect(actorOf(first.newBattle)?.ninjutsuMastery).toBe(1250);

    const second = applyEffects(first.newBattle, "actor");
    expect(actorOf(second.newBattle)?.ninjutsuMastery).toBe(1250);
  });

  it("applies percentage tags to the unbuffed base", () => {
    const battle = makeBattle(
      [makeActor({ ninjutsuMastery: 1000 })],
      [masteryEffect("increasemastery", {}, { power: 20, calculation: "percentage" })],
      2,
    );

    const first = applyEffects(battle, "actor");
    expect(actorOf(first.newBattle)?.ninjutsuMastery).toBe(1200);

    const second = applyEffects(first.newBattle, "actor");
    expect(actorOf(second.newBattle)?.ninjutsuMastery).toBe(1200);
  });

  it("restores the base mastery once the tag expires", () => {
    const battle = makeBattle(
      [makeActor({ ninjutsuMastery: 1000 })],
      [masteryEffect("increasemastery", {}, { rounds: 1 })],
      2,
    );
    const first = applyEffects(battle, "actor");
    expect(actorOf(first.newBattle)?.ninjutsuMastery).toBe(1250);

    const tag = first.newBattle.usersEffects.find((e) => e.type === "increasemastery");
    if (tag) tag.rounds = 0;
    const second = applyEffects(first.newBattle, "actor");
    expect(actorOf(second.newBattle)?.ninjutsuMastery).toBe(1000);
  });
});

describe("damage ignores mastery", () => {
  it("does not change damage when only mastery differs", () => {
    const effect = makeDamageEffect({ statTypes: ["Ninjutsu"] });
    const defender = makeUser({ userId: "defender" });
    const lowMastery = makeUser({
      userId: "attacker",
      ninjutsuMastery: 10,
    });
    const highMastery = makeUser({
      userId: "attacker",
      ninjutsuMastery: 1_000_000,
    });

    expect(damageCalc(effect, highMastery, defender, dmgConfig)).toBe(
      damageCalc(effect, lowMastery, defender, dmgConfig),
    );
  });
});

describe("availableUserActions mastery gating", () => {
  it("hides jutsu and items the user cannot meet mastery requirements for", () => {
    const battle = makeBattle([makeActor({ ninjutsuMastery: 100 })]);
    expect(canUse(battle, "actor", GATED_JUTSU)).toBe(false);
    expect(canUse(battle, "actor", GATED_BLADE)).toBe(false);
  });

  it("shows jutsu and items once the user meets mastery requirements", () => {
    const battle = makeBattle([makeActor({ ninjutsuMastery: 500 })]);
    expect(canUse(battle, "actor", GATED_JUTSU)).toBe(true);
    expect(canUse(battle, "actor", GATED_BLADE)).toBe(true);
  });

  it("keeps gated jutsu visible when masteries are masked off the user", () => {
    const battle = makeBattle([makeActor({ ninjutsuMastery: 100 })]);
    const actor = actorOf(battle);
    if (actor) {
      delete (actor as { ninjutsuMastery?: number }).ninjutsuMastery;
    }
    expect(canUse(battle, "actor", GATED_JUTSU)).toBe(true);
  });

  it("exempts AI from mastery gates", () => {
    const battle = makeBattle([makeActor({ ninjutsuMastery: 100, isAi: true })]);
    expect(canUse(battle, "actor", GATED_JUTSU)).toBe(true);
    expect(canUse(battle, "actor", GATED_BLADE)).toBe(true);
  });

  describe.each(["RANKED_PVP", "RANKED_SPARRING"] as const)("%s", (battleType) => {
    it.each(["jutsu", "armor"] as const)(
      "keeps gated actions available after a mastery penalty from %s, but hides broken weapons",
      (fromType) => {
        const battle = makeBattle(
          [makeActor()],
          [masteryEffect("decreasemastery", { fromType }, { power: 900 })],
          2,
        );
        battle.battleType = battleType;
        expect(canUse(battle, "actor", GATED_JUTSU)).toBe(true);
        expect(canUse(battle, "actor", GATED_BLADE)).toBe(true);

        const { newBattle } = applyEffects(battle, "actor");
        const actor = actorOf(newBattle);
        expect(actor?.ninjutsuMastery).toBe(100);
        expect(canUse(newBattle, "actor", GATED_JUTSU)).toBe(true);
        expect(canUse(newBattle, "actor", GATED_BLADE)).toBe(true);

        const weapon = actor?.items.find((item) => item.itemId === GATED_BLADE);
        if (weapon) weapon.durability = 0;
        expect(canUse(newBattle, "actor", GATED_JUTSU)).toBe(true);
        expect(canUse(newBattle, "actor", GATED_BLADE)).toBe(false);
      },
    );
  });

  it("locks gated actions once a decreasemastery lands", () => {
    const battle = makeBattle(
      [makeActor({ ninjutsuMastery: 600 })],
      [masteryEffect("decreasemastery", {}, { power: 300 })],
      2,
    );
    expect(canUse(battle, "actor", GATED_JUTSU)).toBe(true);

    const { newBattle } = applyEffects(battle, "actor");
    expect(actorOf(newBattle)?.ninjutsuMastery).toBe(300);
    expect(canUse(newBattle, "actor", GATED_JUTSU)).toBe(false);
    expect(canUse(newBattle, "actor", GATED_BLADE)).toBe(false);
  });
});

describe("mastery tags from pre-battle sources", () => {
  const gearBuff = (power: number) =>
    ({
      type: "increasemastery",
      masteryTypes: ["Ninjutsu"],
      calculation: "static",
      power,
      powerPerLevel: 0,
    }) as ZodAllTags;

  it("unlock gated actions before and from the first action of the battle", () => {
    const stored = makeActor({ ninjutsuMastery: 400 });
    const armor = {
      id: "user-armor",
      equipped: "CHEST",
      durability: 100,
      level: 1,
      item: {
        itemType: "ARMOR",
        maxDurability: 100,
        bloodlineId: null,
        canBeImbued: false,
        effects: [gearBuff(200)],
      },
    };
    // Pre-battle gates: the armor lifts the stored 400 over the 500 requirement
    expect(effectiveMasteries({ ...stored, items: [armor] }).ninjutsuMastery).toBe(600);

    // processUsersForBattle realizes the armor's tag; battle creation applies it at once
    const realized = masteryEffect(
      "increasemastery",
      { fromType: "armor", actionId: "armor" },
      { power: 200, rounds: undefined },
    );
    const battle = makeBattle([stored], [realized]);
    expect(canUse(battle, "actor", GATED_JUTSU)).toBe(false);
    refreshMasteries(battle.usersState, battle.usersEffects);
    expect(actorOf(battle)?.ninjutsuMastery).toBe(600);
    expect(canUse(battle, "actor", GATED_JUTSU)).toBe(true);

    // applyEffects restarts from the seeded base, so the buff does not stack
    const { newBattle } = applyEffects(battle, "actor");
    expect(actorOf(newBattle)?.ninjutsuMastery).toBe(600);
  });
});

describe("alignBattle mastery refresh", () => {
  /** Two players whose round is over, so the next alignBattle starts a new round. */
  const endOfRound = (effect: UserEffect) => {
    const round = 5;
    const actor = makeActor({ ninjutsuMastery: 600, round });
    const other = makeUser({ userId: "other", longitude: 1, round });
    return makeBattle([actor, other], [effect], round);
  };

  it("applies a decreasemastery cast last round to the next round's first action", () => {
    const debuff = masteryEffect(
      "decreasemastery",
      { creatorId: "other", createdRound: 5, castThisRound: true },
      { power: 300, rounds: 2 },
    );
    const battle = endOfRound(debuff);
    expect(canUse(battle, "actor", GATED_JUTSU)).toBe(true);

    const { progressRound } = alignBattle(battle, [], "actor");
    expect(progressRound).toBe(true);
    expect(actorOf(battle)?.ninjutsuMastery).toBe(300);
    expect(canUse(battle, "actor", GATED_JUTSU)).toBe(false);
  });

  it("releases the gate in the round the decreasemastery expires", () => {
    const debuff = masteryEffect(
      "decreasemastery",
      { creatorId: "other", createdRound: 3 },
      { power: 300, rounds: 1 },
    );
    const battle = endOfRound(debuff);
    refreshMasteries(battle.usersState, battle.usersEffects);
    expect(actorOf(battle)?.ninjutsuMastery).toBe(300);
    expect(canUse(battle, "actor", GATED_JUTSU)).toBe(false);

    alignBattle(battle, [], "actor");
    expect(debuff.rounds).toBe(0);
    expect(actorOf(battle)?.ninjutsuMastery).toBe(600);
    expect(canUse(battle, "actor", GATED_JUTSU)).toBe(true);
  });
});
