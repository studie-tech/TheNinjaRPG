import { describe, it, expect } from "vitest";
import { pickWeightedQuest } from "@/libs/overworldAi";

const pool = [
  { questId: "a", chance: 50 },
  { questId: "b", chance: 20 },
  { questId: "c", chance: 10 },
];
describe("pickWeightedQuest (absolute, sum<=100, remainder=nothing)", () => {
  it("r in first band → a", () => expect(pickWeightedQuest(pool, 0)).toBe("a"));
  it("r at band edge → next", () => expect(pickWeightedQuest(pool, 50)).toBe("b"));
  it("r in third band → c", () => expect(pickWeightedQuest(pool, 70)).toBe("c"));
  it("r past summed chance (80) → nothing", () =>
    expect(pickWeightedQuest(pool, 85)).toBeNull());
  it("empty pool → nothing", () => expect(pickWeightedQuest([], 0)).toBeNull());
});
