import { describe, expect, it } from "vitest";
import { nextRaidMeters, requiredRaidAction } from "@/libs/fishingRaid";

describe("fishing raid phase rules", () => {
  it("requires complementary roles during control and surge", () => {
    expect(requiredRaidAction(2, "ANCHOR")).toBe("HOLD");
    expect(requiredRaidAction(2, "GUIDE")).toBe("TURN");
    expect(requiredRaidAction(2, "PULLER")).toBe("REEL");
    expect(requiredRaidAction(4, "ANCHOR")).toBe("SLACK");
  });

  it("gives a normal puller, anchor, and guide a valid distinct action in every phase", () => {
    for (const phase of [1, 2, 3, 4, 5]) {
      expect(requiredRaidAction(phase, "PULLER")).toBeDefined();
      expect(requiredRaidAction(phase, "ANCHOR")).toBeDefined();
      expect(requiredRaidAction(phase, "GUIDE")).toBeDefined();
    }
  });

  it("advances meters without exceeding their durable bounds", () => {
    expect(
      nextRaidMeters(5, { fishStamina: 4, landingProgress: 70, escapePressure: 2 }),
    ).toMatchObject({
      fishStamina: 0,
      landingProgress: 100,
      escapePressure: 0,
      succeeded: true,
    });
  });
});
