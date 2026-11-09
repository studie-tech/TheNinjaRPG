import { describe, expect, it } from "bun:test";

// Using a GROUND-targeted item (e.g. Smoke Bomb) through the real action pipeline records
// it in `usedActions`, which buildCombatTrackerTasks reads for the use_specific_item_combat
// tracker.

import type { Item } from "@/drizzle/schema";
import { insertAction } from "@/libs/combat/actions";
import { getBattleGrid } from "@/libs/combat/util";
import { VisualTag } from "@/validators/combat";
import type {
  CombatAction,
  CompleteBattle,
  ReturnedBattle,
} from "@/libs/combat/types";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeCombatAction,
  makeCompleteBattle,
} from "../../setup/combat";

const ITEM_ID = "smoke-bomb-item";

const makeActor = () =>
  makeBattleUser("actor", {
    direction: "left",
    longitude: 0,
    latitude: 0,
    curHealth: 1000,
    maxHealth: 1000,
    items: [makeBattleUserItem({ itemId: ITEM_ID, quantity: 10, equipped: "ITEM_6" })],
  });

const makeBattle = (actor: ReturnType<typeof makeActor>): CompleteBattle =>
  makeCompleteBattle({
    width: 5,
    height: 5,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    updatedAt: new Date("2020-01-01T00:00:00Z"),
    roundStartAt: new Date("2020-01-01T00:00:00Z"),
    usersState: [actor],
    extraState: {
      items: { [ITEM_ID]: { id: ITEM_ID, name: "Smoke Bomb", destroyOnUse: false } as Item },
    },
  });

// A GROUND-targeted consumable item action, as userItemToAction would produce (id = item.id,
// type = "item", target = item.target). Smoke Bomb applies a visual/stealth cloud on the ground.
const makeGroundItemAction = (): CombatAction =>
  makeCombatAction({
    id: ITEM_ID,
    name: "Smoke Bomb",
    type: "item",
    target: "GROUND",
    method: "AOE_CIRCLE_SPAWN",
    range: 3,
    level: 0,
    effects: [VisualTag.parse({ staticAssetPath: "" })],
  });

describe("GROUND-targeted item usage records into usedActions", () => {
  it("pushes the item id into usedActions when a ground item is used", () => {
    const actor = makeActor();
    const battle = makeBattle(actor);
    const grid = getBattleGrid(20, battle as unknown as ReturnedBattle);

    const result = insertAction({
      battle,
      grid,
      action: makeGroundItemAction(),
      actorId: "actor",
      longitude: 1,
      latitude: 0,
    });

    expect(result).toBe(true);
    expect(battle.extraState.revealedActions).toEqual({ jutsuIds: [], itemIds: [ITEM_ID] });
    const itemUses = actor.usedActions.filter((a) => a.type === "item");
    expect(itemUses.map((a) => a.id)).toContain(ITEM_ID);
  });
});
