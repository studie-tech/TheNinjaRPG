import { describe, expect, it } from "bun:test";
import { ElementNames, StatTypes } from "@/drizzle/constants";
import type { Jutsu } from "@/drizzle/schema";
import { getJutsuReskinMechanics, inheritJutsuReskinEffects } from "@/libs/jutsu/reskins";
import { setNullsToEmptyStrings } from "@/utils/typeutils";
import { DamageTag, HealTag, JutsuValidatorRawSchema } from "@/validators/combat";

describe("linked jutsu reskin inheritance", () => {
  it("inherits mechanics while excluding identity, cosmetics and entry-specific links", () => {
    const source = {
      id: "parent", name: "Parent", image: "/parent.png", description: "Parent text",
      battleDescription: "Parent battle text", createdAt: new Date(), updatedAt: new Date(),
      hidden: true, injectableInBattle: true, parentJutsuId: "evolution", reskinParentJutsuId: null,
      bloodlineReskinId: null, jutsuRank: "S", effects: [], cooldown: 12, range: 3,
      requiredNinjutsuMastery: 300, chakraCost: 0.2, statClassification: null,
    } as unknown as Jutsu;
    expect<unknown>(getJutsuReskinMechanics(source)).toEqual({
      cooldown: 12, range: 3, requiredNinjutsuMastery: 300, chakraCost: 0.2,
      statClassification: "None", elementClassification: "None",
    });
  });

  it("normalizes classifications in a parent cached by the manual editor", () => {
    const cachedParent = { statClassification: null, elementClassification: null };
    setNullsToEmptyStrings(cachedParent);
    const inherited = getJutsuReskinMechanics(cachedParent as unknown as Jutsu);
    expect<unknown>(cachedParent).toEqual({ statClassification: "", elementClassification: "" });
    expect(inherited.statClassification).toBe("None");
    expect(inherited.elementClassification).toBe("None");
    expect(
      JutsuValidatorRawSchema.shape.statClassification.parse(inherited.statClassification),
    ).toBe("None");
    expect(
      JutsuValidatorRawSchema.shape.elementClassification.parse(inherited.elementClassification),
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
        getJutsuReskinMechanics({ elementClassification } as Jutsu).elementClassification,
      ).toBe(elementClassification);
    }
  });

  it("pairs reordered and repeated types, replaces power, and preserves all visual fields", () => {
    const first = DamageTag.parse({ power: 2, description: "First", staticAnimation: "first", appearSfx: "first-sound" });
    const second = DamageTag.parse({ power: 3, description: "Second", staticAnimation: "second" });
    const heal = HealTag.parse({ power: 1, description: "Heal cosmetic" });
    const sources = [HealTag.parse({power: 6}), DamageTag.parse({power: 8}), DamageTag.parse({power: 9})];
    const inherited = inheritJutsuReskinEffects(sources, [first, second, heal]);
    expect(inherited.map((tag) => tag.power)).toEqual([6, 8, 9]);
    expect(inherited.map((tag) => tag.description)).toEqual(["Heal cosmetic", "First", "Second"]);
    expect(inherited[1]?.staticAnimation).toBe("first");
    expect(inherited[1]?.appearSfx).toBe("first-sound");
    expect(inherited[2]?.staticAnimation).toBe("second");
    expect(first.power).toBe(2);
  });

  it("drops removed effects and uses parent visuals for newly introduced types", () => {
    const source = HealTag.parse({ power: 5, appearAnimation: "heal", appearSfx: "heal-sound" });
    expect(inheritJutsuReskinEffects([source], [DamageTag.parse({})])).toEqual([source]);
  });
});
