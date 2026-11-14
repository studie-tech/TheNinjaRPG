import { describe, expect, it } from "bun:test";
import { getPageWindow } from "@/libs/pagination";

describe("getPageWindow", () => {
  it("lists every page when there are few", () => {
    expect(getPageWindow(0, 1)).toEqual([0]);
    expect(getPageWindow(2, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it("keeps the ends and the current page's neighbours, with gaps between", () => {
    expect(getPageWindow(10, 40)).toEqual([0, null, 9, 10, 11, null, 39]);
    expect(getPageWindow(0, 40)).toEqual([0, 1, null, 39]);
    expect(getPageWindow(39, 40)).toEqual([0, null, 38, 39]);
  });

  it("shows a single skipped page instead of a gap", () => {
    expect(getPageWindow(3, 40)).toEqual([0, 1, 2, 3, 4, null, 39]);
  });
});
