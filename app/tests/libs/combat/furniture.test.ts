import { describe, expect, it } from "bun:test";
import type { Item } from "@/drizzle/schema";
import { availableUserActions } from "@/libs/combat/actions";
import type { CombatQueryUser } from "@/libs/combat/types";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeCompleteBattle,
  makeJutsu,
  makeTag,
} from "../../setup/combat";
import { makeCombatQueryUser, preloadBattle } from "./helpers/preload";

const furniture = {
  id: "chair",
  name: "Chair",
  itemType: "FURNITURE",
  slot: "HEAD",
  weaponType: "SWORD",
  preventBattleUsage: false,
  battleUsageType: "BOTH",
  maxDurability: 100,
  canBeImbued: true,
  bloodlineId: null,
  cooldown: 0,
  effects: [
    makeTag("damage"),
    makeTag("increasedamagegiven", { power: 100 }),
    makeTag("summon", { aiId: "furniture-summon" }),
  ],
} as unknown as Item;

const combatUser = (isAi: boolean): CombatQueryUser =>
  makeCombatQueryUser("owner", {
    isAi,
    rank: "JONIN",
    bloodlineId: null,
    items: [
      {
        id: "chair-row",
        itemId: furniture.id,
        equipped: "HEAD",
        level: 20,
        durability: 100,
        quantity: 1,
        imbuements: [],
        dropChancePerc: 100,
        item: furniture,
      },
      {
        id: "weapon-row",
        itemId: "weapon",
        equipped: "HAND_1",
        level: 1,
        durability: 100,
        quantity: 1,
        imbuements: [],
        dropChancePerc: 0,
        item: {
          ...furniture,
          id: "weapon",
          name: "Weapon",
          itemType: "WEAPON",
          slot: "HAND",
          weaponType: "STAFF",
          effects: [makeTag("damage")],
        },
      },
    ],
  });

const preload = (user: CombatQueryUser, battleType: "COMBAT" | "RANKED_PVP") =>
  preloadBattle([user], { battleType });

describe("furniture combat exclusion", () => {
  for (const isAi of [false, true]) {
    for (const battleType of ["COMBAT", "RANKED_PVP"] as const) {
      it(`removes equipped, droppable furniture for ${isAi ? "AI" : "human"} ${battleType} participants`, async () => {
        const input = combatUser(isAi);
        // A furniture summon reaching effect processing would try to query this
        // empty client; filtering must happen before summon preloading as well.
        const result = await preload(input, battleType);
        const owner = result.usersState[0]!;
        expect(owner.items.map((row) => row.itemId)).toEqual(["weapon"]);
        expect(result.extraState.items).not.toHaveProperty("chair");
        expect(result.extraState.items).toHaveProperty("weapon");
        expect(result.initialDurability[owner.userId]).toEqual({ "weapon-row": 100 });
        expect(result.userEffects.some((effect) => effect.actionId === "chair")).toBe(
          false,
        );
        expect(result.usersState).toHaveLength(1);
        expect(input.items.map((row) => row.itemId)).toEqual(["chair", "weapon"]);
      });
    }
  }

  it("cannot satisfy equipped weapon or bloodline-item requirements", async () => {
    const user = combatUser(false);
    user.jutsus = [
      makeJutsu({ id: "sword-jutsu", jutsuWeapon: "SWORD" }),
      makeJutsu({ id: "chair-jutsu", requiredBloodlineItemId: "chair" }),
    ].map((jutsu) => ({
      id: `owned-${jutsu.id}`,
      jutsuId: jutsu.id,
      equipped: true,
      level: 1,
      experience: 0,
      jutsu,
    })) as unknown as CombatQueryUser["jutsus"];
    const result = await preload(user, "COMBAT");
    expect(result.usersState[0]!.jutsus).toEqual([]);
  });

  it("does not offer furniture as an action in a stale battle payload", () => {
    const user = makeBattleUser("owner", {
      items: [makeBattleUserItem({ itemId: "chair", equipped: "ITEM_1" })],
    });
    const battle = makeCompleteBattle({
      usersState: [user],
      extraState: { items: { chair: furniture } },
    });
    expect(
      availableUserActions(battle, user.userId).some(
        (action) => action.type === "item",
      ),
    ).toBe(false);
  });
});
