import { describe, expect, it } from "bun:test";
import { SHRINE_HP_BY_LEVEL } from "@/drizzle/constants";
import { getShrineHpByLevel } from "@/libs/war";

describe("getShrineHpByLevel", () => {
  it("returns the hp of a known shrine level", () => {
    expect(getShrineHpByLevel(2)).toBe(SHRINE_HP_BY_LEVEL[2]);
    expect(getShrineHpByLevel(3)).toBe(SHRINE_HP_BY_LEVEL[3]);
  });

  it.each([undefined, null, 0, 99])("falls back to level 1 for %p", (level) => {
    expect(getShrineHpByLevel(level)).toBe(SHRINE_HP_BY_LEVEL[1]);
  });
});
