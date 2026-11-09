import { describe, expect, it } from "bun:test";
import { computeTemplateActivations } from "@/server/utils/shrineMaintenance";

/** A UTC time on Monday 2024-01-01, the day every template row below targets (dayOfWeek 1). */
const monday = (hour: number, minute = 0) =>
  new Date(Date.UTC(2024, 0, 1, hour, minute));

const TRAINING_SLOT_2 = { boostType: "Training", dayOfWeek: 1, slotIndex: 2 } as const;

/** Runs the 03:59 -> 04:00 Monday slot-2 tick for a well-funded Level 3 shrine village. */
const activations = (
  overrides: Partial<Parameters<typeof computeTemplateActivations>[0]> = {},
) =>
  computeTemplateActivations({
    villageTokens: 100_000,
    hasLevel3Shrine: true,
    boostCost: 15_000,
    now: monday(4),
    prevTime: monday(3, 59),
    shrineSettings: { boostTemplate: [TRAINING_SLOT_2] },
    ...overrides,
  });

describe("computeTemplateActivations", () => {
  it("returns empty array when slot is not due (not a boundary)", () => {
    // Both times are mid-slot, so no boundary is crossed.
    const result = activations({ now: monday(4, 30), prevTime: monday(4, 29) });
    expect(result).toHaveLength(0);
  });

  it("fires at slot boundary (minute 0 of a new slot)", () => {
    const result = activations();
    expect(result).toHaveLength(1);
    expect(result[0]?.boostType).toBe("Training");
  });

  it("skips boost already active with future expiry", () => {
    const futureExpiry = new Date(monday(4).getTime() + 60 * 60 * 1000).toISOString();
    const result = activations({
      shrineSettings: {
        activeBoosts: { Training: futureExpiry },
        boostTemplate: [TRAINING_SLOT_2],
      },
    });
    expect(result).toHaveLength(0);
  });

  it("activates boost whose stored expiry has already passed", () => {
    const pastExpiry = new Date(monday(4).getTime() - 1000).toISOString();
    const result = activations({
      shrineSettings: {
        activeBoosts: { Training: pastExpiry },
        boostTemplate: [TRAINING_SLOT_2],
      },
    });
    expect(result).toHaveLength(1);
  });

  it("skips if village has no Level 3 shrine", () => {
    const result = activations({ hasLevel3Shrine: false });
    expect(result).toHaveLength(0);
  });

  it("skips all if insufficient tokens", () => {
    const result = activations({ villageTokens: 5_000 }); // less than boostCost
    expect(result).toHaveLength(0);
  });

  it("activates partial alphabetical boosts when tokens are limited", () => {
    const result = activations({
      villageTokens: 20_000, // enough for 1 boost at 15_000
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

  it("dedupes duplicate (boostType, day, slot) rows so a type activates at most once", () => {
    const result = activations({
      shrineSettings: {
        // Malformed/legacy data: the same type repeated for one slot. The cron must
        // not charge tokens per occurrence (JSON_SET writes the key only once).
        boostTemplate: [{ ...TRAINING_SLOT_2 }, { ...TRAINING_SLOT_2 }],
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.boostType).toBe("Training");
  });

  it("returns empty array when template is empty", () => {
    const result = activations({ shrineSettings: { boostTemplate: [] } });
    expect(result).toHaveLength(0);
  });

  it("only fires entries matching current dayOfWeek and slotIndex", () => {
    const result = activations({
      shrineSettings: {
        boostTemplate: [
          TRAINING_SLOT_2, // matches
          { boostType: "PVP", dayOfWeek: 2, slotIndex: 2 }, // wrong day
          { boostType: "Mission", dayOfWeek: 1, slotIndex: 3 }, // wrong slot
        ],
      },
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.boostType).toBe("Training");
  });

  it("fires at slot boundary even when cron is 1 minute late", () => {
    // Slot 2 starts at 04:00 UTC. Cron fires at 04:01 (1 min late), so the
    // slot boundary 04:00 is in (prevTime, now].
    const result = activations({ now: monday(4, 1) });
    expect(result).toHaveLength(1);
    // Expiry must anchor to the slot start (04:00 + 2h = 06:00), not to `now`,
    // so the next slot tick at 06:00 doesn't skip this boost type.
    expect(result[0]?.newEndAt).toBe("2024-01-01T06:00:00.000Z");
  });
});
