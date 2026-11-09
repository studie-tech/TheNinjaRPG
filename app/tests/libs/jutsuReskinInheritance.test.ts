import { describe, expect, it } from "bun:test";
import { ElementNames, StatTypes } from "@/drizzle/constants";
import type { Jutsu, UserJutsuWithRelations } from "@/drizzle/schema";
import { userJutsuToAction } from "@/libs/combat/actions";
import type { BattleUserJutsu, CompleteBattle } from "@/libs/combat/types";
import { getReskinnedUserJutsu } from "@/libs/jutsu";
import {
  applyLinkedJutsuReskin,
  getJutsuReskinMechanics,
  inheritJutsuReskinEffects,
} from "@/libs/jutsu/reskins";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { DamageTag, HealTag, JutsuValidatorRawSchema } from "@/validators/combat";

describe("linked jutsu reskin inheritance", () => {
  const base = {
    id: "base",
    bloodlineId: "blood",
    name: "Base",
    image: "/base.png",
    description: "Base description",
    battleDescription: "Base cast",
    hidden: false,
    jutsuRank: "C",
    cooldown: 4,
    chakraCost: 20,
    chakraCostReducePerLvl: 1,
    effects: [DamageTag.parse({ power: 4, staticAnimation: "base-animation" })],
  } as Jutsu;
  const variant = {
    ...base,
    id: "variant",
    reskinParentJutsuId: base.id,
    bloodlineReskinId: "group",
    name: "Scarlet",
    image: "/scarlet.png",
    description: "Scarlet text",
    battleDescription: "Scarlet cast",
    hidden: true,
    jutsuRank: "H",
    cooldown: 999,
    chakraCost: 999,
    effects: [DamageTag.parse({ power: 999, staticAnimation: "scarlet-animation" })],
  } as Jutsu;

  it("keeps reskin animation sizing independent for legacy and scaled tags", () => {
    const normal = DamageTag.parse({});
    const large = DamageTag.parse({ animationScale: 2.5 });
    const legacy = { ...normal };
    delete (legacy as Partial<typeof normal>).animationScale;
    expect(inheritJutsuReskinEffects([legacy], [large])[0]?.animationScale).toBe(2.5);
    expect(inheritJutsuReskinEffects([large], [legacy])[0]?.animationScale).toBe(1);
    expect(inheritJutsuReskinEffects([large], [])[0]?.animationScale).toBe(2.5);
  });
  it("uses linked cosmetics without copying hidden status, rank, identity or mechanics", () => {
    const resolved = applyLinkedJutsuReskin(base, variant);
    expect(resolved).toMatchObject({
      id: "base",
      hidden: false,
      jutsuRank: "C",
      cooldown: 4,
      chakraCost: 20,
      name: "Scarlet",
    });
    expect(resolved.effects[0]).toMatchObject({
      power: 4,
      staticAnimation: "scarlet-animation",
    });
    expect(base.effects[0]?.staticAnimation).toBe("base-animation");
    expect(applyLinkedJutsuReskin(base, null)).toBe(base);
    expect(
      applyLinkedJutsuReskin(base, { ...variant, reskinParentJutsuId: "other" }),
    ).toBe(base);
    expect(applyLinkedJutsuReskin(base, { ...variant, bloodlineId: "other" })).toBe(
      base,
    );
  });

  it("uses personal text and images with linked animations in learned jutsu and combat", () => {
    const owned = {
      id: "owned",
      jutsuId: "base",
      level: 12,
      experience: 55,
      jutsu: base,
      activeReskin: null,
      linkedReskin: variant,
    } as unknown as UserJutsuWithRelations & { linkedReskin: Jutsu };
    expect(getReskinnedUserJutsu(owned)).toMatchObject({
      id: "owned",
      jutsuId: "base",
      level: 12,
      experience: 55,
      jutsu: { name: "Scarlet", hidden: false, jutsuRank: "C" },
    });
    const activeReskin = {
      id: "personal",
      name: "Personal",
      image: "/personal.png",
      description: "Personal description",
      battleDescription: "Personal cast",
    } as NonNullable<typeof owned.activeReskin>;
    const personal = getReskinnedUserJutsu({ ...owned, activeReskin });
    expect(personal).toMatchObject({
      id: "owned",
      jutsuId: "base",
      level: 12,
      experience: 55,
      jutsu: {
        name: "Personal",
        image: "/personal.png",
        description: "Personal description",
        battleDescription: "Personal cast",
        cooldown: 4,
        chakraCost: 20,
      },
    });
    expect(personal.jutsu.effects[0]).toMatchObject({
      power: 4,
      staticAnimation: "scarlet-animation",
    });
    const battle = {
      extraState: {
        jutsus: { base, variant },
        jutsuReskins: { personal: activeReskin },
      },
    } as unknown as CompleteBattle;
    const action = userJutsuToAction(
      {
        jutsuId: "base",
        level: 3,
        originalCooldown: 4,
        linkedReskinId: "variant",
        reskinId: "personal",
      } as BattleUserJutsu,
      battle,
    );
    expect(action).toMatchObject({
      id: "base",
      name: "Personal",
      image: "/personal.png",
      battleDescription: "Personal cast",
      chakraCost: 17,
    });
    expect(action.effects).toEqual(personal.jutsu.effects);
    expect(base.effects[0]?.staticAnimation).toBe("base-animation");
  });

  it("isolates combat cosmetics per owner while retaining base damage and costs", () => {
    const battle = {
      extraState: { jutsus: { base, variant }, jutsuReskins: {} },
    } as unknown as CompleteBattle;
    const owned = {
      jutsuId: "base",
      level: 3,
      originalCooldown: 4,
      linkedReskinId: "variant",
    } as BattleUserJutsu;
    const action = userJutsuToAction(owned, battle);
    expect(action).toMatchObject({
      id: "base",
      name: "Scarlet",
      image: "/scarlet.png",
      chakraCost: 17,
      level: 3,
    });
    expect(action.effects[0]).toMatchObject({
      power: 4,
      staticAnimation: "scarlet-animation",
    });
    expect(userJutsuToAction({ ...owned, linkedReskinId: null }, battle).name).toBe(
      "Base",
    );
    expect(battle.extraState.jutsus.base?.name).toBe("Base");
  });

  it("inherits mechanics while excluding identity, cosmetics and entry-specific links", () => {
    const source = {
      id: "parent",
      name: "Parent",
      image: "/parent.png",
      description: "Parent text",
      battleDescription: "Parent battle text",
      createdAt: new Date(),
      updatedAt: new Date(),
      hidden: true,
      injectableInBattle: true,
      parentJutsuId: "evolution",
      reskinParentJutsuId: null,
      bloodlineReskinId: null,
      jutsuRank: "S",
      effects: [],
      cooldown: 12,
      range: 3,
      requiredNinjutsuMastery: 300,
      chakraCost: 0.2,
      statClassification: null,
    } as unknown as Jutsu;
    expect<unknown>(getJutsuReskinMechanics(source)).toEqual({
      cooldown: 12,
      range: 3,
      requiredNinjutsuMastery: 300,
      chakraCost: 0.2,
      statClassification: "None",
      elementClassification: "None",
    });
  });

  it("normalizes classifications in a parent cached by the manual editor", () => {
    const cachedParent = { statClassification: null, elementClassification: null };
    setNullsToEmptyStrings(cachedParent);
    const inherited = getJutsuReskinMechanics(cachedParent as unknown as Jutsu);
    expect<unknown>(cachedParent).toEqual({
      statClassification: "",
      elementClassification: "",
    });
    expect(inherited.statClassification).toBe("None");
    expect(inherited.elementClassification).toBe("None");
    expect(
      JutsuValidatorRawSchema.shape.statClassification.parse(
        inherited.statClassification,
      ),
    ).toBe("None");
    expect(
      JutsuValidatorRawSchema.shape.elementClassification.parse(
        inherited.elementClassification,
      ),
    ).toBe("None");
  });

  it("preserves every nonempty parent classification", () => {
    for (const statClassification of StatTypes) {
      expect(
        getJutsuReskinMechanics({ statClassification } as Jutsu).statClassification,
      ).toBe(statClassification);
    }
    for (const elementClassification of ElementNames) {
      expect(
        getJutsuReskinMechanics({ elementClassification } as Jutsu)
          .elementClassification,
      ).toBe(elementClassification);
    }
  });

  it("pairs reordered and repeated types, replaces power, and preserves all visual fields", () => {
    const first = DamageTag.parse({
      power: 2,
      description: "First",
      staticAnimation: "first",
      appearSfx: "first-sound",
    });
    const second = DamageTag.parse({
      power: 3,
      description: "Second",
      staticAnimation: "second",
    });
    const heal = HealTag.parse({ power: 1, description: "Heal cosmetic" });
    const sources = [
      HealTag.parse({ power: 6 }),
      DamageTag.parse({ power: 8 }),
      DamageTag.parse({ power: 9 }),
    ];
    const inherited = inheritJutsuReskinEffects(sources, [first, second, heal]);
    expect(inherited.map((tag) => tag.power)).toEqual([6, 8, 9]);
    expect(inherited.map((tag) => tag.description)).toEqual([
      "Heal cosmetic",
      "First",
      "Second",
    ]);
    expect(inherited[1]?.staticAnimation).toBe("first");
    expect(inherited[1]?.appearSfx).toBe("first-sound");
    expect(inherited[2]?.staticAnimation).toBe("second");
    expect(first.power).toBe(2);
  });

  it("drops removed effects and uses parent visuals for newly introduced types", () => {
    const source = HealTag.parse({
      power: 5,
      appearAnimation: "heal",
      appearSfx: "heal-sound",
    });
    expect(inheritJutsuReskinEffects([source], [DamageTag.parse({})])).toEqual([
      source,
    ]);
  });
});
