import { describe, expect, it } from "bun:test";
import { getCombatStatCap, getUserCaps } from "@/drizzle/constants";
import { createStatSchema } from "@/validators/combat";

const STATS = [
  "offence",
  "defence",
  "strength",
  "speed",
  "intelligence",
  "willpower",
] as const;

describe("createStatSchema", () => {
  it.each(STATS)("applies the minimum, default, rounding and own cap to %s", (stat) => {
    const { schema, maxValues } = createStatSchema(5, 7, { rank: "GENIN", [stat]: 3 });
    const others = Object.fromEntries(
      STATS.filter((other) => other !== stat).map((other) => [other, maxValues[other]]),
    );

    expect(schema.parse(others)[stat]).toBe(7);
    expect(schema.parse({ ...others, [stat]: "6.126" })[stat]).toBe(6.13);
    expect(schema.parse({ ...others, [stat]: maxValues[stat] })[stat]).toBe(
      maxValues[stat],
    );
    expect(
      schema.safeParse({ ...others, [stat]: 4.99 }).error?.issues[0]?.path,
    ).toEqual([stat]);
    expect(schema.safeParse({ ...others, [stat]: maxValues[stat] + 1 }).success).toBe(
      false,
    );
    expect(maxValues[stat]).toBe(getCombatStatCap(getUserCaps("GENIN"), stat) - 3);
  });

  it("gives every stat the same defaults when no user is supplied", () => {
    const { schema } = createStatSchema();
    expect(schema.parse({})).toEqual({
      offence: 10,
      defence: 10,
      strength: 10,
      speed: 10,
      intelligence: 10,
      willpower: 10,
    });
  });
});
