import { describe, expect, it } from "bun:test";
import type { Item, Jutsu } from "@/drizzle/schema";
import {
  applyActionCooldowns,
  availableUserActions,
  getDefaultBasicActions,
} from "@/libs/combat/actions";
import type { CompleteBattle } from "@/libs/combat/types";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeEffect,
  makeInjectBattle,
  makeJutsu,
  makeTag,
  makeWeapon,
} from "../../setup/combat";

/**
 * Drives the global cooldown (GCD) round by round through the same two calls the
 * combat router makes: availableUserActions with hidden cooldowns to decide what may
 * be performed, then applyActionCooldowns (via performBattleAction) once it is.
 */

const SHARED_COOLDOWN_ROUNDS = 3;
const USER = "player";

type SharedTag =
  | "clearprevent"
  | "debuffprevent"
  | "clear"
  | "damage"
  | "elementaldamage";

const sharedJutsu = (id: string, cooldown: number, tag: SharedTag) =>
  makeJutsu({
    id,
    name: id,
    cooldown,
    effects: [makeTag(tag, { rounds: 2 })],
  });

const sharedConsumable = (id: string, cooldown: number, tags: SharedTag[]) =>
  makeWeapon({
    id,
    name: id,
    itemType: "CONSUMABLE",
    target: "SELF",
    battleUsageType: "BOTH",
    preventBattleUsage: false,
    cooldown,
    effects: tags.map((tag) => makeTag(tag, { rounds: 1 })),
  });

/** Battle whose user state matches what initiateBattle stores for a fresh fight. */
const makeGcdBattle = (jutsus: Jutsu[], items: Item[] = []) => {
  const user = makeBattleUser(USER, {
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
    sharedCooldowns: {"barrier": 3, "buffprevent": 3, "cleanse": 3, "cleanseprevent": 3, "clear": 3, "clearprevent": 3, "consume": 3, "siphon": 3, "debuffprevent": 3, "drain": 3, "increasepoolcost": 3, "moveprevent": 3, "pierce": 3, "poison": 3, "seal": 3, "stun": 3, "summon": 3, "vamp": 3},
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

/** Advance all compared actions together so cooldown expiry cannot rewind their tracking. */
const expectLocks = (battle: CompleteBattle, expected: Record<string, number>) => {
  for (let round = 1; round <= 7; round++) {
    battle.round = round;
    const available = new Set(
      availableUserActions(battle, USER, true, true).map((action) => action.id),
    );
    for (const [id, duration] of Object.entries(expected)) {
      expect(available.has(id)).toBe(round >= 1 + duration);
    }
  }
};

describe("global cooldown", () => {
  describe.each(["jutsu", "item", "imbuement"] as const)(
    "%s elemental source",
    (sourceKind) => {
      const scenario = (mixed = false) => {
        const source = sharedJutsu("source", 0, "elementaldamage");
        if (mixed) source.effects.push(makeTag("damage"));
        const sourceItem = sharedConsumable(
          "source",
          0,
          sourceKind === "item"
            ? ["elementaldamage", ...(mixed ? ["damage" as const] : [])]
            : mixed
              ? ["damage"]
              : [],
        );
        const elementalItem = sharedConsumable("elemental-item", 0, ["elementaldamage"]);
        const imbuedItem = sharedConsumable("imbued-item", 0, []);
        const battle = makeGcdBattle(
          [
            sharedJutsu("elemental-peer", 0, "elementaldamage"),
            sharedJutsu("damage-peer", 0, "damage"),
            {
              ...sharedJutsu("mixed-peer", 0, "elementaldamage"),
              effects: [makeTag("elementaldamage"), makeTag("damage")],
            },
            ...(sourceKind === "jutsu" ? [source] : []),
          ],
          [elementalItem, imbuedItem, ...(sourceKind !== "jutsu" ? [sourceItem] : [])],
        );
        for (const owned of battle.usersState[0]!.items) {
          if (
            owned.itemId === imbuedItem.id ||
            (sourceKind === "imbuement" && owned.itemId === source.id)
          ) {
            owned.imbuementEffects = [makeEffect("elementaldamage")];
          }
        }
        return battle;
      };

      it("shares authored elemental tags without triggering ordinary damage cooldowns", () => {
        const battle = scenario();
        battle.extraState.sharedCooldowns = { elementaldamage: 3, damage: 5 };
        expect(
          availableUserActions(battle, USER)
            .find((action) => action.id === "source")
            ?.effects.map((effect) => effect.type),
        ).toEqual(["damage"]);
        perform(battle, 1, "source");
        expectLocks(battle, {
          "elemental-peer": 3,
          "elemental-item": 3,
          "imbued-item": 3,
          "mixed-peer": 3,
          "damage-peer": 0,
          basicAttack: 0,
          source: 0,
        });
      });

      it("keeps both authored damage types distinct on a mixed source", () => {
        const battle = scenario(true);
        battle.extraState.sharedCooldowns = { elementaldamage: 5, damage: 2 };
        perform(battle, 1, "source");
        expectLocks(battle, {
          "elemental-peer": 5,
          "elemental-item": 5,
          "imbued-item": 5,
          "mixed-peer": 5,
          "damage-peer": 2,
          basicAttack: 2,
          source: 0,
        });
      });

      it("does not treat resolved elemental tags as configured ordinary damage", () => {
        const battle = scenario();
        battle.extraState.sharedCooldowns = { damage: 3 };
        perform(battle, 1, "source");
        for (const id of [
          "elemental-peer",
          "elemental-item",
          "imbued-item",
          "mixed-peer",
          "damage-peer",
          "basicAttack",
        ]) {
          expect(usable(battle, id)).toBe(true);
        }
      });
    },
  );

  it("uses the selected copy's imbuement when an unavailable item shares its catalog id", () => {
    const battle = makeGcdBattle(
      [
        sharedJutsu("elemental-peer", 0, "elementaldamage"),
        sharedJutsu("damage-peer", 0, "damage"),
      ],
      [sharedConsumable("source", 0, [])],
    );
    const user = battle.usersState[0]!;
    const selected = user.items[0]!;
    selected.imbuementEffects = [makeEffect("elementaldamage")];
    user.items.unshift({
      ...selected,
      id: "unavailable-copy",
      equipped: "NONE",
      imbuementEffects: [makeEffect("damage")],
    });
    battle.extraState.sharedCooldowns = { elementaldamage: 3, damage: 5 };
    perform(battle, 1, "source");
    expect(usable(battle, "damage-peer")).toBe(true);
    expect(usableRounds(battle, "elemental-peer", 1, 5)).toEqual([4, 5]);
  });

  it("retains authored shared tags on an injected elemental jutsu", () => {
    const battle = makeGcdBattle([
      sharedJutsu("source", 0, "elementaldamage"),
      sharedJutsu("peer", 0, "elementaldamage"),
    ]);
    battle.usersState[0]!.jutsus = battle.usersState[0]!.jutsus.filter(
      (jutsu) => jutsu.jutsuId !== "source",
    );
    battle.usersEffects.push(
      makeEffect(
        "injectjutsus",
        { jutsuIds: ["source"], rounds: 10 },
        { targetId: USER },
      ),
    );
    battle.extraState.sharedCooldowns = { elementaldamage: 3, damage: 5 };
    perform(battle, 1, "source");
    expect(usable(battle, "basicAttack")).toBe(true);
    expect(usableRounds(battle, "peer", 1, 5)).toEqual([4, 5]);
  });

  it("matches raw basic actions against authored peer tags without selection metadata", () => {
    const battle = makeGcdBattle([
      sharedJutsu("elemental-peer", 0, "elementaldamage"),
      sharedJutsu("damage-peer", 0, "damage"),
    ]);
    battle.extraState.sharedCooldowns = { elementaldamage: 5, damage: 3 };
    battle.round = 1;
    const user = battle.usersState[0]!;
    applyActionCooldowns(battle, user, getDefaultBasicActions(user).basicAttack);
    expect(usable(battle, "elemental-peer")).toBe(true);
    expect(usableRounds(battle, "damage-peer", 1, 5)).toEqual([4, 5]);
  });

  it("shares configured movement cooldowns in both directions and restores Move's zero cooldown", () => {
    const battle = makeGcdBattle([]);
    battle.extraState.sharedCooldowns = { move: 3 };
    perform(battle, 1, "replacementTechnique");
    expect(usableRounds(battle, "move", 1, 5)).toEqual([4, 5]);
    perform(battle, 4, "move");
    expect(usableRounds(battle, "replacementTechnique", 4, 8)).toEqual([7, 8]);
    expect(usableRounds(battle, "move", 4, 8)).toEqual([4, 5, 6, 7, 8]);
    expect(
      battle.usersState[0]!.basicActions.find((action) => action.id === "move")?.cooldown,
    ).toBeUndefined();
  });

  it("triggers shared cooldowns when the performed basic action's cooldown is reduced to zero", () => {
    const battle = makeGcdBattle([sharedJutsu("rip", 5, "clear")]);
    battle.extraState.sharedCooldowns = { clear: 3 };
    battle.usersEffects.push(
      makeEffect(
        "decreasecooldown",
        { power: 10, rounds: 20, actionsAffected: ["clear"] },
        { targetId: USER },
      ),
    );
    perform(battle, 1, "clear");
    expect(usableRounds(battle, "rip", 1, 5)).toEqual([4, 5]);
    expect(usableRounds(battle, "clear", 1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("uses the configured basic-action lock under cooldown reduction", () => {
    const battle = makeGcdBattle([sharedJutsu("rip", 5, "clear")]);
    battle.extraState.sharedCooldowns = { clear: 5 };
    battle.usersEffects.push(makeEffect("decreasecooldown", { power: 12, rounds: 20, actionsAffected: ["clear"] }, { targetId: USER }));
    perform(battle, 1, "rip");
    expect(usableRounds(battle, "clear", 1, 7)).toEqual([6, 7]);
  });

  it("applies a custom duration through an item's imbuement", () => {
    const item = sharedConsumable("potion", 8, []);
    const battle = makeGcdBattle([sharedJutsu("rip", 5, "clear")], [item]);
    battle.extraState.sharedCooldowns = { clear: 4 };
    battle.usersState[0]!.items[0]!.imbuementEffects = [makeEffect("clear", { rounds: 2 })];
    perform(battle, 1, "rip");
    expect(usableRounds(battle, item.id, 1, 6)).toEqual([5, 6]);
  });

  it("uses different durations for configured tags", () => {
    const battle = makeGcdBattle([sharedJutsu("a", 5, "clear"), sharedJutsu("b", 8, "clear")]);
    battle.extraState.sharedCooldowns = { clear: 5 };
    perform(battle, 1, "a");
    expect(usableRounds(battle, "b", 1, 7)).toEqual([6, 7]);
  });

  it("uses the longest matching tag, ignoring tags only on the source", () => {
    const a = sharedJutsu("a", 5, "clear");
    a.effects.push(makeTag("clearprevent", { rounds: 2 }), makeTag("debuffprevent", { rounds: 2 }));
    const b = sharedJutsu("b", 8, "clear");
    b.effects.push(makeTag("clearprevent", { rounds: 2 }));
    const battle = makeGcdBattle([a, b]);
    battle.extraState.sharedCooldowns = { clear: 2, clearprevent: 5, debuffprevent: 10 };
    perform(battle, 1, "a");
    expect(usableRounds(battle, "b", 1, 7)).toEqual([6, 7]);
  });

  it("does not lock tags removed from configuration", () => {
    const battle = makeGcdBattle([sharedJutsu("a", 5, "clear"), sharedJutsu("b", 8, "clear")]);
    battle.extraState.sharedCooldowns = {};
    perform(battle, 1, "a");
    expect(usable(battle, "b")).toBe(true);
  });

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
    // Heavenly Constructs in round 1 puts the potion on the GCD; Starlight Veil in
    // round 3 must lock it again even though its 10-round base cooldown is longer
    // than the GCD, so it is not usable in round 4.
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
