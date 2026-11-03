import { describe, expect, it } from "bun:test";
import { buildJutsuEquipCaps, computeJutsuLoadoutCapAssignments } from "@/libs/jutsu";
import { jutsuEquipLimitSchema } from "@/validators/jutsuEquipLimit";
import { DamageTag, HealTag } from "@/validators/combat";
import type { Jutsu } from "@/drizzle/schema";

describe("configurable equipment limits", () => {
  it("requires both mode values and accepts zero and unlimited independently", () => {
    expect(jutsuEquipLimitSchema.safeParse({ category: "summon", rankedMaxEquipped: 0 }).success).toBe(false);
    const rule = jutsuEquipLimitSchema.parse({ category: "summon", unrankedMaxEquipped: null, rankedMaxEquipped: 0 });
    expect(buildJutsuEquipCaps([rule], "unranked")).toEqual([]);
    expect(buildJutsuEquipCaps([rule], "ranked")[0]?.max).toBe(0);
  });
  it.each([-1, 1.5, Infinity, 2147483648])("rejects invalid limit %s", (limit) => {
    expect(jutsuEquipLimitSchema.safeParse({ category: "heal", unrankedMaxEquipped: limit, rankedMaxEquipped: 1 }).success).toBe(false);
  });
  it("matches arbitrary tags once per jutsu and enforces overlapping caps", () => {
    const caps = buildJutsuEquipCaps([
      { category: "damage", unrankedMaxEquipped: 2, rankedMaxEquipped: 1 },
      { category: "heal", unrankedMaxEquipped: 1, rankedMaxEquipped: 0 },
    ], "unranked");
    const definitions = [
      { id: "a", name: "A", effects: [DamageTag.parse({}), DamageTag.parse({}), HealTag.parse({})] },
      { id: "b", name: "B", effects: [HealTag.parse({})] },
      { id: "c", name: "C", effects: [DamageTag.parse({})] },
    ] as Jutsu[];
    const result = computeJutsuLoadoutCapAssignments({ caps, maxEquip: 15, jutsuIds: ["a", "b", "c"], userjutsus: definitions.map((jutsu) => ({ jutsuId: jutsu.id, jutsu })) });
    expect(result.equipIds).toEqual(["a", "c"]);
    expect(result.invalidJutsus).toHaveLength(1);
  });
  it("preserves effect names for SQL guards", () => {
    const caps = buildJutsuEquipCaps(["increasepoolcost", "pierce"].map((category) => ({ category, unrankedMaxEquipped: 1, rankedMaxEquipped: 1 })), "unranked");
    expect(caps.map((cap) => cap.sql)).toEqual([{ kind: "effect", effectType: "increasepoolcost" }, { kind: "effect", effectType: "pierce" }]);
  });
});
