import { describe, expect, it } from "bun:test";
import { ElementNames, type ElementName } from "@/drizzle/constants";
import type { Jutsu } from "@/drizzle/schema";
import {
  availableUserActions,
  getActionPointCost,
  userJutsuToAction,
} from "@/libs/combat/actions";
import { resolvePotencyTags } from "@/libs/combat/potency";
import type { BattleUserJutsu } from "@/libs/combat/types";
import { SAGE_MODE_ACTIVATION_JUTSU } from "@/libs/sageMode";
import { canTrainJutsu, canUseJutsu, checkJutsuElements } from "@/libs/train";
import type { UserWithRelations } from "@/server/api/routers/profile";
import {
  makeBattleUser,
  makeCompleteBattle,
  makeEffect,
  makeTag,
} from "./helpers/battleScenario";

const fixture = (elementClassification: ElementName | null = "Fire") => {
  const jutsu: Jutsu = {
    ...SAGE_MODE_ACTIVATION_JUTSU,
    id: "classified-jutsu",
    hidden: false,
    elementClassification,
    effects: [
      makeTag("damage", { elements: ["Water"], power: 40, powerPerLevel: 1 }),
      makeTag("heal", { power: 40, powerPerLevel: 1 }),
      makeTag("decreaseheal", { power: 40 }),
    ],
    actionCostPerc: 40,
  };
  const owned: BattleUserJutsu = {
    id: "owned",
    jutsuId: jutsu.id,
    level: 10,
    equipped: true,
    experience: 0,
    lastUsedRound: -10,
    originalCooldown: 0,
    origin: "user",
  };
  const battle = makeCompleteBattle({
    round: 2,
    usersState: [makeBattleUser("caster", { jutsus: [owned] })],
    extraState: { jutsus: { [jutsu.id]: jutsu } },
  });
  return { jutsu, battle, action: userJutsuToAction(owned, battle) };
};

describe("classification potency", () => {
  it.each(ElementNames.filter((element) => element !== "None"))(
    "matches preloaded %s classification",
    (element) => {
      const { action } = fixture(element);
      const effect = makeEffect(
        "increasepotency",
        {
          affectedTag: "none",
          affectedElements: [element],
          power: 20,
          powerPerLevel: 0,
          calculation: "static",
        },
        { targetId: "caster" },
      );
      const tags = resolvePotencyTags(action, [effect], "caster");
      expect(tags.map((tag) => tag.power)).toEqual([70, 70, 40]);
      expect(tags.slice(0, 2).map((tag) => tag.powerPerLevel)).toEqual([0, 0]);
      expect(action.effects[0]?.power).toBe(40);
    },
  );

  it.each([
    ["increasepotency", "static", 70],
    ["decreasepotency", "static", 30],
    ["increasepotency", "percentage", 60],
    ["decreasepotency", "percentage", 40],
  ] as const)("handles %s %s", (type, calculation, expected) => {
    const { action } = fixture();
    const effect = makeEffect(
      type,
      {
        affectedTag: "all",
        affectedElements: ["Fire", "Water"],
        calculation,
        power: 10,
        powerPerLevel: 1,
      },
      { targetId: "caster", level: 10 },
    );
    expect(
      resolvePotencyTags(action, [effect], "caster").map((tag) => tag.power),
    ).toEqual([expected, expected, 40]);
  });

  it.each([
    ["Fire", "damage", [70, 40, 40]],
    ["Water", "all", [70, 40, 40]],
    ["Earth", "all", [40, 40, 40]],
    ["Fire", "heal", [40, 70, 40]],
  ] as const)("combines %s with %s selection", (element, affectedTag, expected) => {
    const { action } = fixture();
    const effect = makeEffect(
      "increasepotency",
      {
        affectedTag,
        affectedElements: [element],
        power: 20,
        powerPerLevel: 0,
        calculation: "static",
      },
      { targetId: "caster" },
    );
    expect(
      resolvePotencyTags(action, [effect], "caster").map((tag) => tag.power),
    ).toEqual<typeof expected>(expected);
  });

  it.each([null, "None"] as const)(
    "matches only non-elemental tags for unclassified %s jutsu",
    (classification) => {
      const { action } = fixture(classification);
      const effect = makeEffect(
        "increasepotency",
        {
          affectedTag: "all",
          affectedElements: ["None"],
          power: 20,
          powerPerLevel: 0,
          calculation: "static",
        },
        { targetId: "caster" },
      );
      expect(
        resolvePotencyTags(action, [effect], "caster").map((tag) => tag.power),
      ).toEqual([40, 70, 40]);
    },
  );
});

describe("classification combat restrictions", () => {
  it.each([null, "None"] as const)(
    "does not infer None elements from %s classification",
    (classification) => {
      for (const tagElements of [["Water"], ["None"], [], undefined] as const) {
        const { jutsu, battle } = fixture(classification);
        jutsu.effects = tagElements
          ? [makeTag("damage", { elements: [...tagElements] })]
          : SAGE_MODE_ACTIVATION_JUTSU.effects;
        const owned = battle.usersState[0]!.jutsus[0]!;
        const action = userJutsuToAction(owned, battle);
        const matches = tagElements?.[0] === "None";
        for (const type of ["timecompression", "timedilation"] as const) {
          battle.usersEffects = [
            makeEffect(
              type,
              { elements: ["None"], rounds: 3 },
              { targetId: "caster", castThisRound: false },
            ),
          ];
          expect(getActionPointCost("caster", battle, action)).toBe(
            40 + (matches ? (type === "timecompression" ? 10 : -10) : 0),
          );
        }
        battle.usersEffects = [
          makeEffect(
            "elementalseal",
            { rounds: 3 },
            { targetId: "caster", castThisRound: false },
          ),
        ];
        expect(
          availableUserActions(battle, "caster").some(
            (candidate) => candidate.id === action.id,
          ),
        ).toBe(true);
      }
    },
  );

  it.each(["Fire", "Water", "Earth", "None"] as const)(
    "matches temporal effects and seals against %s",
    (element) => {
      const { battle, action } = fixture();
      for (const type of ["timecompression", "timedilation"] as const) {
        battle.usersEffects = [
          makeEffect(
            type,
            { elements: [element], rounds: 3 },
            { targetId: "caster", castThisRound: false },
          ),
        ];
        const matches = element === "Fire" || element === "Water";
        expect(getActionPointCost("caster", battle, action)).toBe(
          40 + (matches ? (type === "timecompression" ? 10 : -10) : 0),
        );
      }
      battle.usersEffects = [
        makeEffect(
          "elementalseal",
          { rounds: 3 },
          { targetId: "caster", castThisRound: false },
        ),
      ];
      expect(
        availableUserActions(battle, "caster").some(
          (candidate) => candidate.id === action.id,
        ),
      ).toBe(true);
    },
  );
});

describe("classification equip and training requirements", () => {
  it.each(ElementNames.filter((element) => element !== "None"))(
    "requires ownership of %s",
    (element) => {
      const { jutsu } = fixture(element);
      jutsu.effects = [makeTag("heal")];
      const user = {
        rank: "CHUNIN",
        level: 100,
        isAi: false,
        primaryElement: null,
        secondaryElement: null,
      } as NonNullable<UserWithRelations>;
      expect(checkJutsuElements(jutsu, new Set(["None"]))).toBeFalsy();
      expect(canUseJutsu(jutsu, user)).toBe(false);
      expect(canTrainJutsu(jutsu, user)).toBe(false);
      user.primaryElement = element;
      expect(checkJutsuElements(jutsu, new Set([element, "None"]))).toBeTruthy();
      expect(canUseJutsu(jutsu, user)).toBe(true);
      expect(canTrainJutsu(jutsu, user)).toBe(true);
    },
  );

  it("retains tag requirements and cannot bypass classification via a matching tag", () => {
    const { jutsu } = fixture();
    expect(checkJutsuElements(jutsu, new Set(["Water", "None"]))).toBeFalsy();
    expect(checkJutsuElements(jutsu, new Set(["Fire", "None"]))).toBeFalsy();
    expect(checkJutsuElements(jutsu, new Set(["Fire", "Water", "None"]))).toBeTruthy();
    jutsu.elementClassification = null;
    expect(checkJutsuElements(jutsu, new Set(["Water", "None"]))).toBeTruthy();
    jutsu.effects = [makeTag("heal")];
    expect(checkJutsuElements(jutsu, new Set(["None"]))).toBeTruthy();
  });
});
