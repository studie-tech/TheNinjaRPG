import { describe, expect, it } from "vitest";
import { snapToThresholds } from "@/libs/hospital";

/**
 * The hospital's heal buttons ask the capacity one question each — "does it clear this
 * threshold?" — so the snapped value has to answer all of them exactly as the raw value does,
 * while changing far less often.
 */
describe("snapToThresholds", () => {
  const thresholds = [25, 50, 75, 100];

  it("answers every threshold question the same as the raw capacity", () => {
    for (let capacity = 0; capacity <= 120; capacity += 0.5) {
      const snapped = snapToThresholds(capacity, thresholds);
      for (const threshold of thresholds) {
        expect(threshold > snapped).toBe(threshold > capacity);
      }
    }
  });

  it("does not move while the capacity climbs between two thresholds", () => {
    expect(snapToThresholds(50, thresholds)).toBe(50);
    expect(snapToThresholds(63.4, thresholds)).toBe(50);
    expect(snapToThresholds(74.999, thresholds)).toBe(50);
    expect(snapToThresholds(75, thresholds)).toBe(75);
  });

  it("returns 0 below the lowest threshold, and the highest once past it", () => {
    expect(snapToThresholds(0, thresholds)).toBe(0);
    expect(snapToThresholds(24.9, thresholds)).toBe(0);
    expect(snapToThresholds(1_000, thresholds)).toBe(100);
  });

  it("handles an empty threshold list", () => {
    expect(snapToThresholds(42, [])).toBe(0);
  });

  it("ignores the order thresholds arrive in", () => {
    expect(snapToThresholds(80, [100, 25, 75, 50])).toBe(75);
  });
});
