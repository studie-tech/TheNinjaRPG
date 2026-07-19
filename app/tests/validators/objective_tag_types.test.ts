import { describe, expect, it } from "vitest";
import { z } from "zod";
import { effectFilters } from "@/validators/combat";
import { OBJECTIVE_TAG_TYPES } from "@/validators/objectives";

// Tag types excluded from OBJECTIVE_TAG_TYPES because they cannot produce a winnable
// combat resolution. Covers two categories:
//   1. Non-combat tags that only fire outside of battle (noncombat*, marriage, reskin,
//      unlockitemvariant, repair, rollbloodline).
//   2. Combat tags that never resolve on a user target (barrier, clone, summon, move —
//      these are routed to ground effects / special handlers and therefore can never
//      satisfy a tag_usage_win objective).
const EXCLUDED_TAG_TYPES = new Set([
  // Non-combat tags
  "rollbloodline",
  "rollsagemode",
  "noncombatconsumereward",
  "repair",
  "marriageslotincrease",
  "noncombatincreasereskins",
  "noncombatgainskill",
  "unlockitemvariant",
  // Combat tags that never resolve on a user target
  "barrier",
  "clone",
  "summon",
  "move",
]);

describe("OBJECTIVE_TAG_TYPES", () => {
  it("is exactly the combat-applicable subset of the canonical effect filters", () => {
    const expected = [...effectFilters]
      .filter((t) => !EXCLUDED_TAG_TYPES.has(t))
      .sort();
    expect([...OBJECTIVE_TAG_TYPES].sort()).toEqual(expected);
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
