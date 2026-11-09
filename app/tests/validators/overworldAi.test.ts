import { describe, expect, it } from "bun:test";
import { MAP_TOTAL_SECTORS } from "@/drizzle/constants";
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

  it("defaults to a five-hex roam, one copy on its own and standard size", () => {
    const parsed = OverworldPlacementSchema.parse(base);
    expect(parsed).toMatchObject({
      wanderRadius: 5,
      spawnCount: 1,
      groupMin: 1,
      groupMax: 1,
      habitats: [],
      wildOnly: false,
      mapScale: 100,
    });
  });

  it("accepts ambient wildlife herds spread over random habitat sectors", () => {
    expect(
      OverworldPlacementSchema.safeParse({
        ...base,
        interactionType: "AMBIENT",
        sectorType: "random",
        locationType: "random",
        spawnCount: 240,
        groupMin: 3,
        groupMax: 5,
        habitats: ["grassland"],
        wildOnly: true,
        mapScale: 75,
      }).success,
    ).toBe(true);
  });

  it("accepts a biome placement with a few groups in every sector of its biomes", () => {
    const biome = {
      ...base,
      interactionType: "AMBIENT",
      sectorType: "biome",
      locationType: "random",
      habitats: ["snow"],
      spawnCount: 2,
    };
    expect(OverworldPlacementSchema.safeParse(biome).success).toBe(true);
  });

  it.each([
    [{ habitats: [] }, "habitats"],
    [{ locationType: "specific" }, "locationType"],
    [{ spawnCount: 5 }, "spawnCount"],
  ])("rejects a biome placement with %p", (patch, path) => {
    const biome = {
      ...base,
      interactionType: "AMBIENT",
      sectorType: "biome",
      locationType: "random",
      habitats: ["grassland"],
      ...patch,
    };
    const result = OverworldPlacementSchema.safeParse(biome);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === path)).toBe(true);
  });

  it.each([
    [{ groupMin: 4, groupMax: 2 }, "groupMin"],
    [{ spawnCount: 3 }, "spawnCount"],
    [{ habitats: ["snow"] }, "habitats"],
    [{ interactionType: "AMBIENT", quests: [{ questId: "q1", chance: 10 }] }, "quests"],
    [{ wanderRadius: 11 }, "wanderRadius"],
    [{ mapScale: 10 }, "mapScale"],
  ])("rejects %p", (patch, path) => {
    const result = OverworldPlacementSchema.safeParse({ ...base, ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === path)).toBe(true);
  });

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

  it("rejects quest pools on hostile placements", () => {
    const result = OverworldPlacementSchema.safeParse({
      ...base,
      interactionType: "HOSTILE",
      quests: [{ questId: "q1", chance: 100 }],
    });
    expect(result.success).toBe(false);
    // The editor renders this message off the `quests` path; if either drifts, the save button
    // goes dead with no visible reason.
    expect(result.error?.issues).toContainEqual(
      expect.objectContaining({
        path: ["quests"],
        message: "Only friendly NPC placements can have a quest pool",
      }),
    );
  });

  it("accepts a hostile placement once its quest pool is cleared", () => {
    expect(
      OverworldPlacementSchema.safeParse({
        ...base,
        interactionType: "HOSTILE",
        quests: [],
      }).success,
    ).toBe(true);
  });

  it("requires a non-empty sectorList when sectorType is from_list", () => {
    expect(() =>
      OverworldPlacementSchema.parse({
        ...base,
        sectorType: "from_list",
        sectorList: [],
      }),
    ).toThrow();
  });

  it("rejects longitude outside the sector grid", () => {
    expect(() => OverworldPlacementSchema.parse({ ...base, longitude: 99 })).toThrow();
  });

  it("rejects a sector at the grid upper bound (MAP_TOTAL_SECTORS)", () => {
    expect(() =>
      OverworldPlacementSchema.parse({ ...base, sector: MAP_TOTAL_SECTORS }),
    ).toThrow();
  });
});
