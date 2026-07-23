import { expect, test } from "vitest";
import { chunkArray } from "@/utils/array";

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
