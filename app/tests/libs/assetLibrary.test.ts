import { describe, expect, it } from "bun:test";
import { getAssetLibraryReturnTo } from "@/libs/assetLibrary";

describe("asset editor return navigation", () => {
  it("preserves the library workspace including an unfiled folder and keyword filters", () => {
    const path =
      "/manual/asset?q=fire&type=ANIMATION&folder=&sort=name-asc&view=list&tag=red";
    expect(getAssetLibraryReturnTo(path)).toBe(path);
  });

  it.each([
    null,
    "https://example.com",
    "//example.com",
    "/profile",
    "/manual/assets",
    "/manual/asset/edit/other",
    "/manual/asset#external",
  ])("rejects a destination outside the library: %s", (path) => {
    expect(getAssetLibraryReturnTo(path)).toBe("/manual/asset");
  });
});
