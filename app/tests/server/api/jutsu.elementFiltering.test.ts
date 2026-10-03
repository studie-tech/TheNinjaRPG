import { describe, expect, it } from "vitest";
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

  it("includes tagless classifications and treats null as None", () => {
    const tagless = { ...classified, effects: [] };
    expect(filterByEffectConstraints([tagless], { element: ["Fire"] })).toEqual([
      tagless,
    ]);
    expect(
      filterByEffectConstraints([tagless], { element: ["Fire"], effect: ["heal"] }),
    ).toEqual([]);
    const legacy = { ...tagless, elementClassification: null };
    expect(filterByEffectConstraints([legacy], { element: ["None"] })).toEqual([
      legacy,
    ]);
  });
});
