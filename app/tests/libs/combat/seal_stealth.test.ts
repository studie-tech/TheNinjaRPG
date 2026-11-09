import { describe, expect, it } from "bun:test";
import { availableUserActions } from "@/libs/combat/actions";
import { ElementalSealTag } from "@/validators/combat";
import {
  makeBattleUser,
  makeBattleUserItem,
  makeEffect,
  makeInjectBattle,
  makeJutsu,
  makeTag,
  makeWeapon,
} from "../../setup/combat";

const fixture = () => {
  const jutsus = [
    makeJutsu({
      id: "fire60",
      name: "Fire 60",
      actionCostPerc: 60,
      elementClassification: "Fire",
      effects: [makeTag("heal")],
    }),
    makeJutsu({
      id: "water60",
      name: "Water 60",
      actionCostPerc: 60,
      elementClassification: "None",
      effects: [makeTag("damage", { elements: ["Water"] })],
    }),
    makeJutsu({
      id: "fire40",
      name: "Fire 40",
      actionCostPerc: 40,
      elementClassification: "Fire",
      effects: [makeTag("damage", { elements: ["Fire"] })],
    }),
    makeJutsu({
      id: "none60",
      name: "Support 60",
      actionCostPerc: 60,
      elementClassification: "None",
      effects: [makeTag("heal")],
    }),
    makeJutsu({
      id: "noneTag60",
      name: "None 60",
      actionCostPerc: 60,
      elementClassification: null,
      effects: [makeTag("damage", { elements: ["None"] })],
    }),
    makeJutsu({
      id: "fire80",
      name: "Fire 80",
      actionCostPerc: 80,
      elementClassification: "Fire",
      effects: [makeTag("damage")],
    }),
  ];
  const weapon = makeWeapon();
  const consumable = makeWeapon({
    id: "pill",
    name: "Pill",
    itemType: "CONSUMABLE",
    effects: [makeTag("heal")],
  });
  const user = makeBattleUser("caster", {
    jutsus: jutsus.map((jutsu) => ({
      id: jutsu.id,
      jutsuId: jutsu.id,
      equipped: true,
      level: 1,
      experience: 0,
      lastUsedRound: -10,
      originalCooldown: 0,
      origin: "user" as const,
    })),
    items: [
      makeBattleUserItem({ lastUsedRound: -10 }),
      makeBattleUserItem({
        id: "user-pill",
        itemId: "pill",
        equipped: "ITEM_1",
        quantity: 2,
        lastUsedRound: -10,
      }),
    ],
  });
  return makeInjectBattle(
    user,
    {
      jutsus: Object.fromEntries(jutsus.map((jutsu) => [jutsu.id, jutsu])),
      items: { "weapon-1": weapon, pill: consumable },
    },
    { round: 2 },
  );
};
const actions = (battle: ReturnType<typeof fixture>) =>
  availableUserActions(battle, "caster", false, true);

describe("Elemental Seal", () => {
  it("blocks only exactly 60 AP elemental jutsu, ignoring old configured elements", () => {
    const battle = fixture();
    battle.usersEffects = [
      makeEffect(
        "elementalseal",
        { rounds: 3 },
        { targetId: "caster", castThisRound: false, elements: ["Earth"] },
      ),
    ];
    const ids = actions(battle).map((action) => action.id);
    expect(ids).not.toContain("fire60");
    expect(ids).not.toContain("water60");
    for (const id of ["fire40", "none60", "noneTag60", "fire80"])
      expect(ids).toContain(id);
  });
  it.each([
    { rounds: 0, castThisRound: false },
    { rounds: 3, castThisRound: true },
  ])("ignores inactive effects: %j", ({ rounds, castThisRound }) => {
    const battle = fixture();
    battle.usersEffects = [
      makeEffect("elementalseal", { rounds }, { targetId: "caster", castThisRound }),
    ];
    expect(actions(battle).map((action) => action.id)).toContain("fire60");
  });
  it("strips the obsolete element selector from existing tag payloads", () => {
    expect(ElementalSealTag.parse({ elements: ["Earth"] })).not.toHaveProperty(
      "elements",
    );
  });
});

describe("Stealth", () => {
  it("blocks offensive and support jutsu but permits weapons and consumables", () => {
    const battle = fixture();
    battle.usersEffects = [
      makeEffect(
        "stealth",
        { rounds: 3 },
        { targetId: "caster", castThisRound: false },
      ),
    ];
    const available = actions(battle);
    expect(available.filter((action) => action.type === "jutsu")).toEqual([]);
    expect(
      available.filter((action) => action.type === "item").map((action) => action.name),
    ).toEqual(["Regression Weapon", "Pill"]);
  });
  it("preserves disarm and quantity restrictions while stealthed", () => {
    const battle = fixture();
    battle.usersEffects = ["stealth", "disarm"].map((type) =>
      makeEffect(
        type as "stealth" | "disarm",
        { rounds: 3 },
        { targetId: "caster", castThisRound: false },
      ),
    );
    battle.usersState[0]!.items[1]!.quantity = 0;
    expect(actions(battle).filter((action) => action.type === "item")).toEqual([]);
  });
});
