import { describe, expect, it } from "vitest";
import {
  canMarkFishingSchool,
  fishingHexDistance,
  getFishingCue,
  getFishingEquipment,
  getFishingTogetherBonus,
  getMovingSchoolPosition,
  hasFishingCastPositionChanged,
  isFishingEquipmentAvailable,
  isRecentFishingInteraction,
  isValidFishingHabitatTiles,
  resolveFishingAction,
  selectFishingSpecies,
} from "@/libs/fishing";

describe("fishing habitat tile rules", () => {
  it("accepts connected water with a reachable bank", () =>
    expect(
      isValidFishingHabitatTiles({
        centerIsWater: true,
        hasReachableBank: true,
        connectedWater: true,
      }),
    ).toBe(true));
  it("rejects a land center", () =>
    expect(
      isValidFishingHabitatTiles({
        centerIsWater: false,
        hasReachableBank: true,
        connectedWater: true,
      }),
    ).toBe(false));
  it("rejects an absent, blocked, or non-water bank", () =>
    expect(
      isValidFishingHabitatTiles({
        centerIsWater: true,
        hasReachableBank: false,
        connectedWater: true,
      }),
    ).toBe(false));
  it("rejects disconnected water bodies", () =>
    expect(
      isValidFishingHabitatTiles({
        centerIsWater: true,
        hasReachableBank: true,
        connectedWater: false,
      }),
    ).toBe(false));
});

describe("fishing casting range", () => {
  it("accepts an odd-q neighbor", () =>
    expect(fishingHexDistance({ x: 4, y: 4 }, { x: 5, y: 4 })).toBe(1));
  it("rejects an out-of-range bank", () =>
    expect(fishingHexDistance({ x: 0, y: 0 }, { x: 4, y: 4 })).toBeGreaterThan(1));
});

describe("fishing selection and line movement", () => {
  const eligible = [
    {
      id: "a",
      itemId: "a",
      name: "A",
      habitat: "River",
      rarity: "Common" as const,
      behavior: "CAUTIOUS" as const,
      minLevel: 1,
      experience: 1,
    },
    {
      id: "b",
      itemId: "b",
      name: "B",
      habitat: "River",
      rarity: "Common" as const,
      behavior: "CAUTIOUS" as const,
      minLevel: 1,
      experience: 1,
    },
  ];
  it("uses tracking as a preference without making it a guaranteed choice", () => {
    expect(selectFishingSpecies(eligible, "a", "seed")).toBeDefined();
    const selections = Array.from(
      { length: 100 },
      (_, index) => selectFishingSpecies(eligible, "a", String(index))?.id,
    );
    expect(selections).toContain("a");
    expect(selections).toContain("b");
  });
  it("interrupts a line when the player changes sector or bank coordinates", () => {
    const session = { sector: 2, castLongitude: 4, castLatitude: 5 };
    expect(
      hasFishingCastPositionChanged(session, { sector: 2, longitude: 4, latitude: 5 }),
    ).toBe(false);
    expect(
      hasFishingCastPositionChanged(session, { sector: 3, longitude: 4, latitude: 5 }),
    ).toBe(true);
    expect(
      hasFishingCastPositionChanged(session, { sector: 2, longitude: 5, latitude: 5 }),
    ).toBe(true);
  });
});

describe("Fishing Together", () => {
  it("caps the per-other bonus at 15 percent", () => {
    expect(getFishingTogetherBonus(1)).toBe(0);
    expect(getFishingTogetherBonus(2)).toBe(3);
    expect(getFishingTogetherBonus(6)).toBe(15);
    expect(getFishingTogetherBonus(20)).toBe(15);
  });
  it("expires stale interaction and enforces school-mark cooldown", () => {
    const now = new Date("2026-01-01T00:01:00Z");
    expect(isRecentFishingInteraction(new Date("2026-01-01T00:00:00Z"), now)).toBe(
      true,
    );
    expect(isRecentFishingInteraction(new Date("2025-12-31T23:59:59Z"), now)).toBe(
      false,
    );
    expect(canMarkFishingSchool(new Date("2026-01-01T00:00:30Z"), now)).toBe(true);
    expect(canMarkFishingSchool(new Date("2026-01-01T00:00:31Z"), now)).toBe(false);
  });
  it("moves a seeded school only among supplied connected-water tiles", () => {
    const tiles = [
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ];
    const position = getMovingSchoolPosition(
      tiles,
      "river",
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(tiles).toContainEqual(position);
  });
});

describe("species behavior encounters", () => {
  it("exposes fixed, server-owned equipment modifiers", () => {
    expect(getFishingEquipment("fishing-river-rod")).toMatchObject({
      kind: "ROD",
      experienceBonus: 5,
    });
    expect(getFishingEquipment("not-fishing-equipment")).toBeUndefined();
  });

  it("requires selected equipment to be carried and available", () => {
    const carried = {
      quantity: 1,
      storedAtHome: false,
      isInAuction: false,
      craftingFinishedAt: null,
    };
    expect(isFishingEquipmentAvailable(carried)).toBe(true);
    expect(isFishingEquipmentAvailable({ ...carried, storedAtHome: true })).toBe(false);
    expect(isFishingEquipmentAvailable({ ...carried, isInAuction: true })).toBe(false);
  });

  it("uses distinctive, actionable behavior cues", () => {
    expect(getFishingCue("DARTING", "FIGHT")).toContain("Steer");
    expect(getFishingCue("HEAVY", "FIGHT")).toContain("Reel");
    expect(getFishingCue("CAUTIOUS", "ATTRACT")).toContain("patiently");
    expect(getFishingCue("ERRATIC", "FIGHT")).toContain("slack");
  });

  it("gives Fishing Together a snapshotted, material bite-attraction benefit", () => {
    const base = {
      behavior: "CAUTIOUS" as const,
      state: "ATTRACT" as const,
      tension: 20,
      landingProgress: 0,
      action: "LURE" as const,
      attractionRoll: 60,
    };
    expect(resolveFishingAction({ ...base, socialBonusPercent: 0 })?.state).toBe(
      "ATTRACT",
    );
    expect(resolveFishingAction({ ...base, socialBonusPercent: 15 })?.state).toBe(
      "HOOK",
    );
  });

  it("changes fight outcomes by species behavior", () => {
    const base = {
      state: "FIGHT" as const,
      tension: 35,
      landingProgress: 10,
      action: "REEL" as const,
      socialBonusPercent: 0,
      attractionRoll: 0,
    };
    expect(resolveFishingAction({ ...base, behavior: "HEAVY" })?.landingProgress).toBe(
      44,
    );
    expect(
      resolveFishingAction({ ...base, behavior: "DARTING" })?.landingProgress,
    ).toBe(37);
    expect(resolveFishingAction({ ...base, behavior: "ERRATIC" })?.tension).toBe(55);
  });

  it("snapshots bait and tackle bonuses into the encounter result", () => {
    const base = {
      behavior: "CAUTIOUS" as const,
      state: "ATTRACT" as const,
      tension: 20,
      landingProgress: 0,
      action: "LURE" as const,
      socialBonusPercent: 0,
      attractionRoll: 58,
    };
    expect(resolveFishingAction(base)?.state).toBe("ATTRACT");
    expect(resolveFishingAction({ ...base, attractionBonus: 4 })?.state).toBe("HOOK");
    expect(
      resolveFishingAction({
        ...base,
        state: "FIGHT",
        action: "REEL",
        controlBonus: 5,
      })?.tension,
    ).toBe(29);
  });
});
