import { describe, expect, it } from "bun:test";
import { dmgConfig } from "@/libs/combat/constants";
import {
  adjustStats,
  calcDmgModifier,
  damageCalc,
  damageUser,
  decreaseStats,
  getAffected,
  updateStatUsage,
} from "@/libs/combat/tags";
import type { Consequence, UserEffect } from "@/libs/combat/types";
import { getTagSchema } from "@/validators/combat";
import { makeDamageEffect, makeEffect, makeUser } from "../../setup/combat";

describe("unified tag stats", () => {
  it.each([
    "damage",
    "elementaldamage",
    "pierce",
    "increasestat",
    "decreasestat",
    "weakness",
    "timecompression",
    "timedilation",
    "redirection",
    "rob",
  ] as const)("%s strips obsolete selectors from saved content", (type) => {
    const tag = getTagSchema(type).parse({ statTypes: ["Ninjutsu", "Highest"] });
    expect(tag).not.toHaveProperty("statTypes");
  });

  it.each(["offence", "defence", "both", "none"] as const)(
    "applies stat modifiers using only direction %s",
    (direction) => {
      for (const type of ["increasestat", "decreasestat"] as const) {
        const target = makeUser({ offence: 1000, defence: 1000, strength: 1000 });
        const effect = makeEffect(
          type,
          { direction, power: 20, generalTypes: ["Strength"] },
          { isNew: false, castThisRound: false },
        );
        if (type === "decreasestat") decreaseStats(effect, [], target);
        else adjustStats(effect, target);
        const modified = type === "increasestat" ? 1200 : 800;
        expect(target.offence).toBe(
          direction === "offence" || direction === "both" ? modified : 1000,
        );
        expect(target.defence).toBe(
          direction === "defence" || direction === "both" ? modified : 1000,
        );
        expect(target.strength).toBe(modified);
        if (direction !== "none")
          expect(getAffected(effect)).toMatch(/Offence|Defence/);
      }
    },
  );

  it("applies a stat buff without any general selector", () => {
    const target = makeUser({ offence: 1000, defence: 1000 });
    adjustStats(
      makeEffect(
        "increasestat",
        { direction: "offence", power: 10 },
        { isNew: false, castThisRound: false },
      ),
      target,
    );
    expect(target.offence).toBe(1100);
    expect(target.defence).toBe(1000);
  });

  it.each(["damage", "pierce"] as const)(
    "%s formula scales without a selector and ignores saved selectors",
    (type) => {
      const effect = makeEffect(type, { power: 40, generalTypes: [] });
      const origin = makeUser({ offence: 1000 });
      const target = makeUser({ defence: 1000 });
      const equal = damageCalc(effect, origin, target, dmgConfig);
      origin.offence = 4000;
      const stronger = damageCalc(effect, origin, target, dmgConfig);
      expect(stronger).toBeGreaterThan(equal);
      for (const statTypes of [[], ["Ninjutsu"], ["None"], ["Highest"]]) {
        const savedEffect = { ...effect, statTypes };
        expect(damageCalc(savedEffect, origin, target, dmgConfig)).toBe(stronger);
      }
      target.defence = 4000;
      expect(damageCalc(effect, origin, target, dmgConfig)).toBeCloseTo(equal);
    },
  );

  it.each([
    "damage",
    "elementaldamage",
    "pierce",
    "increasestat",
    "decreasestat",
  ] as const)("%s attributes unified stats without a selector", (type) => {
    const user = makeUser();
    user.usedStats = { offence: 0, defence: 0 };
    const effect = makeEffect(type, { direction: "offence" });
    updateStatUsage(user, effect);
    updateStatUsage(user, effect, true);
    expect(user.usedStats).toEqual({ offence: 1, defence: 1 });
  });

  it("weakness only matches supported selectors", () => {
    const target = makeUser({ userId: "defender" });
    const damage = makeEffect(
      "damage",
      { elements: ["Fire"], generalTypes: ["Strength"] },
      { actionId: "hit" },
    );
    const legacy = {
      ...makeEffect("weakness", { dmgModifier: 2 }, { targetId: "defender" }),
      statTypes: ["Ninjutsu"],
    };
    expect(
      calcDmgModifier(damage as UserEffect & { type: "damage" }, target, [legacy]),
    ).toBe(1);
    for (const fields of [
      { elements: ["Fire" as const] },
      { generalTypes: ["Strength" as const] },
      { jutsus: ["hit"] },
      { items: ["hit"] },
    ]) {
      const weakness = makeEffect(
        "weakness",
        { ...fields, dmgModifier: 2 },
        { targetId: "defender" },
      );
      expect(
        calcDmgModifier(damage as UserEffect & { type: "damage" }, target, [weakness]),
      ).toBe(2);
    }
  });

  it("damage consequences omit saved jutsu-category selectors", () => {
    const damage = {
      ...makeDamageEffect({ calculation: "static", power: 20, rounds: 0 }),
      statTypes: ["Ninjutsu"],
    };
    const consequences = new Map<string, Consequence>();
    damageUser(damage, makeUser(), makeUser(), consequences, 1, dmgConfig);
    expect(consequences.get(damage.id)?.types).not.toContain("Ninjutsu");
  });
});
