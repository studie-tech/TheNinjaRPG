import { describe, expect, it } from "bun:test";
import { offsetPage } from "@/server/utils/pagination";

describe("offsetPage", () => {
  it("starts at the first page without a cursor", () => {
    for (const cursor of [undefined, null, 0]) {
      const page = offsetPage({ cursor, limit: 20 });
      expect(page.skip).toBe(0);
      expect(page.cursorAfter(new Array(20))).toBe(1);
    }
  });

  it("offsets by whole pages and advances after a full page", () => {
    const page = offsetPage({ cursor: 3, limit: 20 });
    expect(page.skip).toBe(60);
    expect(page.cursorAfter(new Array(20))).toBe(4);
  });

  it("ends on a short page", () => {
    expect(offsetPage({ cursor: 3, limit: 20 }).cursorAfter(new Array(19))).toBeNull();
  });
});
