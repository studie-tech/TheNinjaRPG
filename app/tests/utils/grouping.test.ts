import { describe, it, expect } from "bun:test";
import { getUnique, groupBy } from "@/utils/grouping";

describe("groupBy", () => {
  it("returns an empty Map for empty input", () => {
    expect(groupBy([], "id").size).toBe(0);
  });

  it("preserves first-seen group order, row order and object identity", () => {
    const first = { id: "b", name: "first" };
    const second = { id: "a", name: "second" };
    const third = { id: "b", name: "third" };
    const fourth = { id: "a", name: "fourth" };
    const rows = [first, second, third, fourth];
    const originalRows = [...rows];
    const groups = groupBy(rows, "id");

    expect([...groups]).toEqual([
      ["b", [first, third]],
      ["a", [second, fourth]],
    ]);
    expect(groups.get("b")?.[0]).toBe(rows[0]);
    groups.get("b")?.pop();
    expect(rows).toEqual(originalRows);
    expect(groupBy(rows, "id").get("b")).toHaveLength(2);
  });

  it("keeps missing, nullable and falsy keys distinct without coercion", () => {
    const rows: { id?: string | number | boolean | null }[] = [
      {},
      { id: null },
      { id: 0 },
      { id: "" },
      { id: false },
      { id: "0" },
      { id: undefined },
      { id: null },
      { id: -0 },
    ];

    expect([...groupBy(rows, "id")]).toEqual([
      [undefined, [{}, { id: undefined }]],
      [null, [{ id: null }, { id: null }]],
      [0, [{ id: 0 }, { id: -0 }]],
      ["", [{ id: "" }]],
      [false, [{ id: false }]],
      ["0", [{ id: "0" }]],
    ]);
  });

  it("groups object and symbol keys by identity", () => {
    const objectKey = {};
    const symbolKey = Symbol("key");
    const firstObjectRow = { id: objectKey };
    const secondObjectRow = { id: objectKey };
    const firstSymbolRow = { id: symbolKey };
    const secondSymbolRow = { id: symbolKey };
    const rows = [
      firstObjectRow,
      { id: {} },
      secondObjectRow,
      firstSymbolRow,
      { id: Symbol("key") },
      secondSymbolRow,
    ];
    const groups = groupBy(rows, "id");

    expect(groups.size).toBe(4);
    expect(groups.get(objectKey)).toEqual([firstObjectRow, secondObjectRow]);
    expect(groups.get(symbolKey)).toEqual([firstSymbolRow, secondSymbolRow]);
  });

  it("retains an empty NaN bucket because NaN has no strict-equality matches", () => {
    const numberRow = { id: 1 };
    const rows = [{ id: NaN }, numberRow, { id: NaN }];

    expect([...groupBy(rows, "id")]).toEqual([
      [NaN, []],
      [1, [numberRow]],
    ]);
  });

  it("skips holes in sparse arrays", () => {
    const rows: { id: number }[] = new Array(3);
    rows[1] = { id: 1 };

    expect([...groupBy(rows, "id")]).toEqual([[1, [rows[1]]]]);
  });

  it("reads each row's grouping key once even when every key is distinct", () => {
    let keyReads = 0;
    const rows = Array.from({ length: 1000 }, (_, id) => ({
      get id() {
        keyReads += 1;
        return id;
      },
    }));
    const groups = groupBy(rows, "id");

    expect(groups.size).toBe(rows.length);
    expect(keyReads).toBe(rows.length);
    expect(groups.get(999)?.[0]).toBe(rows[999]);
  });
});

// Helper type for test objects
interface TestObj {
  id?: number | null;
  name?: string;
}

describe("getUnique", () => {
  it("returns unique objects by key", () => {
    const arr: TestObj[] = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 1, name: "c" },
    ];
    const result = getUnique(arr, "id");
    expect(result).toEqual([
      { id: 1, name: "c" }, // last occurrence kept
      { id: 2, name: "b" },
    ]);
  });

  it("returns empty array if input is empty", () => {
    expect(getUnique([], "id")).toEqual([]);
  });

  it("handles all unique values", () => {
    const arr: TestObj[] = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(getUnique(arr, "id")).toEqual(arr);
  });

  it("handles all duplicate values", () => {
    const arr: TestObj[] = [{ id: 1 }, { id: 1 }, { id: 1 }];
    expect(getUnique(arr, "id")).toEqual([{ id: 1 }]);
  });

  it("handles undefined and null keys", () => {
    const arr: TestObj[] = [
      { id: undefined, name: "a" },
      { id: null, name: "b" },
      { id: undefined, name: "c" },
      { id: null, name: "d" },
    ];
    const result = getUnique(arr, "id");
    expect(result).toEqual([
      { id: undefined, name: "c" },
      { id: null, name: "d" },
    ]);
  });

  it("handles elements missing the key", () => {
    const arr = [{ name: "a" }, { id: 1, name: "b" }, { name: "c" }];
    // This will treat missing key as undefined
    const result = getUnique(arr as { id?: number; name: string }[], "id");
    expect(result).toEqual([
      { name: "c" }, // last occurrence with missing key
      { id: 1, name: "b" },
    ]);
  });

  it("handles array with undefined/null elements", () => {
    // This will throw at runtime, so we check for error
    // Cast to any[] to match function signature and avoid type errors
    const arr = [undefined, { id: 1 }, null, { id: 1 }] as { id: number }[];
    const result = getUnique(arr, "id");
    expect(result).toEqual([{ id: 1 }]);
  });
});
