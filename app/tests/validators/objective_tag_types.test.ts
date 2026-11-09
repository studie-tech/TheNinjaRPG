import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { activityBonusTypes, tagTypes } from "@/validators/combat";
import { OBJECTIVE_TAG_TYPES } from "@/validators/objectives";

// Tag types excluded from OBJECTIVE_TAG_TYPES, grouped by reason.
const EXCLUDED_TAG_TYPES = new Set([
  // Authoring variants normalize before usage tracking and count as damage.
  "elementaldamage",
  // Non-combat tags
  ...activityBonusTypes,
  "increaseregeneration",
  "rollbloodline",
  "rollsagemode",
  "noncombatconsumereward",
  "repair",
  "marriageslotincrease",
  "noncombatincreasereskins",
  "increasejutsuslots",
  "noncombatgainskill",
  "noncombatquest",
  "unlockitemvariant",
  // Combat tags that never resolve on a user target
  "barrier",
  "clone",
  "summon",
  "move",
]);

describe("OBJECTIVE_TAG_TYPES", () => {
  it("is exactly the combat-applicable subset of the canonical effect filters", () => {
    const expected = [...tagTypes].filter((t) => !EXCLUDED_TAG_TYPES.has(t)).sort();
    expect([...OBJECTIVE_TAG_TYPES].sort()).toEqual<typeof expected>(expected);
  });

  it("excludes every excluded tag type", () => {
    for (const excluded of EXCLUDED_TAG_TYPES) {
      expect(OBJECTIVE_TAG_TYPES).not.toContain(excluded);
    }
  });

  it("works as a z.enum that accepts a combat tag and rejects excluded/unknown values", () => {
    const schema = z.enum(OBJECTIVE_TAG_TYPES);
    expect(schema.safeParse("poison").success).toBe(true);
    expect(schema.safeParse("damage").success).toBe(true);
    expect(schema.safeParse("repair").success).toBe(false);
    expect(schema.safeParse("not-a-real-tag").success).toBe(false);
  });
});
