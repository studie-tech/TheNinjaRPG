import { describe, expect, it } from "bun:test";
import { getEffectiveStackSize, splitIntoStacks } from "@/libs/item";

describe("getEffectiveStackSize", () => {
  it("uses the configured size for stackable items", () => {
    expect(getEffectiveStackSize({ canStack: true, stackSize: 20 })).toBe(20);
    expect(getEffectiveStackSize({ canStack: true, stackSize: 0 })).toBe(1);
  });

  it("holds one per row for items that cannot stack", () => {
    expect(getEffectiveStackSize({ canStack: false, stackSize: 20 })).toBe(1);
  });
});

describe("splitIntoStacks", () => {
  it("fills full rows before the remainder", () => {
    expect(splitIntoStacks(25, 10)).toEqual([10, 10, 5]);
  });

  it("returns no rows for an empty quantity", () => {
    expect(splitIntoStacks(0, 10)).toEqual([]);
  });

  it("treats a non-positive stack size as one per row", () => {
    expect(splitIntoStacks(2, 0)).toEqual([1, 1]);
  });
});
