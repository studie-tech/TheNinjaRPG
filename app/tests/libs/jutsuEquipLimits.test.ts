import { describe, expect, it } from "bun:test";
import { buildJutsuEquipCaps, computeJutsuLoadoutCapAssignments } from "@/libs/jutsu";
import { jutsuEquipLimitSchema } from "@/validators/jutsuEquipLimit";
import { DamageTag, HealTag } from "@/validators/combat";
import type { Jutsu } from "@/drizzle/schema";
import { makeJutsu } from "./combat/helpers/battleScenario";

describe("configurable equipment limits", () => {
  it("limits only exact 40 AP costs, preserves order, and supports overrides", () => {
    const definitions = Array.from({ length: 10 }, (_, index) => makeJutsu({
      id: `j${index}`, name: `Jutsu ${index}`,
      actionCostPerc: index === 8 ? 60 : 40,
    }));
    const select = (limit: number | null, mode: "ranked" | "unranked") =>
      computeJutsuLoadoutCapAssignments({
        caps: buildJutsuEquipCaps([{ category: "40 AP", unrankedMaxEquipped: limit, rankedMaxEquipped: limit }], mode),
        maxEquip: 15,
        jutsuIds: definitions.map((jutsu) => jutsu.id),
        userjutsus: definitions.map((jutsu) => ({ jutsuId: jutsu.id, jutsu })),
      });
    for (const mode of ["ranked", "unranked"] as const) {
      expect(select(8, mode).equipIds).toEqual(definitions.slice(0, 9).map((jutsu) => jutsu.id));
      expect(select(2, mode).equipIds).toEqual(["j0", "j1", "j8"]);
      expect(select(0, mode).equipIds).toEqual(["j8"]);
      expect(select(null, mode).equipIds).toHaveLength(10);
    }
    expect(jutsuEquipLimitSchema.safeParse({ category: "40 AP", unrankedMaxEquipped: 8, rankedMaxEquipped: 8 }).success).toBe(true);
  });
  it("requires both mode values and accepts zero and unlimited independently", () => {
    expect(
      jutsuEquipLimitSchema.safeParse({ category: "summon", rankedMaxEquipped: 0 })
        .success,
    ).toBe(false);
    const rule = jutsuEquipLimitSchema.parse({
      category: "summon",
      unrankedMaxEquipped: null,
      rankedMaxEquipped: 0,
    });
    expect(buildJutsuEquipCaps([rule], "unranked")).toEqual([]);
    expect(buildJutsuEquipCaps([rule], "ranked")[0]?.max).toBe(0);
  });
  it.each([-1, 1.5, Infinity, 2147483648])("rejects invalid limit %s", (limit) => {
    expect(
      jutsuEquipLimitSchema.safeParse({
        category: "heal",
        unrankedMaxEquipped: limit,
        rankedMaxEquipped: 1,
      }).success,
    ).toBe(false);
  });
  it("matches arbitrary tags once per jutsu and enforces overlapping caps", () => {
    const caps = buildJutsuEquipCaps(
      [
        { category: "damage", unrankedMaxEquipped: 2, rankedMaxEquipped: 1 },
        { category: "heal", unrankedMaxEquipped: 1, rankedMaxEquipped: 0 },
      ],
      "unranked",
    );
    const definitions = [
      {
        id: "a",
        name: "A",
        effects: [DamageTag.parse({}), DamageTag.parse({}), HealTag.parse({})],
      },
      { id: "b", name: "B", effects: [HealTag.parse({})] },
      { id: "c", name: "C", effects: [DamageTag.parse({})] },
    ] as Jutsu[];
    const result = computeJutsuLoadoutCapAssignments({
      caps,
      maxEquip: 15,
      jutsuIds: ["a", "b", "c"],
      userjutsus: definitions.map((jutsu) => ({ jutsuId: jutsu.id, jutsu })),
    });
    expect(result.equipIds).toEqual(["a", "c"]);
    expect(result.invalidJutsus).toHaveLength(1);
  });
  it("preserves effect names for SQL guards", () => {
    const caps = buildJutsuEquipCaps(
      ["increasepoolcost", "pierce"].map((category) => ({
        category,
        unrankedMaxEquipped: 1,
        rankedMaxEquipped: 1,
      })),
      "unranked",
    );
    expect(caps.map((cap) => cap.sql)).toEqual([
      { kind: "effect", effectType: "increasepoolcost" },
      { kind: "effect", effectType: "pierce" },
    ]);
  });
});
