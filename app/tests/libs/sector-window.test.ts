import { describe, expect, it } from "vitest";
import globe from "@/data/hexasphere.json";
import { type EdgeIndex, seamRotation } from "@/libs/sector-map/crossing";
import {
  buildSectorWindowLayout,
  getSectorDiagonalIds,
  getSectorEntryEdges,
  getSectorNeighborIds,
  SectorNeighborDirections,
} from "@/server/utils/sectorMap";

const tiles = globe.tiles as { n?: number[] }[];
const FACE_TILES = tiles.length / 6;
const faceOf = (i: number) => Math.floor(i / FACE_TILES);

// Independent statement of the direction conventions (baked n[] order is
// [N, E, S, W]; edge indices 0=N, 1=E, 2=S, 3=W) and the grid offsets the
// client's 3x3 window renderer expects per direction
const CARDINAL_SPEC: Record<
  string,
  { dx: number; dy: number; edge: EdgeIndex }
> = {
  north: { dx: 0, dy: -1, edge: 0 },
  east: { dx: 1, dy: 0, edge: 1 },
  south: { dx: 0, dy: 1, edge: 2 },
  west: { dx: -1, dy: 0, edge: 3 },
};

describe("buildSectorWindowLayout (getSectorWindow assembly)", () => {
  it("lays out center, cardinals, and diagonals with correct offsets and rotations", () => {
    for (let sector = 0; sector < tiles.length; sector++) {
      const layout = buildSectorWindowLayout(sector);
      const bySector = new Map(layout.map((entry) => [entry.sector, entry]));

      // Center is present at (0, 0) with no rotation
      expect(bySector.get(sector)).toMatchObject({ dx: 0, dy: 0, rotation: 0 });

      // Every existing cardinal neighbor sits at its direction's offset, and
      // its rotation is the seam rotation of the shared edge; missing (polar)
      // neighbors are excluded entirely
      const neighbors = getSectorNeighborIds(sector);
      const entryEdges = getSectorEntryEdges(sector);
      for (const direction of SectorNeighborDirections) {
        const spec = CARDINAL_SPEC[direction]!;
        const neighbor = neighbors[direction];
        if (neighbor < 0) continue;
        const entry = bySector.get(neighbor);
        expect(entry).toMatchObject({ dx: spec.dx, dy: spec.dy });
        const expectedRotation = seamRotation(spec.edge, entryEdges[direction]);
        expect(entry?.rotation).toBe(expectedRotation);
        // Same-face neighbors are always aligned; cross-face are 0/1/3
        if (faceOf(neighbor) === faceOf(sector)) {
          expect(entry?.rotation).toBe(0);
        } else {
          expect([0, 1, 3]).toContain(entry?.rotation);
        }
      }

      // Diagonals render unrotated at the corner offsets
      const diagonals = getSectorDiagonalIds(sector);
      for (const [key, offset] of [
        ["northeast", { dx: 1, dy: -1 }],
        ["northwest", { dx: -1, dy: -1 }],
        ["southeast", { dx: 1, dy: 1 }],
        ["southwest", { dx: -1, dy: 1 }],
      ] as const) {
        const diagonal = diagonals[key];
        if (diagonal < 0) continue;
        expect(bySector.get(diagonal)).toMatchObject({ ...offset, rotation: 0 });
      }

      // No negative (missing) sectors ever leak into the layout
      expect(layout.every((entry) => entry.sector >= 0)).toBe(true);
    }
  });
});
