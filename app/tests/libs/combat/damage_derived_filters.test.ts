import { describe, expect, it } from "bun:test";
import {
  afterburn,
  absorb,
  getEfficiencyRatio,
  lifesteal,
  recoil,
  reflect,
  wound,
} from "@/libs/combat/tags";
import type { Consequence, UserEffect } from "@/libs/combat/types";
import { getStatTypeLabels } from "@/libs/combat/util";
import { getTagSchema } from "@/validators/combat";
import { makeBattleUser, makeDamageEffect, makeEffect } from "../../setup/combat";

const tagTypes = [
  "afterburn",
  "lifesteal",
  "recoil",
  "absorb",
  "reflect",
  "wound",
] as const;

describe("damage-derived tag filters", () => {
  it.each([...tagTypes])(
    "%s strips statTypes while preserving general and element filters",
    (type) => {
      const tag = getTagSchema(type).parse({
        type,
        statTypes: ["Ninjutsu"],
        generalTypes: ["Strength"],
        elements: ["Fire"],
      });
      expect(tag).not.toHaveProperty("statTypes");
      expect(tag).toMatchObject({ generalTypes: ["Strength"], elements: ["Fire"] });
    },
  );

  it.each([...tagTypes])(
    "%s ignores saved stat filters during combat and display",
    (type) => {
      const effect = {
        ...makeEffect(type, { generalTypes: ["Strength"] }),
        statTypes: ["Ninjutsu" as const],
      };
      const damage = makeDamageEffect({
        statTypes: ["Ninjutsu"],
        generalTypes: ["Intelligence"],
      });
      expect(getEfficiencyRatio(damage, effect)).toBe(0);
      expect(getStatTypeLabels(effect)).toEqual([]);
      expect(
        getEfficiencyRatio(makeDamageEffect({ generalTypes: ["Strength"] }), effect),
      ).toBe(1);
    },
  );

  it.each([...tagTypes])(
    "%s matches elemental damage when no filters are selected",
    (type) => {
      expect(
        getEfficiencyRatio(makeDamageEffect({ elements: ["Fire"] }), makeEffect(type)),
      ).toBe(1);
    },
  );

  it.each([...tagTypes])(
    "%s treats elements as a jutsu lock rather than a damage filter",
    (type) => {
      // e.g. Abyssal Surge: absorb tagged Water so only Water users can learn it.
      const effect = {
        ...makeEffect(type, { elements: ["Water"] }),
        statTypes: ["Bukijutsu", "Genjutsu", "Ninjutsu", "Taijutsu"] as const,
      } as unknown as UserEffect;
      for (const elements of [["Water"], ["Fire"], ["None"], []] as const) {
        expect(
          getEfficiencyRatio(makeDamageEffect({ elements: [...elements] }), effect),
        ).toBe(1);
      }
      expect(
        getEfficiencyRatio(
          makeDamageEffect({ elements: ["Fire"] }),
          makeEffect(type, { elements: ["None"] }),
        ),
      ).toBe(1);
    },
  );

  it.each([...tagTypes])("%s keeps general filters alongside elements", (type) => {
    const effect = makeEffect(type, { elements: ["Fire"], generalTypes: ["Strength"] });
    expect(
      getEfficiencyRatio(
        makeDamageEffect({ generalTypes: ["Strength"], elements: ["Wind"] }),
        effect,
      ),
    ).toBe(1);
    expect(
      getEfficiencyRatio(
        makeDamageEffect({ generalTypes: ["Intelligence"], elements: ["Fire"] }),
        effect,
      ),
    ).toBe(0);
    expect(
      getEfficiencyRatio(
        makeEffect("pierce", { generalTypes: ["Intelligence"] }),
        effect,
      ),
    ).toBe(1);
  });

  const derivedDamageCases = [
    ["afterburn", afterburn, "afterburn", "defender"],
    ["lifesteal", lifesteal, "lifesteal_hp", "attacker"],
    ["recoil", recoil, "recoil", "attacker"],
    ["absorb", absorb, "absorb_hp", "defender"],
    ["reflect", reflect, "reflect", "defender"],
  ] as const;
  type DerivedDamageCase = (typeof derivedDamageCases)[number];
  /** What a derived-damage effect locked to `lockElement` takes from a 100-damage Fire hit. */
  const convertedDamage = (
    type: DerivedDamageCase[0],
    handler: DerivedDamageCase[1],
    field: DerivedDamageCase[2],
    targetId: DerivedDamageCase[3],
    lockElement: "Fire" | "Water",
  ) => {
    const damage = makeDamageEffect({ elements: ["Fire"] });
    const effect = makeEffect(
      type,
      { power: 20, elements: [lockElement] },
      { targetId },
    );
    const consequence: Consequence = {
      userId: "attacker",
      targetId: "defender",
      damage: 100,
    };
    handler(
      effect,
      [damage, effect],
      new Map([[damage.id, consequence]]),
      makeBattleUser(targetId),
    );
    return consequence[field];
  };

  it.each(derivedDamageCases)(
    "%s converts damage of any element despite an element lock",
    (type, handler, field, targetId) => {
      expect(convertedDamage(type, handler, field, targetId, "Water")).toBe(20);
    },
  );

  it.each(derivedDamageCases)(
    "%s converts matching damage without statTypes",
    (type, handler, field, targetId) => {
      expect(convertedDamage(type, handler, field, targetId, "Fire")).toBe(20);
    },
  );

  it("wound retains its damage and supported consequence types", () => {
    const effect = {
      ...makeEffect("wound", {
        power: 20,
        rounds: 2,
        elements: ["Fire"],
        generalTypes: ["Strength"],
      }),
      statTypes: ["Ninjutsu" as const],
      timeTracker: { originalDamage: 100 },
    };
    const consequences = new Map<string, Consequence>();
    wound(effect, [], consequences, makeBattleUser("defender"));
    expect(consequences.get(`wound-${effect.id}`)).toEqual({
      userId: "attacker",
      targetId: "defender",
      wound: 20,
      types: ["wound", "Strength", "Fire"],
    });
  });
});

describe("damage modifier selectors", () => {
  it.each([
    "increasedamagegiven",
    "decreasedamagegiven",
    "increasedamagetaken",
    "decreasedamagetaken",
  ] as const)(
    "%s preserves elements and ignores stat and general selectors",
    (type) => {
      const old = {
        ...makeEffect(type),
        statTypes: ["Taijutsu"],
        generalTypes: ["Speed"],
        elements: ["Wind"],
      } as UserEffect;
      const schema = getTagSchema(type);
      expect(schema.parse(old)).not.toHaveProperty("statTypes");
      expect(schema.parse(old)).not.toHaveProperty("generalTypes");
      expect(schema.parse(old)).toHaveProperty("elements", ["Wind"]);
      expect(
        getEfficiencyRatio(
          makeDamageEffect({ statTypes: ["Ninjutsu"], elements: ["Fire"] }),
          old,
        ),
      ).toBe(0);
      expect(
        getEfficiencyRatio(
          makeDamageEffect({ statTypes: ["Ninjutsu"], elements: ["Wind"] }),
          old,
        ),
      ).toBe(1);
      expect(
        getEfficiencyRatio(makeDamageEffect({ elements: ["Fire"] }), makeEffect(type)),
      ).toBe(1);
    },
  );
});
