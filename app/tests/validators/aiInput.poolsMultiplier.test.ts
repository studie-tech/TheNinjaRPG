import { describe, expect, it } from "bun:test";
import { maxPoolsMultiplier } from "@/libs/profile";
import { insertAiSchema } from "@/validators/aiInput";

const makeAi = (level: number, poolsMultiplier: number) => ({
  userId: "R9JRTtK3cZubEWUMbEkfL",
  username: "Rust Ferret",
  gender: "Unknown",
  level,
  poolsMultiplier,
  regeneration: 60,
  statsMultiplier: 40,
  strength: 10,
  intelligence: 10,
  willpower: 10,
  speed: 10,
  offence: 10,
  defence: 10,
  ninjutsuMastery: 10,
  genjutsuMastery: 10,
  taijutsuMastery: 10,
  bukijutsuMastery: 10,
  bloodlineMastery: 10,
  sageMastery: 10,
  isSummon: false,
  effects: [],
});

describe("insertAiSchema poolsMultiplier", () => {
  it("accepts modifiers above 50 while the scaled pools stay within five million", () => {
    expect(maxPoolsMultiplier(120)).toBe(826);
    expect(insertAiSchema.safeParse(makeAi(120, 826)).success).toBe(true);
    expect(insertAiSchema.safeParse(makeAi(120, 15)).success).toBe(true);
  });

  it("accepts a modifier that reaches the pool cap exactly", () => {
    expect(insertAiSchema.safeParse(makeAi(99, 1000)).success).toBe(true);
  });

  it("explains the limit when a modifier would exceed the pool cap", () => {
    const result = insertAiSchema.safeParse(makeAi(99, 1001));
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["poolsMultiplier"],
        message:
          "Pool modifier 1001 at level 99 would push HP/CP/SP above the maximum of 5,000,000. Use at most 1000 at this level.",
      }),
    ]);
  });

  it.each([0, -1, "invalid"])("rejects an invalid pool modifier: %s", (poolsMultiplier) => {
    expect(insertAiSchema.safeParse({ ...makeAi(99, 1), poolsMultiplier }).success).toBe(false);
  });
});
