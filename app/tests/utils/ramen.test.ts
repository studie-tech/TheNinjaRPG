import { describe, expect, it } from "bun:test";
import type { UserData } from "@/drizzle/schema";
import { calcRamenPrice } from "@/utils/ramen";

const userWithHealth = (maxHealth: number) => ({ maxHealth }) as UserData;

describe("ramen price", () => {
  it.each([
    [1000, "small", 20],
    [1000, "large", 200],
    [65, "small", 1],
    [580, "medium", 58],
    [123, "medium", 12],
  ] as const)(
    "charges whole ryo (maxHealth %d, %s bowl)",
    (maxHealth, option, price) => {
      expect(calcRamenPrice(option, userWithHealth(maxHealth))).toBe(price);
    },
  );

  it("never returns fractional ryo", () => {
    for (let maxHealth = 1; maxHealth < 2000; maxHealth += 7) {
      for (const option of ["small", "medium", "large"] as const) {
        const price = calcRamenPrice(option, userWithHealth(maxHealth));
        expect(Number.isInteger(price)).toBe(true);
      }
    }
  });
});
