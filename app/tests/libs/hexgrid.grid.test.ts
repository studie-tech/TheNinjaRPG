import { describe, expect, it } from "bun:test";
import { HEX_ASPECT_RATIO, HEX_STACKING_DISPLACEMENT } from "@/drizzle/constants";
import {
  createHexGrid,
  hexGridHeightRatio,
  nameArenaTile,
  oddQHexDistance,
  stackedHexWidths,
  tileKeysNear,
} from "@/libs/hexgrid";

describe("createHexGrid", () => {
  it("builds every tile of the rectangle", () => {
    expect(createHexGrid(20, 4, 3).size).toBe(12);
  });

  it.each([0, -1, Number.NaN])("yields an empty grid for hex size %p", (hexsize) => {
    expect(createHexGrid(hexsize, 4, 3).size).toBe(0);
  });
});

describe("nameArenaTile", () => {
  it("names tiles by column letter and row number", () => {
    const grid = createHexGrid(20, 3, 3).map(nameArenaTile);
    const tile = grid.getHex({ col: 2, row: 1 });
    expect(tile?.name).toBe("C2");
    expect(tile?.cost).toBe(1);
  });
});

describe("hex map proportions", () => {
  it("measures stacked columns", () => {
    expect(stackedHexWidths(1)).toBe(1);
    expect(stackedHexWidths(3)).toBe(3 - 2 * HEX_STACKING_DISPLACEMENT);
  });

  it("includes the two border rows in the height ratio", () => {
    expect(hexGridHeightRatio(3, 4)).toBe(
      (6 * HEX_ASPECT_RATIO) / stackedHexWidths(3),
    );
  });
});

describe("oddQHexDistance", () => {
  it("matches honeycomb's own grid distance", () => {
    const grid = createHexGrid(20, 7, 7);
    const hexes = grid.toArray();
    for (const a of hexes) {
      for (const b of hexes) {
        expect(oddQHexDistance(a.col, a.row, b.col, b.row)).toBe(
          grid.distance(a, b),
        );
      }
    }
  });
});

describe("tileKeysNear", () => {
  it("collects positions and their neighbors, skipping tiles off the grid", () => {
    const grid = createHexGrid(20, 5, 5);
    const keys = tileKeysNear(grid, [
      { col: 2, row: 2 },
      { col: 9, row: 9 },
    ]);
    expect(keys.size).toBe(7);
    expect(keys.has("2,2")).toBe(true);
  });
});
