import { describe, it, expect } from "bun:test";
import { getUnique } from "@/utils/grouping";

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
