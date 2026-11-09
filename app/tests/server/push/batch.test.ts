import { describe, expect, it } from "bun:test";
import { mapWithConcurrency } from "@/server/utils/push/batch";

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const items = [50, 5, 30, 1, 20, 10];
    const result = await mapWithConcurrency(
      items,
      async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        return ms;
      },
      2,
    );
    expect(result).toEqual(items);
  });

  it("never exceeds the limit, so a large fan-out cannot time out in the queue", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 40 }, (_, i) => i),
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return null;
      },
      4,
    );
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("handles an empty batch", async () => {
    expect(await mapWithConcurrency([], async () => 1)).toEqual([]);
  });
});
