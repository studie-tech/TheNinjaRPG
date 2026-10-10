import { describe, expect, it } from "bun:test";
import { SHARED_COOLDOWN_ROUNDS } from "@/drizzle/constants";
import type { Item, Jutsu } from "@/drizzle/schema";
import {
  applyActionCooldowns,
  availableUserActions,
  getDefaultBasicActions,
} from "@/libs/combat/actions";
import type { CompleteBattle } from "@/libs/combat/types";
import { SAGE_MODE_ACTIVATION_JUTSU } from "@/libs/sageMode";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeBattleWithWeapon,
  makeEffect,
  makeInjectBattle,
  makeTag,
} from "./helpers/battleScenario";

/**
 * Drives the global cooldown (GCD) round by round through the same two calls the
 * combat router makes: availableUserActions with hidden cooldowns to decide what may
 * be performed, then applyActionCooldowns (via performBattleAction) once it is.
 */

const USER = "player";

type SharedTag = "clearprevent" | "debuffprevent" | "clear";

const sharedJutsu = (id: string, cooldown: number, tag: SharedTag) =>
  ({
    ...SAGE_MODE_ACTIVATION_JUTSU,
    id,
    name: id,
    cooldown,
    effects: [makeTag(tag, { rounds: 2 })],
  }) as Jutsu;

const sharedConsumable = (id: string, cooldown: number, tags: SharedTag[]) => {
  const { extraState } = makeBattleWithWeapon({
    itemId: id,
    item: {
      name: id,
      itemType: "CONSUMABLE",
      target: "SELF",
      battleUsageType: "BOTH",
      preventBattleUsage: false,
      cooldown,
      effects: tags.map((tag) => makeTag(tag, { rounds: 1 })),
    },
  });
  return extraState.items?.[id] as Item;
};

/** Battle whose user state matches what initiateBattle stores for a fresh fight. */
const makeGcdBattle = (jutsus: Jutsu[], items: Item[] = []) => {
  const user = makeBattleUser(USER, {
    curChakra: 5000,
    maxChakra: 5000,
    curStamina: 5000,
    maxStamina: 5000,
    jutsus: jutsus.map((j) => ({
      id: `user-${j.id}`,
      jutsuId: j.id,
      level: 1,
      equipped: true,
      experience: 0,
      lastUsedRound: -j.cooldown,
      originalCooldown: j.cooldown,
    })),
    items: items.map((item) =>
      makeBattleUserItem({
        id: `user-${item.id}`,
        itemId: item.id,
        equipped: "ITEM_1",
        quantity: 5,
        lastUsedRound: -item.cooldown,
        originalCooldown: item.cooldown,
      }),
    ),
  });
  user.basicActions = Object.values(getDefaultBasicActions(user)).map((ba) => ({
    id: ba.id,
    lastUsedRound: ba.lastUsedRound ?? 0,
  }));
  return makeInjectBattle(user, {
    jutsus: Object.fromEntries(jutsus.map((j) => [j.id, j])),
    items: Object.fromEntries(items.map((i) => [i.id, i])),
  });
};

const usable = (battle: CompleteBattle, actionId: string) =>
  availableUserActions(battle, USER, true, true).some((a) => a.id === actionId);

const perform = (battle: CompleteBattle, round: number, actionId: string) => {
  battle.round = round;
  const action = availableUserActions(battle, USER, true, true).find(
    (a) => a.id === actionId,
  );
  if (!action) throw new Error(`${actionId} is on cooldown in round ${round}`);
  const user = battle.usersState.find((u) => u.userId === USER);
  if (!user) throw new Error("User missing from battle");
  applyActionCooldowns(battle, user, action);
};

/** Rounds (within the inspected range) in which the action can be performed. */
const usableRounds = (battle: CompleteBattle, actionId: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i).filter((round) => {
    battle.round = round;
    return usable(battle, actionId);
  });

describe("global cooldown", () => {
  it("locks every other shared action for the GCD after one is used", () => {
    const battle = makeGcdBattle([
      sharedJutsu("a", 5, "clearprevent"),
      sharedJutsu("b", 8, "clearprevent"),
    ]);
    perform(battle, 1, "a");
    expect(usableRounds(battle, "b", 1, 6)).toEqual([1 + SHARED_COOLDOWN_ROUNDS, 5, 6]);
  });

  it("locks a shared action that an earlier GCD already released", () => {
    const battle = makeGcdBattle([
      sharedJutsu("a", 5, "clearprevent"),
      sharedJutsu("b", 8, "clearprevent"),
      sharedJutsu("c", 8, "clearprevent"),
    ]);
    perform(battle, 1, "a");
    // Both b and c come off the round-1 GCD in round 4. Using b must lock c again,
    // even though c's own 8-round cooldown would make it look long enough.
    perform(battle, 4, "b");
    expect(usableRounds(battle, "c", 4, 8)).toEqual([7, 8]);
  });

  it("locks an action whose running GCD is shorter than its own cooldown", () => {
    // Replays production battle s1HJ8CinWk3L7RZHjmIy4: Heavenly Constructs in round 1
    // put the potion on the GCD; Starlight Veil in round 3 then measured the potion
    // against its 10-round base cooldown, left it alone, and it was drunk in round 4.
    const potion = sharedConsumable("miracle-potion", 10, ["debuffprevent", "clearprevent"]);
    const battle = makeGcdBattle(
      [
        sharedJutsu("heavenly-constructs", 7, "debuffprevent"),
        sharedJutsu("starlight-veil", 7, "clearprevent"),
      ],
      [potion],
    );
    perform(battle, 1, "heavenly-constructs");
    perform(battle, 3, "starlight-veil");
    expect(usableRounds(battle, potion.id, 3, 7)).toEqual([6, 7]);
  });

  it("does not shorten a lock that is already longer than the GCD", () => {
    const battle = makeGcdBattle([
      sharedJutsu("a", 5, "clearprevent"),
      sharedJutsu("b", 8, "clearprevent"),
    ]);
    perform(battle, 1, "b");
    // b still has 5 rounds of its own 8-round cooldown left when a is used
    perform(battle, 4, "a");
    expect(usableRounds(battle, "b", 4, 10)).toEqual([9, 10]);
  });

  it("restores a jutsu's own cooldown once it is used after a GCD", () => {
    const battle = makeGcdBattle([
      sharedJutsu("a", 5, "clearprevent"),
      sharedJutsu("b", 8, "clearprevent"),
    ]);
    perform(battle, 1, "a");
    perform(battle, 4, "b");
    expect(usableRounds(battle, "b", 4, 13)).toEqual([12, 13]);
  });

  it("restores basic Clear's own cooldown once it is used after a GCD", () => {
    const battle = makeGcdBattle([sharedJutsu("rip", 5, "clear")]);
    perform(battle, 1, "rip");
    expect(usableRounds(battle, "clear", 1, 4)).toEqual([4]);
    // Clear then runs on its full 10-round cooldown again, not the 3-round GCD.
    perform(battle, 4, "clear");
    expect(usableRounds(battle, "clear", 4, 15)).toEqual([14, 15]);
  });

  it("locks basic Clear again when an earlier GCD already released it", () => {
    const battle = makeGcdBattle([
      sharedJutsu("rip", 5, "clear"),
      sharedJutsu("tear", 8, "clear"),
    ]);
    perform(battle, 1, "rip");
    perform(battle, 4, "tear");
    expect(usableRounds(battle, "clear", 4, 8)).toEqual([7, 8]);
  });

  it("preserves a basic lock whose effective cooldown is already as long as the GCD", () => {
    const battle = makeGcdBattle([
      sharedJutsu("rip", 5, "clear"),
      sharedJutsu("tear", 8, "clear"),
    ]);
    perform(battle, 1, "rip");
    battle.usersEffects.push(
      makeEffect(
        "increasecooldown",
        { power: 3, rounds: 10, actionsAffected: ["clear"] },
        { targetId: USER },
      ),
    );
    perform(battle, 4, "tear");
    expect(usableRounds(battle, "clear", 4, 8)).toEqual([7, 8]);
  });

  it("leaves actions without a matching shared tag untouched", () => {
    const battle = makeGcdBattle([
      sharedJutsu("a", 5, "clearprevent"),
      sharedJutsu("rip", 5, "clear"),
    ]);
    perform(battle, 1, "a");
    expect(usable(battle, "rip")).toBe(true);
    expect(usable(battle, "clear")).toBe(true);
  });

  it("extends a reduced basic cooldown without shortening its existing lock", () => {
    const battle = makeGcdBattle([sharedJutsu("rip", 5, "clear")]);
    battle.usersEffects.push(
      makeEffect(
        "decreasecooldown",
        { power: 2, rounds: 20, actionsAffected: ["clear"] },
        { targetId: USER },
      ),
    );
    perform(battle, 1, "clear");
    expect(usableRounds(battle, "clear", 7, 10)).toEqual([9, 10]);
    perform(battle, 7, "rip");
    expect(usableRounds(battle, "clear", 7, 10)).toEqual([10]);
    // Using Clear removes the GCD override, so its own cooldown is reduced again.
    perform(battle, 10, "clear");
    expect(usableRounds(battle, "clear", 10, 19)).toEqual([18, 19]);
  });

  it.each([2, SHARED_COOLDOWN_ROUNDS, 12])(
    "keeps the full basic-action GCD with a %i-round cooldown reduction",
    (power) => {
      const battle = makeGcdBattle([
        sharedJutsu("rip", 5, "clear"),
        sharedJutsu("tear", 8, "clear"),
      ]);
      battle.usersEffects.push(
        makeEffect(
          "decreasecooldown",
          { power, rounds: 20, actionsAffected: ["clear"] },
          { targetId: USER },
        ),
      );
      perform(battle, 1, "rip");
      expect(usableRounds(battle, "clear", 1, 4)).toEqual([4]);
      perform(battle, 4, "tear");
      expect(usableRounds(battle, "clear", 4, 8)).toEqual([7, 8]);
    },
  );
});
