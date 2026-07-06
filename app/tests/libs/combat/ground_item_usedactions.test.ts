import { describe, expect, it, vi } from "vitest";

// Does using a GROUND-targeted item (e.g. Smoke Bomb) record it in `usedActions`? That array
// is what buildCombatTrackerTasks reads for the use_specific_item_combat tracker. The reported
// "used the item but it didn't count" objective targets a GROUND consumable, so this pins down
// whether the real action pipeline captures such usage.

vi.mock("@/server/db", () => ({ drizzleDB: {} }));
// Override ONLY checkFriendlyFire — do NOT stub applyEffects (it leaks process-globally under
// `bun test` into the real-applyEffects damage-credit suites and crashes them). insertAction
// never calls applyEffects here, so leaving it real is inert.
vi.mock("@/libs/combat/process", () => ({
  checkFriendlyFire: vi.fn(() => true),
}));

import { insertAction } from "@/libs/combat/actions";
import { getBattleGrid } from "@/libs/combat/util";
import { VisualTag } from "@/validators/combat";
import type {
  CombatAction,
  CompleteBattle,
  ReturnedBattle,
} from "@/libs/combat/types";

const ITEM_ID = "smoke-bomb-item";

const makeActor = () => ({
  userId: "actor",
  username: "Actor",
  gender: "Male",
  villageId: "village-1",
  direction: "left",
  level: 100,
  longitude: 0,
  latitude: 0,
  curHealth: 1000,
  maxHealth: 1000,
  curChakra: 1000,
  curStamina: 1000,
  actionPoints: 100,
  highestOffence: "ninjutsuOffence",
  highestDefence: "ninjutsuDefence",
  highestGenerals: ["strength"],
  fledBattle: false,
  leftBattle: false,
  usedActions: [] as { id: string; type: string }[],
  items: [
    {
      id: "user-item-1",
      itemId: ITEM_ID,
      quantity: 10,
      equipped: "ITEM_6",
    },
  ],
  usedGenerals: { strength: 0, intelligence: 0, willpower: 0, speed: 0 },
  usedStats: {
    ninjutsuOffence: 0,
    genjutsuOffence: 0,
    taijutsuOffence: 0,
    bukijutsuOffence: 0,
    ninjutsuDefence: 0,
    genjutsuDefence: 0,
    taijutsuDefence: 0,
    bukijutsuDefence: 0,
  },
});

const makeBattle = (actor: ReturnType<typeof makeActor>): CompleteBattle =>
  ({
    id: "battle-1",
    battleType: "COMBAT",
    width: 5,
    height: 5,
    round: 1,
    createdAt: new Date("2020-01-01T00:00:00Z"),
    updatedAt: new Date("2020-01-01T00:00:00Z"),
    roundStartAt: new Date("2020-01-01T00:00:00Z"),
    usersState: [actor],
    usersEffects: [],
    groundEffects: [],
    extraState: {
      items: { [ITEM_ID]: { id: ITEM_ID, name: "Smoke Bomb", destroyOnUse: false } },
    },
  }) as unknown as CompleteBattle;

// A GROUND-targeted consumable item action, as userItemToAction would produce (id = item.id,
// type = "item", target = item.target). Smoke Bomb applies a visual/stealth cloud on the ground.
const makeGroundItemAction = (): CombatAction =>
  ({
    id: ITEM_ID,
    name: "Smoke Bomb",
    image: "/item.png",
    battleDescription: "",
    type: "item",
    target: "GROUND",
    method: "AOE_CIRCLE_SPAWN",
    range: 3,
    healthCost: 0,
    chakraCost: 0,
    staminaCost: 0,
    actionCostPerc: 10,
    updatedAt: new Date("2020-01-01T00:00:00Z"),
    cooldown: 0,
    originalCooldown: 0,
    level: 0,
    effects: [VisualTag.parse({ staticAssetPath: "" })],
  }) as unknown as CombatAction;

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
    const itemUses = actor.usedActions.filter((a) => a.type === "item");
    expect(itemUses.map((a) => a.id)).toContain(ITEM_ID);
  });
});
