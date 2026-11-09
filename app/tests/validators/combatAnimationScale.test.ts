import { describe, expect, it } from "bun:test";
import { DamageTag, HealTag, VisualTag } from "@/validators/combat";

describe("effect animation scale", () => {
  it("defaults existing effects to normal size and accepts fractional sizing", () => {
    for (const schema of [DamageTag, HealTag, VisualTag]) {
      expect(schema.parse({}).animationScale).toBe(1);
      expect(schema.parse({ animationScale: "2.5" }).animationScale).toBe(2.5);
    }
  });
  it.each([0, -1, 5.1, Number.NaN, Number.POSITIVE_INFINITY, "invalid"])("rejects invalid sizing %s", (animationScale) => {
    expect(DamageTag.safeParse({ animationScale }).success).toBe(false);
  });
});
