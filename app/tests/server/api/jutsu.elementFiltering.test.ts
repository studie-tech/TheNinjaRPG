
import { describe, expect, it } from "bun:test";
import { filterByEffectConstraints } from "@/server/api/routers/jutsu";
import { makeTag } from "../../libs/combat/helpers/battleScenario";

describe("jutsu element filtering", () => {
  const classified = {
    elementClassification: "Fire" as const,
    effects: [makeTag("damage", { elements: ["Water"] }), makeTag("heal")],
  };

  it("includes matches from classification or tag elements", () => {
    for (const element of ["Fire", "Water"]) {
      expect(filterByEffectConstraints([classified], { element: [element] })).toEqual([
        classified,
      ]);
    }
    expect(filterByEffectConstraints([classified], { element: ["Earth"] })).toEqual([]);
    expect(
      filterByEffectConstraints([classified], { element: ["Fire", "Water"] }),
    ).toEqual([classified]);
  });

  it("keeps tag selection scoped while classification applies to every tag", () => {
    expect(
      filterByEffectConstraints([classified], { element: ["Fire"], effect: ["heal"] }),
    ).toEqual([classified]);
    expect(
      filterByEffectConstraints([classified], { element: ["Water"], effect: ["heal"] }),
    ).toEqual([]);
    expect(
      filterByEffectConstraints([classified], {
        element: ["Fire"],
        effect: ["pierce"],
      }),
    ).toEqual([]);
  });

  it("includes tagless classifications", () => {
    const tagless = { ...classified, effects: [] };
    expect(filterByEffectConstraints([tagless], { element: ["Fire"] })).toEqual([
      tagless,
    ]);
    expect(
      filterByEffectConstraints([tagless], { element: ["Fire"], effect: ["heal"] }),
    ).toEqual([]);
  });

  it.each([null, "None"] as const)(
    "requires explicit None tags for %s classification",
    (elementClassification) => {
      const fire = {
        elementClassification,
        effects: [makeTag("damage", { elements: ["Fire"] })],
      };
      const explicitNone = {
        elementClassification,
        effects: [makeTag("damage", { elements: ["None"] })],
      };
      const empty = {
        elementClassification,
        effects: [makeTag("damage", { elements: [] })],
      };
      const missing = { elementClassification, effects: [makeTag("heal")] };
      const tagless = { elementClassification, effects: [] };
      const rows = [fire, explicitNone, empty, missing, tagless];
      for (const input of [
        { element: ["None"] },
        { element: ["None"], effect: ["damage"] },
      ]) {
        expect(filterByEffectConstraints(rows, input)).toEqual([explicitNone]);
      }
      expect(filterByEffectConstraints(rows, { element: ["Fire"] })).toEqual([fire]);
    },
  );
});
