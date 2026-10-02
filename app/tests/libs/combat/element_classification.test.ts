import { describe, expect, it } from "vitest";
import type { ElementName } from "@/drizzle/constants";
import type { Item, Jutsu } from "@/drizzle/schema";
import { availableUserActions, userItemToAction, userJutsuToAction } from "@/libs/combat/actions";
import { SAGE_MODE_ACTIVATION_JUTSU } from "@/libs/sageMode";
import { maskUsersState } from "@/libs/combat/util";
import { makeBattleUser, makeBattleUserItem, makeCompleteBattle, makeEffect, makeTag } from "./helpers/battleScenario";

const fixture = (primaryElement: ElementName = "Fire", isAi = false) => {
  const jutsu: Jutsu = {
    ...SAGE_MODE_ACTIVATION_JUTSU,
    id: "classified-jutsu",
    elements: ["Fire"],
    effects: [makeTag("damage", { elements: ["Water"] })],
  };
  const item = {
    ...jutsu,
    id: "classified-item",
    itemType: "WEAPON",
    preventBattleUsage: false,
    maxDurability: 100,
  } as unknown as Item;
  const jutsuRef = { id: "owned-jutsu", jutsuId: jutsu.id, level: 1, experience: 0, equipped: true, origin: "user" as const, lastUsedRound: 0, originalCooldown: 0, reskinId: null };
  const itemRef = makeBattleUserItem({ itemId: item.id });
  const user = makeBattleUser("caster", { primaryElement, secondaryElement: null, isAi, jutsus: [jutsuRef], items: [itemRef] });
  const battle = makeCompleteBattle({ usersState: [user], extraState: { jutsus: { [jutsu.id]: jutsu }, items: { [item.id]: item } } });
  return { battle, user, jutsu, item, jutsuRef, itemRef };
};

describe("classification in battle actions", () => {
  it("preserves the owner's elements when masking battle state", () => {
    const { battle, jutsu, item } = fixture();
    const maskedBattle = { ...battle, usersState: maskUsersState(battle.usersState, "caster") };
    const ids = availableUserActions(maskedBattle, "caster", false).map((action) => action.id);
    expect(ids).toContain(jutsu.id);
    expect(ids).toContain(item.id);
    const opponentView = maskUsersState(battle.usersState, "other");
    expect(opponentView[0]).not.toHaveProperty("primaryElement");
    expect(opponentView[0]).not.toHaveProperty("secondaryElement");
  });

  it("carries classification separately from local targeting for jutsu and items", () => {
    const { battle, user, jutsuRef, itemRef } = fixture();
    for (const action of [userJutsuToAction(jutsuRef, battle), userItemToAction(itemRef, user, battle)]) {
      expect(action.elements).toEqual(["Fire"]);
      expect(action.effects[0]).toMatchObject({ elements: ["Water"] });
    }
  });

  it.each([false, true])("checks element ownership while honoring AI exemption (%s)", (isAi) => {
    const { battle, jutsu, item } = fixture("Earth", isAi);
    const ids = availableUserActions(battle, "caster", false).map((action) => action.id);
    expect(ids.includes(jutsu.id)).toBe(isAi);
    expect(ids.includes(item.id)).toBe(isAi);
  });

  it("keeps elemental seals targeting local effects, not action classification", () => {
    const { battle, jutsu } = fixture();
    const seal = makeEffect("elementalseal", { elements: ["Fire"], rounds: 3 }, { targetId: "caster" });
    battle.usersEffects.push(seal);
    expect(availableUserActions(battle, "caster", false).some((action) => action.id === jutsu.id)).toBe(true);
    if (seal.type === "elementalseal") seal.elements = ["Water"];
    expect(availableUserActions(battle, "caster", false).some((action) => action.id === jutsu.id)).toBe(false);
  });
});
