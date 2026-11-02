import { describe, expect, it } from "bun:test";
import type { UserEffect } from "@/libs/combat/types";
import { sortEffects } from "@/libs/combat/util";

const effect = (type: string, calculation = "static") =>
  ({ id: `${type}-${calculation}`, type, calculation }) as unknown as UserEffect;

describe("sortEffects", () => {
  it("keeps listed stages in order when unlisted tags sit between them", () => {
    const sorted = [
      effect("increasestat"),
      effect("immunity"),
      effect("cleanse"),
      effect("increaserange"),
      effect("stealth"),
    ].sort(sortEffects);
    expect(sorted.map((e) => e.type)).toEqual([
      "stealth",
      "cleanse",
      "increasestat",
      "immunity",
      "increaserange",
    ]);
  });

  it("is antisymmetric for every pair", () => {
    const effects = [
      effect("immunity"),
      effect("increasemaxpools"),
      effect("cleanse"),
      effect("move"),
      effect("decreasedamagetaken", "static"),
      effect("decreasedamagetaken", "percentage"),
      effect("decreasedamagegiven", "static"),
      effect("decreasedamagegiven", "percentage"),
    ];
    for (const a of effects) {
      for (const b of effects) {
        expect(Math.sign(sortEffects(a, b))).toBe(-Math.sign(sortEffects(b, a)) || 0);
      }
    }
  });
});
