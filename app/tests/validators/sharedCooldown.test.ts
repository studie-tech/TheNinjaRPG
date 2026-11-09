import { describe, expect, it } from "bun:test";
import { sharedCooldownSchema } from "@/validators/sharedCooldown";

describe("shared cooldown validation", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2147483648])(
    "rejects invalid rounds %s",
    (rounds) => {
      expect(sharedCooldownSchema.safeParse({ tag: "clear", rounds }).success).toBe(
        false,
      );
    },
  );
  it("accepts combat tags outside the seeded configuration", () => {
    expect(sharedCooldownSchema.parse({ tag: "damage", rounds: 5 })).toEqual({
      tag: "damage",
      rounds: 5,
    });
  });
  it.each(["unknown", "", "made-up-tag"])("rejects unsupported tag %s", (tag) => {
    expect(sharedCooldownSchema.safeParse({ tag, rounds: 3 }).success).toBe(false);
  });
});
