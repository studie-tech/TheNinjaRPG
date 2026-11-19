import { describe, expect, it } from "bun:test";
import { getBloodrightStats, orderTiersByPrerequisite } from "@/layout/BloodrightTree";
import { DecreasePotencyTag, IncreasePotencyTag, StunTag } from "@/validators/combat";

const tier = (id: string, requiredSkillIds: string[] = []) => ({
  id,
  requiredSkillIds,
});
const ids = (rows: { id: string }[][]) => rows.map((row) => row.map(({ id }) => id));

describe("Bloodright tree ordering", () => {
  it("places each node under its prerequisite", () => {
    const rows = [
      [tier("a1"), tier("b1"), tier("c1")],
      [tier("c2", ["c1"]), tier("a2", ["a1"]), tier("b2", ["b1"])],
      [tier("b3", ["b2"]), tier("c3", ["c2"]), tier("a3", ["a2"])],
    ];
    expect(ids(orderTiersByPrerequisite(rows))).toEqual([
      ["a1", "b1", "c1"],
      ["a2", "b2", "c2"],
      ["a3", "b3", "c3"],
    ]);
  });
  it("centres shared children between prerequisites and keeps unlinked nodes last", () => {
    const rows = [
      [tier("a1"), tier("b1"), tier("c1"), tier("d1")],
      [tier("free"), tier("cd", ["c1", "d1"]), tier("ab", ["a1", "b1"])],
      [tier("skip", ["d1"]), tier("under-ab", ["ab"])],
    ];
    expect(ids(orderTiersByPrerequisite(rows))).toEqual([
      ["a1", "b1", "c1", "d1"],
      ["ab", "cd", "free"],
      ["under-ab", "skip"],
    ]);
  });
});

describe("Bloodright tree stats", () => {
  it("preserves element restrictions and describes element-only potency", () => {
    const effects = [
      IncreasePotencyTag.parse({
        affectedTag: "damage",
        affectedElements: ["Fire"],
        power: 2,
      }),
      IncreasePotencyTag.parse({
        affectedTag: "damage",
        affectedElements: ["Water"],
        power: 2,
      }),
      IncreasePotencyTag.parse({
        affectedTag: "none",
        affectedElements: ["Fire", "Water"],
        power: 3,
      }),
      DecreasePotencyTag.parse({ affectedElements: ["None"], power: 1 }),
      IncreasePotencyTag.parse({ affectedTag: "none", power: 2 }),
    ];
    expect(getBloodrightStats(effects)).toEqual([
      { label: "Damage (Fire)", value: "+2" },
      { label: "Damage (Water)", value: "+2" },
      { label: "All supported tags (Fire, Water)", value: "+3" },
      { label: "All supported tags (Non-elemental)", value: "-1" },
      { label: "None", value: "+2" },
    ]);
  });

  it("lists each potency effect as a signed stat row", () => {
    const effects = [
      IncreasePotencyTag.parse({ affectedTag: "afterburn", power: 2 }),
      IncreasePotencyTag.parse({
        affectedTag: "damage",
        power: 0.25,
        calculation: "percentage",
      }),
      DecreasePotencyTag.parse({ affectedTag: "reflect", power: 3 }),
      StunTag.parse({}),
    ];
    expect(getBloodrightStats(effects)).toEqual([
      { label: "Afterburn", value: "+2" },
      { label: "Damage", value: "+0.25%" },
      { label: "Reflect", value: "-3" },
    ]);
  });
});
