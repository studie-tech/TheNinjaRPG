import { describe, expect, it } from "bun:test";
import {
  abilityFields,
  abilityIssues,
  type DraftAbility,
  draftAbility,
  parsedAbility,
  withAbilityField,
} from "@/libs/kessen/abilityEditor";
import { KESSEN_ABILITY_KINDS } from "@/validators/itemCard";
import { KESSEN_SEED_CATALOG } from "./fixtures/catalog";

const seeded = KESSEN_SEED_CATALOG.flatMap((card) =>
  card.abilities.map((ability) => ({ name: card.name, ability })),
);

describe("Kessen ability editor fields", () => {
  it("covers every field the seeded cards store", () => {
    expect(seeded.length).toBeGreaterThan(80);
    for (const { name, ability } of seeded) {
      const known = ["k", ...abilityFields(ability.k).map((field) => field.name)];
      expect({
        name,
        unknown: Object.keys(ability).filter((k) => !known.includes(k)),
      }).toEqual({ name, unknown: [] });
    }
  });

  it("offers every stored value of the seeded cards", () => {
    for (const { ability } of seeded) {
      expect(abilityIssues(ability)).toEqual({ fields: {}, entry: [] });
      const stored: DraftAbility = ability;
      for (const field of abilityFields(ability.k)) {
        const value = stored[field.name];
        if (field.type === "option")
          expect(field.options.map((option) => option.value)).toContain(
            value as string,
          );
        if (field.type === "flag") expect([undefined, field.value]).toContain(value);
      }
    }
  });

  it("round-trips every seeded ability through a change of each field", () => {
    for (const { ability } of seeded) {
      const stored: DraftAbility = ability;
      let edited = stored;
      for (const field of abilityFields(ability.k)) {
        edited = withAbilityField(edited, field.name, "changed");
        edited = withAbilityField(edited, field.name, stored[field.name]);
      }
      expect(edited).toEqual(stored);
      expect(Object.keys(edited).sort()).toEqual(Object.keys(stored).sort());
      expect(parsedAbility(edited)).toEqual(ability);
    }
  });

  it("starts every verb as a valid ability", () => {
    for (const kind of KESSEN_ABILITY_KINDS)
      expect(parsedAbility(draftAbility(kind, { set: "Crew" }))).toMatchObject({
        k: kind,
      });
  });
});

describe("ability drafts", () => {
  it("keeps the values the new verb accepts and drops the rest", () => {
    const strike = { k: "strike", x: 4, mode: "allEnemies", sameTarget: true };
    expect(draftAbility("empower", { from: strike })).toEqual({
      k: "empower",
      x: 4,
      mode: "single",
    });
    expect(
      draftAbility("purge", { from: { k: "strike", x: 4, mode: "chosenRow" } }),
    ).toEqual({
      k: "purge",
      mode: "chosenRow",
    });
    expect(draftAbility("clearSkies", { from: strike })).toEqual({ k: "clearSkies" });
  });

  it("removes an optional field without leaving an empty value", () => {
    const revive = withAbilityField({ k: "revive", times: 2 }, "times", undefined);
    expect(revive).toEqual({ k: "revive" });
    expect("times" in revive).toBe(false);
  });

  it("reports problems by field and for the whole entry", () => {
    expect(abilityIssues({ k: "strike", x: Number.NaN, mode: "single" })).toEqual({
      fields: { x: "Use 1 to 20" },
      entry: [],
    });
    expect(abilityIssues({ k: "bond", group: " " }).fields.group).toContain("set name");
    expect(abilityIssues({ k: "vanish" }).entry).toEqual(["Choose an ability"]);
    expect(abilityIssues({ k: "rally", x: 1, mode: "single" }).entry).toHaveLength(1);
  });
});
