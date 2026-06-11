import { describe, expect, it } from "vitest";
import { computeTemplateActivations } from "@/app/api/shrine-maintenance/route";

// Helper: build a Date at a specific UTC time
function utcDate(dayOfWeek: number, hour: number, minute = 0): Date {
  // Find next occurrence of dayOfWeek at hour:minute UTC from a fixed epoch
  // We use a fixed Monday (2024-01-01 = Monday = dayOfWeek 1) as base
  const base = new Date("2024-01-01T00:00:00.000Z"); // Monday
  const baseDow = base.getUTCDay(); // 1
  let daysOffset = dayOfWeek - baseDow;
  if (daysOffset < 0) daysOffset += 7;
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + daysOffset);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

// A prevTime that is before the slot boundary for the given now
function prevBefore(now: Date): Date {
  const prev = new Date(now);
  prev.setUTCMinutes(prev.getUTCMinutes() - 1);
  return prev;
}

const BASE_PARAMS = {
  villageTokens: 100_000,
  hasLevel3Shrine: true,
  boostCost: 15_000,
};

describe("computeTemplateActivations", () => {
  it("returns empty array when slot is not due (not a boundary)", () => {
    const now = utcDate(1, 4, 30); // mid-slot
    const prevTime = utcDate(1, 4, 29); // also mid-slot, no boundary crossed
    const result = computeTemplateActivations({
      ...BASE_PARAMS,
      now,
      prevTime,
      shrineSettings: {
        boostTemplate: [{ boostType: "Training", dayOfWeek: 1, slotIndex: 2 }],
      },
    });
    expect(result).toHaveLength(0);
  });

  it("fires at slot boundary (minute 0 of a new slot)", () => {
    const now = utcDate(1, 4, 0); // Monday slot 2 boundary (04:00)
    const prevTime = utcDate(1, 3, 59); // just before
    const result = computeTemplateActivations({
      ...BASE_PARAMS,
      now,
      prevTime,
      shrineSettings: {
        boostTemplate: [{ boostType: "Training", dayOfWeek: 1, slotIndex: 2 }],
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.boostType).toBe("Training");
  });

  it("skips boost already active with future expiry", () => {
    const now = utcDate(1, 4, 0);
    const prevTime = utcDate(1, 3, 59);
    const futureExpiry = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const result = computeTemplateActivations({
      ...BASE_PARAMS,
      now,
      prevTime,
      shrineSettings: {
        activeBoosts: { Training: futureExpiry },
        boostTemplate: [{ boostType: "Training", dayOfWeek: 1, slotIndex: 2 }],
      },
    });
    expect(result).toHaveLength(0);
  });

  it("activates boost whose stored expiry has already passed", () => {
    const now = utcDate(1, 4, 0);
    const prevTime = utcDate(1, 3, 59);
    const pastExpiry = new Date(now.getTime() - 1000).toISOString();
    const result = computeTemplateActivations({
      ...BASE_PARAMS,
      now,
      prevTime,
      shrineSettings: {
        activeBoosts: { Training: pastExpiry },
        boostTemplate: [{ boostType: "Training", dayOfWeek: 1, slotIndex: 2 }],
      },
    });
    expect(result).toHaveLength(1);
  });

  it("skips if village has no Level 3 shrine", () => {
    const now = utcDate(1, 4, 0);
    const prevTime = utcDate(1, 3, 59);
    const result = computeTemplateActivations({
      ...BASE_PARAMS,
      hasLevel3Shrine: false, // village controls no Level 3 shrine
      now,
      prevTime,
      shrineSettings: {
        boostTemplate: [{ boostType: "Training", dayOfWeek: 1, slotIndex: 2 }],
      },
    });
    expect(result).toHaveLength(0);
  });

  it("skips all if insufficient tokens", () => {
    const now = utcDate(1, 4, 0);
    const prevTime = utcDate(1, 3, 59);
    const result = computeTemplateActivations({
      ...BASE_PARAMS,
      villageTokens: 5_000, // less than boostCost
      now,
      prevTime,
      shrineSettings: {
        boostTemplate: [{ boostType: "Training", dayOfWeek: 1, slotIndex: 2 }],
      },
    });
    expect(result).toHaveLength(0);
  });

  it("activates partial alphabetical boosts when tokens are limited", () => {
    const now = utcDate(1, 4, 0);
    const prevTime = utcDate(1, 3, 59);
    const result = computeTemplateActivations({
      ...BASE_PARAMS,
      villageTokens: 20_000, // enough for 1 boost at 15_000
      now,
      prevTime,
      shrineSettings: {
        boostTemplate: [
          { boostType: "PVP", dayOfWeek: 1, slotIndex: 2 },
          { boostType: "Crafting", dayOfWeek: 1, slotIndex: 2 },
        ],
      },
    });
    // Alphabetically: Crafting < PVP, so Crafting fires first
    expect(result).toHaveLength(1);
    expect(result[0]?.boostType).toBe("Crafting");
  });

  it("returns empty array when template is empty", () => {
    const now = utcDate(1, 4, 0);
    const prevTime = utcDate(1, 3, 59);
    const result = computeTemplateActivations({
      ...BASE_PARAMS,
      now,
      prevTime,
      shrineSettings: { boostTemplate: [] },
    });
    expect(result).toHaveLength(0);
  });

  it("only fires entries matching current dayOfWeek and slotIndex", () => {
    const now = utcDate(1, 4, 0); // Monday slot 2
    const prevTime = utcDate(1, 3, 59);
    const result = computeTemplateActivations({
      ...BASE_PARAMS,
      now,
      prevTime,
      shrineSettings: {
        boostTemplate: [
          { boostType: "Training", dayOfWeek: 1, slotIndex: 2 }, // matches
          { boostType: "PVP", dayOfWeek: 2, slotIndex: 2 }, // wrong day
          { boostType: "Mission", dayOfWeek: 1, slotIndex: 3 }, // wrong slot
        ],
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.boostType).toBe("Training");
  });

  it("fires at slot boundary even when cron is 1 minute late", () => {
    // Slot 2 starts at 04:00 UTC. Cron fires at 04:01 (1 min late).
    const now = utcDate(1, 4, 1); // 04:01
    const prevTime = utcDate(1, 3, 59); // 03:59 — slot boundary 04:00 is in (prevTime, now]
    const result = computeTemplateActivations({
      ...BASE_PARAMS,
      now,
      prevTime,
      shrineSettings: {
        boostTemplate: [{ boostType: "Training", dayOfWeek: 1, slotIndex: 2 }],
      },
    });
    expect(result).toHaveLength(1);
    // Expiry must anchor to the slot start (04:00 + 2h = 06:00), not to `now`,
    // so the next slot tick at 06:00 doesn't skip this boost type.
    expect(result[0]?.newEndAt).toBe("2024-01-01T06:00:00.000Z");
  });
});
