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
    sectorList: [],
    isActive: true,
  };

  it("accepts per-quest chances summing to <= 100", () => {
    expect(
      OverworldPlacementSchema.safeParse({
        ...base,
        quests: [
          { questId: "q1", chance: 50 },
          { questId: "q2", chance: 20 },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects chances summing to > 100", () => {
    expect(
      OverworldPlacementSchema.safeParse({
        ...base,
        quests: [
          { questId: "q1", chance: 60 },
          { questId: "q2", chance: 60 },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate questIds", () => {
    expect(
      OverworldPlacementSchema.safeParse({
        ...base,
        quests: [
          { questId: "q1", chance: 10 },
          { questId: "q1", chance: 10 },
        ],
      }).success,
    ).toBe(false);
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
