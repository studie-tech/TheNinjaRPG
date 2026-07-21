import { describe, expect, it } from "vitest";
import globe from "@/data/hexasphere.json";
import {
  MAP_TOTAL_SECTORS,
  MAP_WORLD_COLUMNS,
  MAP_WORLD_ROWS,
} from "@/drizzle/constants";
import { sectorGridPosition, sectorIdAt } from "@/libs/sector-map/world-grid";
import {
  buildSectorWindowLayout,
  getSectorNeighborIds,
  SectorNeighborDirections,
} from "@/server/utils/sectorMap";

const tiles = globe.tiles;
const CARDINAL_OFFSET = {
  north: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  south: { dx: 0, dy: -1 },
  west: { dx: -1, dy: 0 },
} as const;

const expectedSectorAtOffset = (center: number, dx: number, dy: number) => {
  const position = sectorGridPosition(center);
  if (!position) return -1;
  // Rendered window y points north, while row indices increase southward.
  return sectorIdAt(position.column + dx, position.row - dy);
};

describe("buildSectorWindowLayout", () => {
  it("projects every sector into an unrotated rectangular window", () => {
    for (let sector = 0; sector < tiles.length; sector++) {
      const layout = buildSectorWindowLayout(sector);
      const byOffset = new Map(layout.map((entry) => [`${entry.dx},${entry.dy}`, entry]));
      const position = sectorGridPosition(sector)!;
      expect(layout).toHaveLength(
        position.row === 0 || position.row === MAP_WORLD_ROWS - 1 ? 6 : 9,
      );

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const expected = expectedSectorAtOffset(sector, dx, dy);
          const entry = byOffset.get(`${dx},${dy}`);
          if (expected < 0) {
            expect(entry).toBeUndefined();
          } else {
            expect(entry).toEqual({ sector: expected, dx, dy });
          }
        }
      }
      expect(new Set(layout.map((entry) => entry.sector)).size).toBe(layout.length);
    }
  });

  it("keeps every overlapping window aligned, including longitude wrap", () => {
    let overlaps = 0;
    for (let sector = 0; sector < MAP_TOTAL_SECTORS; sector++) {
      const layout = buildSectorWindowLayout(sector);
      const currentBySector = new Map(layout.map((entry) => [entry.sector, entry]));
      const neighbors = getSectorNeighborIds(sector);
      for (const direction of SectorNeighborDirections) {
        const neighbor = neighbors[direction];
        if (neighbor < 0) continue;
        const offset = CARDINAL_OFFSET[direction];
        for (const entry of buildSectorWindowLayout(neighbor)) {
          const current = currentBySector.get(entry.sector);
          if (!current) continue;
          expect({
            dx: offset.dx + entry.dx,
            dy: offset.dy + entry.dy,
          }).toEqual({ dx: current.dx, dy: current.dy });
          overlaps++;
        }
      }
    }
    expect(overlaps).toBeGreaterThan(MAP_TOTAL_SECTORS * 8);
  });

  it("wraps the west/east window edge without rotating sectors", () => {
    const row = Math.floor(MAP_WORLD_ROWS / 2);
    const first = sectorIdAt(0, row);
    const last = sectorIdAt(MAP_WORLD_COLUMNS - 1, row);
    const firstWindow = new Map(
      buildSectorWindowLayout(first).map((entry) => [`${entry.dx},${entry.dy}`, entry]),
    );
    expect(firstWindow.get("-1,0")).toEqual({
      sector: last,
      dx: -1,
      dy: 0,
    });
  });

  it("golden: Shirohana and sector 1620 use ordinary grid neighbors", () => {
    const shirohana = new Map(
      buildSectorWindowLayout(1631).map((entry) => [`${entry.dx},${entry.dy}`, entry.sector]),
    );
    expect(shirohana.get("0,1")).toBe(1559);
    expect(shirohana.get("1,0")).toBe(1632);
    expect(shirohana.get("0,-1")).toBe(1703);
    expect(shirohana.get("-1,0")).toBe(1630);
    expect(
      buildSectorWindowLayout(1620).find((entry) => entry.dx === -1 && entry.dy === 0),
    ).toEqual({ sector: 1619, dx: -1, dy: 0 });
  });
});
