import { describe, expect, it } from "bun:test";
import { DamageTag, HealTag, VisualTag } from "@/validators/combat";

describe("effect animation scale", () => {
  it("defaults existing effects to normal size and accepts fractional sizing", () => {
    for (const schema of [DamageTag, HealTag, VisualTag]) {
      expect(schema.parse({}).animationScale).toBe(1);
      for (const animationScale of [1, 1.01, 1.375, 2.5, 2.999, 3]) {
        expect(schema.parse({ animationScale }).animationScale).toBe(animationScale);
        expect(
          schema.parse({ animationScale: String(animationScale) }).animationScale,
        ).toBe(animationScale);
      }
    }
  });
  it.each([0, -1, 0.99, 3.01, 5.1, Number.NaN, Number.POSITIVE_INFINITY, "invalid"])(
    "rejects invalid sizing %s",
    (animationScale) => {
      expect(DamageTag.safeParse({ animationScale }).success).toBe(false);
    },
  );
});
