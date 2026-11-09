import { describe, expect, it } from "bun:test";
import {
  type BasicElement,
  BasicElementName,
  type BattleType,
} from "@/drizzle/constants";
import { availableUserActions, insertAction } from "@/libs/combat/actions";
import { computeDamagePacket } from "@/libs/combat/damagePipeline";
import {
  getPreferredDamageElement,
  resolveElementalDamage,
} from "@/libs/combat/elementalDamage";
import { resolvePotencyTags } from "@/libs/combat/potency";
import { clone, realizeTag } from "@/libs/combat/tags";
import type {
  BattleUserJutsu,
  CombatQueryUser,
  GroundEffect,
  UserEffect,
} from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import { ElementalDamageTag, JutsuValidatorRawSchema } from "@/validators/combat";
import { updateUserPreferencesSchema } from "@/validators/user";
import {
  makeBattleUser,
  makeCompleteBattle,
  makeEffect,
  makeJutsu,
  makeTag,
} from "../../setup/combat";
import { makeCombatQueryUser, preloadBattle } from "./helpers/preload";

const sourceUser = (patch: Partial<CombatQueryUser> = {}): CombatQueryUser =>
  makeCombatQueryUser("caster", {
    primaryElement: "Fire",
    preferredDamageElement: null,
    ...patch,
  });
const preload = (
  user: CombatQueryUser,
  battleType: BattleType = "COMBAT",
  isSummon = false,
) => preloadBattle([user], { battleType, isSummon });
const owned: BattleUserJutsu = {
  id: "owned",
  jutsuId: "elemental-jutsu",
  level: 1,
  experience: 0,
  equipped: true,
  lastUsedRound: -10,
  originalCooldown: 0,
  origin: "user",
};
/** Share one catalog entry between actors with independent damage preferences. */
const fixture = (element: BasicElement = "Wind") => {
  const jutsu = makeJutsu({
    id: owned.jutsuId,
    name: "Elemental strike",
    elementClassification: "None",
    actionCostPerc: 60,
    effects: [
      ElementalDamageTag.parse({ power: 100, calculation: "static", rounds: 3 }),
    ],
    range: 3,
    target: "OPPONENT",
  });
  const caster = makeBattleUser("caster", {
    rank: "JONIN",
    direction: "left",
    preferredDamageElement: element,
    primaryElement: "Fire",
    isAi: false,
    jutsus: [owned],
    longitude: 0,
    latitude: 0,
  });
  const target = makeBattleUser("target", {
    direction: "right",
    preferredDamageElement: "Water",
    longitude: 1,
    latitude: 0,
  });
  const battle = makeCompleteBattle({
    usersState: [caster, target],
    width: 5,
    height: 5,
    createdAt: new Date(0),
    extraState: { jutsus: { [jutsu.id]: jutsu } },
  });
  return { jutsu, caster, target, battle };
};

describe("elemental damage preference", () => {
  it.each([...BasicElementName])(
    "accepts freely chosen %s without changing innate elements",
    (element) => {
      expect(
        updateUserPreferencesSchema.parse({ preferredDamageElement: element }),
      ).toEqual({ preferredDamageElement: element });
      expect(
        getPreferredDamageElement({
          primaryElement: "Fire",
          preferredDamageElement: element,
        }),
      ).toBe(element);
    },
  );
  it("rejects advanced elements and handles missing innate elements with a basic default", () => {
    for (const element of ["Ice", "None", "Highest"]) {
      expect(
        updateUserPreferencesSchema.safeParse({ preferredDamageElement: element })
          .success,
      ).toBe(false);
    }
    expect(getPreferredDamageElement({ primaryElement: "Water" })).toBe("Water");
    for (const primaryElement of ["Ice", "None", null] as const) {
      expect(getPreferredDamageElement({ primaryElement })).toBe(BasicElementName[0]);
    }
    expect(
      updateUserPreferencesSchema.parse({ preferredDamageElement: null })
        .preferredDamageElement,
    ).toBeNull();
  });
  it.each(["COMBAT", "RANKED_PVP", "RANKED_SPARRING"] as const)(
    "snapshots the preference in %s before bloodline changes",
    async (type) => {
      const source = sourceUser({ preferredDamageElement: "Wind" });
      source.bloodline = {
        id: "bloodline",
        effects: [makeTag("increasedamagegiven", { elements: ["Water"] })],
      } as NonNullable<CombatQueryUser["bloodline"]>;
      const result = await preload(source, type);
      source.preferredDamageElement = "Earth";
      expect(result.usersState[0]?.preferredDamageElement).toBe("Wind");
      expect(
        resolveElementalDamage(ElementalDamageTag.parse({}), result.usersState[0]!)
          .elements,
      ).toEqual(["Wind"]);
    },
  );
  it("defaults AI and summons to their own innate element", async () => {
    for (const isSummon of [false, true]) {
      const result = await preload(
        sourceUser({ isAi: true, primaryElement: "Lightning" }),
        "COMBAT",
        isSummon,
      );
      expect(result.usersState[0]?.preferredDamageElement).toBe("Lightning");
    }
  });
  it("clones resolve their own innate default rather than the controller's preference", () => {
    const { caster, battle } = fixture("Wind");
    const effect = makeEffect(
      "clone",
      { power: 50, rounds: 3 },
      { creatorId: caster.userId, isNew: true },
    );
    clone(
      battle.usersState,
      { ...effect, longitude: 2, latitude: 0 } as GroundEffect,
      battle.extraState,
    );
    expect(
      battle.usersState.find((user) => !user.isOriginal)?.preferredDamageElement,
    ).toBe("Fire");
  });
});

describe("elemental damage authoring and combat", () => {
  it("shares damage controls, removes fixed elements and supports derived damage tags", () => {
    expect(ElementalDamageTag.parse({ elements: ["Ice"] })).not.toHaveProperty(
      "elements",
    );
    const schema = JutsuValidatorRawSchema.shape.effects;
    for (const tag of [
      makeTag("wound"),
      makeTag("vamp"),
      makeTag("consume", { rounds: 0 }),
    ]) {
      expect(schema.safeParse([ElementalDamageTag.parse({}), tag]).success).toBe(true);
    }
  });
  it("resolves one shared catalog effect separately for each actor without changing it", () => {
    const { jutsu, caster, target, battle } = fixture();
    target.jutsus = [owned];
    for (const actor of [caster, target]) {
      const action = availableUserActions(battle, actor.userId).find(
        (action) => action.id === jutsu.id,
      )!;
      expect(action.effects[0]).toMatchObject({
        type: "damage",
        elements: [actor.preferredDamageElement!],
      });
    }
    expect(jutsu.effects[0]?.type).toBe("elementaldamage");
    expect(jutsu.effects[0]).not.toHaveProperty("elements");
  });
  it("applies damage potency to the resolved element", () => {
    const { jutsu, caster, battle } = fixture();
    const action = availableUserActions(battle, caster.userId).find(
      (action) => action.id === jutsu.id,
    )!;
    for (const [element, expected] of [
      ["Wind", 150],
      ["Fire", 100],
    ] as const) {
      const potency = makeEffect(
        "increasepotency",
        { power: 50, affectedTag: "damage", affectedElements: [element] },
        { targetId: caster.userId },
      );
      expect(resolvePotencyTags(action, [potency], caster.userId)[0]?.power).toBe(
        expected,
      );
    }
  });
  it("Elemental Seal blocks 60 AP elemental damage jutsu with no catalog classification", () => {
    const { jutsu, caster, battle } = fixture();
    battle.usersEffects = [
      makeEffect("elementalseal", { rounds: 3 }, { targetId: caster.userId }),
    ];
    expect(
      availableUserActions(battle, caster.userId).some(
        (action) => action.id === jutsu.id,
      ),
    ).toBe(false);
    jutsu.actionCostPerc = 40;
    expect(
      availableUserActions(battle, caster.userId).some(
        (action) => action.id === jutsu.id,
      ),
    ).toBe(true);
  });
  it("inserts ordinary damage before barriers and preserves the original caster's element on later ticks", () => {
    const { jutsu, caster, battle } = fixture();
    const action = availableUserActions(battle, caster.userId).find(
      (action) => action.id === jutsu.id,
    )!;
    expect(
      insertAction({
        battle,
        grid: getBattleGrid(1, battle),
        action,
        actorId: caster.userId,
        longitude: 1,
        latitude: 0,
      }),
    ).toBe(true);
    caster.preferredDamageElement = "Earth";
    expect(
      battle.usersEffects.find((effect) => effect.type === "damage"),
    ).toMatchObject({ creatorId: caster.userId, elements: ["Wind"], rounds: 3 });
    expect(
      battle.usersEffects.some((effect) => effect.type === "elementaldamage"),
    ).toBe(false);
  });
  it("realizes passive elemental damage and respects matching bloodline boosts and enemy reductions", () => {
    const { caster } = fixture();
    const damageEffect = {
      ...realizeTag({
        tag: makeEffect("elementaldamage"),
        user: caster,
        actionId: "passive",
        level: 1,
      }),
      targetId: "target",
      isNew: false,
      castThisRound: false,
    } as UserEffect;
    const packet = (usersEffects: UserEffect[]) =>
      computeDamagePacket({
        rawDamage: 1000,
        damageEffect,
        usersEffects,
        attackerId: caster.userId,
        defenderId: "target",
        battleRound: 1,
        preBattleGearModifiers: {},
      }).damage;
    expect(damageEffect).toMatchObject({ type: "damage", elements: ["Wind"] });
    const boost = makeEffect(
      "increasedamagegiven",
      { power: 50, elements: ["Wind"], calculation: "percentage" },
      { targetId: caster.userId, fromType: "bloodline" },
    );
    const reduction = makeEffect(
      "decreasedamagetaken",
      { power: 20, elements: ["Wind"], calculation: "percentage" },
      { targetId: "target" },
    );
    expect(packet([boost])).toBeCloseTo(packet([]) * 1.5);
    expect(packet([reduction])).toBeLessThan(packet([]));
    expect(packet([{ ...boost, elements: ["Fire"] }])).toBeCloseTo(packet([]));
  });
});
