import { describe, expect, it } from "bun:test";
import type { Item } from "@/drizzle/schema";
import { availableUserActions } from "@/libs/combat/actions";
import type { CombatQueryUser } from "@/libs/combat/types";
import { CARD_ITEM_DEFAULTS, DEFAULT_CARD_DATA } from "@/validators/itemCard";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeCompleteBattle,
} from "../../setup/combat";
import { makeCombatQueryUser, preloadBattle } from "./helpers/preload";

const card = {
  ...CARD_ITEM_DEFAULTS,
  id: "kessen-moonprowler",
  name: "Moonprowler",
  itemType: "CARD",
  rarity: "COMMON",
  // A card depicting a clan keeps its bloodline; it must not gate the drop.
  bloodlineId: "moon-clan",
  cardData: DEFAULT_CARD_DATA,
} as unknown as Item;

const combatUser = (isAi: boolean, dropChancePerc: number): CombatQueryUser =>
  makeCombatQueryUser("owner", {
    isAi,
    rank: "JONIN",
    bloodlineId: null,
    items: [
      {
        id: "card-row",
        itemId: card.id,
        equipped: "NONE",
        level: 1,
        durability: 100,
        quantity: 1,
        imbuements: [],
        dropChancePerc,
        item: card,
      },
    ],
  });

describe("cards in combat", () => {
  it("keeps an AI's droppable card in battle state so its drop can be rolled", async () => {
    const result = await preloadBattle([combatUser(true, 5)], { battleType: "COMBAT" });
    expect(result.usersState[0]!.items.map((row) => row.itemId)).toEqual([card.id]);
    expect(result.extraState.items).toHaveProperty(card.id);
  });

  it.each([
    { isAi: true, dropChancePerc: 0 },
    { isAi: false, dropChancePerc: 5 },
  ])("leaves other cards out of battle (%j)", async ({ isAi, dropChancePerc }) => {
    const result = await preloadBattle([combatUser(isAi, dropChancePerc)], {
      battleType: "COMBAT",
    });
    expect(result.usersState[0]!.items).toEqual([]);
    expect(result.extraState.items).not.toHaveProperty(card.id);
  });

  it("never offers a card as a battle action", () => {
    const user = makeBattleUser("owner", {
      items: [makeBattleUserItem({ itemId: card.id, equipped: "ITEM_1" })],
    });
    const battle = makeCompleteBattle({
      usersState: [user],
      extraState: { items: { [card.id]: card } },
    });
    expect(
      availableUserActions(battle, user.userId).some(
        (action) => action.type === "item",
      ),
    ).toBe(false);
  });
});
