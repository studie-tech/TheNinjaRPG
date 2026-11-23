import { describe, expect, it } from "bun:test";
import { fillHeight } from "@/libs/rendering/scenes/travelViewport";

describe("travel map viewport height", () => {
  const phone = {
    viewportHeight: 812,
    rem: 12,
    isPhone: true,
    minimum: 238,
    wideMaximum: 487,
    hasRowBelow: true,
  };
  it("stops a phone map above an open lesson dock", () => {
    expect(fillHeight({ ...phone, pageTop: 135, dockTop: 443 })).toBe(443 - 54 - 135);
  });
  it("reaches the navigation bar when no dock covers the map", () => {
    expect(fillHeight({ ...phone, pageTop: 55, dockTop: null })).toBe(
      812 - 84 - 54 - 55,
    );
  });
  const wide = {
    pageTop: 316,
    viewportHeight: 1400,
    dockTop: null,
    rem: 12,
    isPhone: false,
    minimum: 483,
    wideMaximum: 600,
    hasRowBelow: true,
  };
  it("keeps a wider layout's map at its own height however tall the window is", () => {
    expect(fillHeight(wide)).toBe(600);
  });
  it("keeps a wider layout's map, its title and the row under it above a dock", () => {
    expect(fillHeight({ ...wide, dockTop: 700 })).toBe(700 - 54 - 96);
  });
  it("lets a map with nothing under it reach the dock", () => {
    expect(
      fillHeight({ ...phone, hasRowBelow: false, pageTop: 140, dockTop: 660 }),
    ).toBe(660 - 12 - 140);
  });
  it("never shrinks below the map's own proportions", () => {
    expect(fillHeight({ ...phone, pageTop: 135, dockTop: 300 })).toBe(238);
  });
});
