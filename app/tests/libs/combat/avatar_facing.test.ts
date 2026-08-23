import { describe, expect, it } from "vitest";
import { getFacingDirection } from "@/libs/combat/util";
import type { ReturnedUserState } from "@/libs/combat/types";
import type { UserEffect } from "@/libs/combat/types";

/** Minimal battle user for facing checks. */
const user = (overrides: Partial<ReturnedUserState>): ReturnedUserState =>
  ({
    userId: "u",
    direction: "left",
    longitude: 5,
    latitude: 5,
    curHealth: 100,
    fledBattle: false,
    leftBattle: false,
    ...overrides,
  }) as ReturnedUserState;

describe("getFacingDirection", () => {
  it("faces left when the nearest opponent stands to the left", () => {
    const ai = user({ userId: "ai", direction: "right", longitude: 8 });
    const foe = user({ userId: "p1", direction: "left", longitude: 3 });
    expect(getFacingDirection(ai, [ai, foe], "right")).toBe("left");
  });

  it("faces right when the nearest opponent stands to the right", () => {
    const ai = user({ userId: "ai", direction: "right", longitude: 2 });
    const foe = user({ userId: "p1", direction: "left", longitude: 7 });
    expect(getFacingDirection(ai, [ai, foe], "left")).toBe("right");
  });

  it("picks the nearest opponent when several are alive", () => {
    const ai = user({ userId: "ai", direction: "right", longitude: 5 });
    const near = user({ userId: "p1", direction: "left", longitude: 7 });
    const far = user({ userId: "p2", direction: "left", longitude: 0 });
    expect(getFacingDirection(ai, [ai, near, far], "left")).toBe("right");
  });

  it("keeps the fallback when the nearest opponent shares the column", () => {
    const ai = user({ userId: "ai", direction: "right", longitude: 5, latitude: 5 });
    const above = user({ userId: "p1", direction: "left", longitude: 5, latitude: 3 });
    expect(getFacingDirection(ai, [ai, above], "right")).toBe("right");
  });

  it("keeps the fallback when no opponent is present", () => {
    const ai = user({ userId: "ai", direction: "right" });
    const ally = user({ userId: "ai2", direction: "right", longitude: 1 });
    expect(getFacingDirection(ai, [ai, ally], "left")).toBe("left");
  });

  it("ignores defeated and fled opponents", () => {
    const ai = user({ userId: "ai", direction: "right", longitude: 5 });
    const dead = user({ userId: "p1", direction: "left", longitude: 7, curHealth: 0 });
    const fled = user({
      userId: "p2",
      direction: "left",
      longitude: 8,
      fledBattle: true,
    });
    const alive = user({ userId: "p3", direction: "left", longitude: 2 });
    expect(getFacingDirection(ai, [ai, dead, fled, alive], "right")).toBe("left");
  });

  it("routes liveness through the effect-adjusted pool when effects are given", () => {
    const ai = user({ userId: "ai", direction: "right", longitude: 5 });
    const downed = user({ userId: "p1", direction: "left", longitude: 2, curHealth: 0 });
    // No pool-adjusting effect for p1 → effectively at 0 health → fallback wins
    expect(getFacingDirection(ai, [ai, downed], "right", [] as UserEffect[])).toBe(
      "right",
    );
  });

  it("breaks distance ties on userId so the pick is stable across frames", () => {
    const ai = user({ userId: "ai", direction: "right", longitude: 5, latitude: 5 });
    const west = user({ userId: "a-west", direction: "left", longitude: 3 });
    const east = user({ userId: "b-east", direction: "left", longitude: 7 });
    // Same distance: lexicographically smaller userId (a-west) wins → face left
    expect(getFacingDirection(ai, [ai, east, west], "right")).toBe("left");
    expect(getFacingDirection(ai, [ai, west, east], "right")).toBe("left");
  });
});
