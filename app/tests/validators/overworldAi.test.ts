import { describe, expect, it } from "vitest";
import { OverworldPlacementSchema } from "@/validators/overworldAi";

describe("OverworldPlacementSchema", () => {
  const base = {
    aiTemplateUserId: "ai-1",
    interactionType: "FRIENDLY" as const,
    sectorType: "specific" as const,
    locationType: "specific" as const,
    sector: 10,
    longitude: 5,
    latitude: 7,
    questGiveChance: 25,
    questIds: ["q1", "q2"],
    sectorList: [],
    isActive: true,
  };

  it("accepts a valid friendly placement", () => {
    expect(OverworldPlacementSchema.parse(base).questGiveChance).toBe(25);
  });

  it("rejects questGiveChance above 100", () => {
    expect(() => OverworldPlacementSchema.parse({ ...base, questGiveChance: 101 })).toThrow();
  });

  it("rejects duplicate quest ids in the pool", () => {
    expect(() =>
      OverworldPlacementSchema.parse({ ...base, questIds: ["q1", "q1"] }),
    ).toThrow();
  });

  it("requires a non-empty sectorList when sectorType is from_list", () => {
    expect(() =>
      OverworldPlacementSchema.parse({ ...base, sectorType: "from_list", sectorList: [] }),
    ).toThrow();
  });

  it("rejects longitude outside the sector grid", () => {
    expect(() => OverworldPlacementSchema.parse({ ...base, longitude: 99 })).toThrow();
  });
});
