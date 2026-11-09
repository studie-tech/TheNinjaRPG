import { describe, expect, it, test } from "bun:test";
import { chunkArray, countNames, moveItem, shuffle } from "@/utils/array";

test("chunkArray splits values into bounded batches", () => {
  expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
});

test("chunkArray handles an empty input", () => {
  expect(chunkArray([], 500)).toEqual([]);
});

test("chunkArray rejects invalid batch sizes", () => {
  expect(() => chunkArray([1], 0)).toThrow(RangeError);
  expect(() => chunkArray([1], 1.5)).toThrow(RangeError);
});

test("countNames collapses repeats into a count and keeps first-seen order", () => {
  expect(countNames(["Sickle", "Bow", "Sickle", "Sickle"])).toEqual([
    "Sickle ×3",
    "Bow",
  ]);
  expect(countNames([])).toEqual([]);
});

describe("shuffle", () => {
  it("keeps every element and leaves the input untouched", () => {
    const items = [1, 2, 3, 4, 5] as const;
    expect([...shuffle(items)].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });

  it("swaps from the end with the injected index source", () => {
    expect(shuffle(["a", "b", "c"], () => 0)).toEqual(["b", "c", "a"]);
    expect(shuffle(["a", "b", "c"], (n) => n - 1)).toEqual(["a", "b", "c"]);
  });
});

test("moveItem moves an entry one step into a new list", () => {
  const list = ["a", "b", "c"];
  expect(moveItem(list, 1, -1)).toEqual(["b", "a", "c"]);
  expect(moveItem(list, 1, 1)).toEqual(["a", "c", "b"]);
  expect(list).toEqual(["a", "b", "c"]);
});

test("moveItem returns the same list when nothing can move", () => {
  const list = ["a", "b"];
  expect(moveItem(list, 0, -1)).toBe(list);
  expect(moveItem(list, 1, 1)).toBe(list);
  expect(moveItem(list, -1, 1)).toBe(list);
});
