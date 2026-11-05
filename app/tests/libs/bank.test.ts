import { describe, expect, it } from "bun:test";
import { RYO_CAP } from "@/drizzle/constants";
import { clampToRyoCap } from "@/libs/bank";

describe("clampToRyoCap", () => {
  it("keeps an amount that fits under the cap", () => {
    expect(clampToRyoCap(RYO_CAP - 100, 100)).toBe(100);
    expect(clampToRyoCap(RYO_CAP, 0)).toBe(0);
  });

  it("shrinks an amount to the remaining room", () => {
    expect(clampToRyoCap(RYO_CAP - 40, 100)).toBe(40);
  });

  it("reports a full balance", () => {
    expect(clampToRyoCap(RYO_CAP, 1)).toBeNull();
    expect(clampToRyoCap(RYO_CAP + 5, 1)).toBeNull();
  });
});
