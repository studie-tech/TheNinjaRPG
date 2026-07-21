import { describe, it, expect } from "vitest";
import globe from "@/data/hexasphere.json";
import {
  edgeCell,
  edgeLength,
  edgeParam,
  paramFlips,
  mapParam,
  seamRotation,
  resolveEdgeCrossing,
  resolveSectorMapEdgeCrossing,
  sectorMapEdgeForGlobeEdge,
  EDGE_NORTH,
  EDGE_EAST,
  EDGE_SOUTH,
  EDGE_WEST,
  type EdgeIndex,
} from "@/libs/sector-map/crossing";
import {
  getSectorEntryEdges,
  getSectorNeighborIds,
  resolveSectorCrossing,
  SectorNeighborDirections,
} from "@/server/utils/sectorMap";

type Corner = { x: string; y: string; z: string };
const tiles = globe.tiles as { n?: number[]; ne?: number[]; b?: Corner[] }[];
const W = 26;
const H = 26;
// 6 cube faces; a tile's face is its id / tiles-per-face (324 for an 18x18 face)
const FACE_TILES = tiles.length / 6;
const faceOf = (i: number) => Math.floor(i / FACE_TILES);

describe("crossing edge primitives", () => {
  it("places interior-most cells on the correct edge", () => {
    expect(edgeCell(EDGE_NORTH, 5, W, H)).toEqual({ x: 5, y: 0 });
    expect(edgeCell(EDGE_SOUTH, 5, W, H)).toEqual({ x: 5, y: H - 1 });
    expect(edgeCell(EDGE_WEST, 7, W, H)).toEqual({ x: 0, y: 7 });
    expect(edgeCell(EDGE_EAST, 7, W, H)).toEqual({ x: W - 1, y: 7 });
  });

  it("reads the along-edge parameter back out of a cell", () => {
    expect(edgeParam(EDGE_NORTH, 5, 0)).toBe(5);
    expect(edgeParam(EDGE_EAST, W - 1, 7)).toBe(7);
  });

  it("does not flip the aligned north<->south parameter", () => {
    expect(paramFlips(EDGE_NORTH, EDGE_SOUTH)).toBe(false);
    expect(paramFlips(EDGE_EAST, EDGE_WEST)).toBe(false);
  });

  it("maps parameters proportionally with optional flip", () => {
    expect(mapParam(0, 26, 26, false)).toBe(0);
    expect(mapParam(25, 26, 26, false)).toBe(25);
    expect(mapParam(0, 26, 26, true)).toBe(25);
    expect(mapParam(25, 26, 26, true)).toBe(0);
  });

  it("reports zero rotation for aligned neighbours", () => {
    expect(seamRotation(EDGE_NORTH, EDGE_SOUTH)).toBe(0);
    expect(seamRotation(EDGE_EAST, EDGE_WEST)).toBe(0);
  });

  it("adapts all rendered edges across differently sized maps", () => {
    expect(
      resolveSectorMapEdgeCrossing(
        EDGE_NORTH,
        1,
        5,
        4,
        6,
        EDGE_SOUTH,
        8,
        10,
      ),
    ).toEqual({ entryEdge: EDGE_NORTH, entryX: 2, entryY: 0 });
    expect(
      resolveSectorMapEdgeCrossing(
        EDGE_SOUTH,
        2,
        0,
        4,
        6,
        EDGE_NORTH,
        8,
        10,
      ),
    ).toEqual({ entryEdge: EDGE_SOUTH, entryX: 5, entryY: 9 });
    expect(
      resolveSectorMapEdgeCrossing(
        EDGE_EAST,
        3,
        1,
        4,
        6,
        EDGE_WEST,
        8,
        10,
      ),
    ).toEqual({ entryEdge: EDGE_WEST, entryX: 0, entryY: 2 });
    expect(
      resolveSectorMapEdgeCrossing(
        EDGE_WEST,
        0,
        4,
        4,
        6,
        EDGE_EAST,
        8,
        10,
      ),
    ).toEqual({ entryEdge: EDGE_EAST, entryX: 7, entryY: 7 });
  });
});

describe("cube-sphere crossing topology", () => {
  it("every tile has 4 neighbours and entry edges with no polar sentinel", () => {
    for (const t of tiles) {
      expect(t.n?.length).toBe(4);
      expect(t.ne?.length).toBe(4);
      expect(t.n?.every((id) => id >= 0 && id < tiles.length)).toBe(true);
      expect(t.ne?.every((e) => e >= 0 && e < 4)).toBe(true);
    }
  });

  it("within-face neighbours are aligned (entry edge = opposite, param preserved)", () => {
    for (let s = 0; s < tiles.length; s++) {
      const n = tiles[s]!.n!;
      const ne = tiles[s]!.ne!;
      for (let e = 0; e < 4; e++) {
        if (faceOf(s) !== faceOf(n[e]!)) continue;
        expect(ne[e]).toBe((e + 2) % 4);
        const exit = edgeCell(e as EdgeIndex, 9, W, H);
        const res = resolveEdgeCrossing(
          e as EdgeIndex,
          exit.x,
          exit.y,
          W,
          H,
          ne[e] as EdgeIndex,
          W,
          H,
        );
        expect(edgeParam(ne[e] as EdgeIndex, res.entryX, res.entryY)).toBe(9);
      }
    }
  });

  it("every crossing is reciprocal: A -> B -> A returns to the exact start cell", () => {
    let checked = 0;
    for (let s = 0; s < tiles.length; s++) {
      const n = tiles[s]!.n!;
      const ne = tiles[s]!.ne!;
      for (let e = 0; e < 4; e++) {
        const exitEdge = e as EdgeIndex;
        const nb = n[e]!;
        const entryEdge = ne[e]! as EdgeIndex;
        for (let p = 0; p < W; p++) {
          const exit = edgeCell(exitEdge, p, W, H);
          const res = resolveEdgeCrossing(exitEdge, exit.x, exit.y, W, H, entryEdge, W, H);
          const backEntryEdge = tiles[nb]!.ne![entryEdge]! as EdgeIndex;
          const back = resolveEdgeCrossing(
            entryEdge,
            res.entryX,
            res.entryY,
            W,
            H,
            backEntryEdge,
            W,
            H,
          );
          expect(tiles[nb]!.n![entryEdge]).toBe(s);
          expect(back.entryX).toBe(exit.x);
          expect(back.entryY).toBe(exit.y);
          checked++;
        }
      }
    }
    expect(checked).toBe(tiles.length * 4 * W);
  });

  it("golden: paramFlips matches the shared 3D-corner geometry (catches handedness)", () => {
    // Reciprocity only proves the crossing is symmetric; a handedness bug in
    // paramFlips would flip BOTH directions and still round-trip. Here we derive
    // the expected flip independently from the tiles' 3D corners (which the
    // generator matched to build the seam), so a mirrored mapping fails loudly.
    //
    // Corners are stored [NW, NE, SE, SW]; edge e spans corners {e, (e+1)%4}.
    // The along-edge parameter starts (p=0) and ends (p=last) at these corners:
    const START_CORNER = [0, 1, 3, 0] as const; // N, E, S, W
    const END_CORNER = [1, 2, 2, 3] as const;
    const key = (c: Corner) => `${c.x},${c.y},${c.z}`;
    let seamsChecked = 0;
    for (let s = 0; s < tiles.length; s++) {
      const n = tiles[s]!.n!;
      const ne = tiles[s]!.ne!;
      const a = tiles[s]!.b!;
      for (let e = 0; e < 4; e++) {
        const exitEdge = e as EdgeIndex;
        const entryEdge = ne[e]! as EdgeIndex;
        const b = tiles[n[e]!]!.b!;
        // The two edges must be the exact same 3D segment (validates adjacency
        // and the corner convention this test relies on).
        const edgeA = [key(a[START_CORNER[exitEdge]]!), key(a[END_CORNER[exitEdge]]!)];
        const edgeB = [key(b[START_CORNER[entryEdge]]!), key(b[END_CORNER[entryEdge]]!)];
        expect([...edgeA].sort()).toEqual([...edgeB].sort());
        // Flip iff this tile's p=0 corner coincides with the neighbour's p=last.
        const aStart = key(a[START_CORNER[exitEdge]]!);
        const geoFlip = aStart !== key(b[START_CORNER[entryEdge]]!);
        if (geoFlip) expect(aStart).toBe(key(b[END_CORNER[entryEdge]]!));
        expect(paramFlips(exitEdge, entryEdge)).toBe(geoFlip);
        seamsChecked++;
      }
    }
    expect(seamsChecked).toBe(tiles.length * 4);
  });

  it("seams carry only pure rotations (0, 90, 270 - never 180 or reflections)", () => {
    const rots = new Set<number>();
    for (let s = 0; s < tiles.length; s++) {
      const n = tiles[s]!.n!;
      const ne = tiles[s]!.ne!;
      for (let e = 0; e < 4; e++) {
        if (faceOf(s) === faceOf(n[e]!)) continue;
        rots.add(seamRotation(e as EdgeIndex, ne[e] as EdgeIndex));
      }
    }
    expect([...rots].sort()).toEqual([0, 1, 3]);
  });
});

describe("game crossing wrapper (travel.moveInSector path)", () => {
  // The primitives above prove the math; this proves the WRAPPER the game
  // actually calls - resolveSectorCrossing and the named-direction accessors -
  // wires directions, edges, and the baked n/ne data together correctly. A
  // scrambled DIRECTION_TO_EDGE or swapped accessor field would fail here.
  it("maps every rendered edge to the correct globe neighbour and back", () => {
    let checked = 0;
    for (let s = 0; s < tiles.length; s++) {
      const neighbors = getSectorNeighborIds(s);
      const entryEdges = getSectorEntryEdges(s);
      SectorNeighborDirections.forEach((direction, d) => {
        // Named accessors must match the baked [N, E, S, W] arrays
        expect(neighbors[direction]).toBe(tiles[s]!.n![d]);
        expect(entryEdges[direction]).toBe(tiles[s]!.ne![d]);

        const globeExitEdge = d as EdgeIndex;
        const mapExitEdge = sectorMapEdgeForGlobeEdge(globeExitEdge);
        const globeEntryEdge = tiles[s]!.ne![d]! as EdgeIndex;
        const mapEntryEdge = sectorMapEdgeForGlobeEdge(globeEntryEdge);

        // Every cell on the rendered edge lands in the baked globe neighbour.
        // This is exhaustive because a corner-only/sample test can miss a
        // reversed along-edge parameter on rotated seams.
        for (let p = 0; p < edgeLength(mapExitEdge, W, H); p++) {
          const exit = edgeCell(mapExitEdge, p, W, H);
          const res = resolveSectorCrossing(s, direction, exit.x, exit.y, W, H, W, H);
          expect(res.toSector).toBe(tiles[s]!.n![d]);
          expect(res.entryEdge).toBe(mapEntryEdge);

          // Independent rendered<->globe parameter conversion. The vertical
          // reflection reverses parameters only on E/W edges.
          const globeExitParam =
            globeExitEdge === EDGE_EAST || globeExitEdge === EDGE_WEST
              ? W - 1 - p
              : p;
          const globeEntryParam = mapParam(
            globeExitParam,
            W,
            W,
            paramFlips(globeExitEdge, globeEntryEdge),
          );
          const expectedMapEntryParam =
            globeEntryEdge === EDGE_EAST || globeEntryEdge === EDGE_WEST
              ? W - 1 - globeEntryParam
              : globeEntryParam;
          expect(edgeParam(mapEntryEdge, res.entryX, res.entryY)).toBe(
            expectedMapEntryParam,
          );

          // ...and crossing back through the wrapper returns to the start cell
          const back = resolveSectorCrossing(
            res.toSector,
            SectorNeighborDirections[globeEntryEdge]!,
            res.entryX,
            res.entryY,
            W,
            H,
            W,
            H,
          );
          expect(back.toSector).toBe(s);
          expect(back.entryX).toBe(exit.x);
          expect(back.entryY).toBe(exit.y);
          checked++;
        }
      });
    }
    expect(checked).toBe(tiles.length * 4 * W);
  }, 20_000);

  it("golden: Shirohana's rendered south edge leads south, not north/east", () => {
    const shirohana = 1631;
    const south = resolveSectorCrossing(
      shirohana,
      "south",
      13,
      0,
      W,
      H,
      W,
      H,
    );
    expect(south).toEqual({
      toSector: 1649,
      entryEdge: EDGE_SOUTH,
      entryX: 13,
      entryY: H - 1,
    });
    expect(getSectorNeighborIds(shirohana).east).toBe(1632);
  });

  it("the dedicated rendered-edge primitive agrees with the game wrapper", () => {
    for (let sector = 0; sector < tiles.length; sector++) {
      const neighbors = getSectorNeighborIds(sector);
      const entryEdges = getSectorEntryEdges(sector);
      SectorNeighborDirections.forEach((direction, d) => {
        const globeExitEdge = d as EdgeIndex;
        const mapExitEdge = sectorMapEdgeForGlobeEdge(globeExitEdge);
        const exit = edgeCell(mapExitEdge, 7, W, H);
        const primitive = resolveSectorMapEdgeCrossing(
          globeExitEdge,
          exit.x,
          exit.y,
          W,
          H,
          entryEdges[direction],
          W,
          H,
        );
        expect(resolveSectorCrossing(sector, direction, exit.x, exit.y, W, H, W, H)).toEqual({
          toSector: neighbors[direction],
          ...primitive,
        });
      });
    }
  });
});
