import { describe, expect, it } from "vitest";
import type { NormalizedSectorTile, SectorCoordinate } from "@/libs/sector-map/types";
import { getNeighborCoordinates, getSectorTileKey } from "@/libs/sector-map/validation";
import {
  getOddQHexDistance,
  getVillageWallDecorationClearanceKeys,
  getVillageWallFoundationKeys,
  getVillageWallAxis,
  isVillageStructurePlacementAllowed,
  planVillageWalls,
  selectVillageWallTowerVertices,
  usesVillageWalls,
} from "@/libs/sector-map/village-walls";

describe("usesVillageWalls", () => {
  it("only enables walls for village and town settlements", () => {
    expect(usesVillageWalls("VILLAGE")).toBe(true);
    expect(usesVillageWalls("TOWN")).toBe(true);
    expect(usesVillageWalls("OUTLAW")).toBe(false);
    expect(usesVillageWalls("HIDEOUT")).toBe(false);
    expect(usesVillageWalls("SAFEZONE")).toBe(false);
    expect(usesVillageWalls(null)).toBe(false);
  });
});

describe("getVillageWallAxis", () => {
  it("maps odd-q directions to signed screen-space sprite slopes", () => {
    expect(Array.from({ length: 6 }, (_, direction) => getVillageWallAxis(direction))).toEqual(
      [
        "horizontal",
        "horizontal",
        "diagonalUp",
        "diagonalDown",
        "diagonalDown",
        "diagonalUp",
      ],
    );
  });
});

const makeMap = (width = 11, height = 11) => {
  const tiles: NormalizedSectorTile[] = Array.from(
    { length: width * height },
    (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return {
      x,
      y,
      terrain: "ground",
      walkCost: 1,
      blocked: false,
      zone: "village",
      battleBiome: "ground",
      } satisfies NormalizedSectorTile;
    },
  );
  return {
    width,
    height,
    tiles,
    anchors: [{ key: "spawn.default", x: Math.floor(width / 2), y: height - 2 }],
  };
};

const physical = (x: number, y: number) => ({
  longitude: x,
  latitude: y,
  hasPage: 1,
});

const componentCount = (points: SectorCoordinate[]) => {
  const remaining = new Set(points.map((point) => getSectorTileKey(point.x, point.y)));
  let count = 0;
  while (remaining.size > 0) {
    count++;
    const first = remaining.values().next().value as string;
    const [x = "0", y = "0"] = first.split(",");
    const queue = [{ x: Number(x), y: Number(y) }];
    remaining.delete(first);
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      if (!current) continue;
      for (const neighbor of getNeighborCoordinates(current)) {
        const key = getSectorTileKey(neighbor.x, neighbor.y);
        if (!remaining.delete(key)) continue;
        queue.push(neighbor);
      }
    }
  }
  return count;
};

describe("isVillageStructurePlacementAllowed", () => {
  it("requires three complete hex rings inside the sector", () => {
    const map = makeMap(9, 9);
    expect(isVillageStructurePlacementAllowed(map, { x: 4, y: 4 })).toBe(true);
    expect(isVillageStructurePlacementAllowed(map, { x: 3, y: 3 })).toBe(true);
    expect(isVillageStructurePlacementAllowed(map, { x: 2, y: 4 })).toBe(false);
    expect(isVillageStructurePlacementAllowed(map, { x: 4, y: 2 })).toBe(false);
    expect(isVillageStructurePlacementAllowed(map, { x: 6, y: 4 })).toBe(false);
    expect(isVillageStructurePlacementAllowed(map, { x: 4, y: 6 })).toBe(false);
  });

  it("handles odd and even column parity at corners", () => {
    const map = makeMap(10, 10);
    expect(isVillageStructurePlacementAllowed(map, { x: 3, y: 3 })).toBe(true);
    expect(isVillageStructurePlacementAllowed(map, { x: 4, y: 3 })).toBe(true);
    expect(isVillageStructurePlacementAllowed(map, { x: 3, y: 2 })).toBe(false);
    expect(isVillageStructurePlacementAllowed(map, { x: 4, y: 2 })).toBe(false);
  });
});

describe("planVillageWalls", () => {
  it("returns no wall when no physical structures exist", () => {
    const plan = planVillageWalls(makeMap(), [
      { longitude: -1, latitude: -1, hasPage: 1 },
      { longitude: 5, latitude: 5, hasPage: 0 },
    ]);
    expect(plan).toEqual({
      structures: [],
      interior: [],
      edges: [],
      vertices: [],
      contours: [],
    });
  });

  it("builds a closed footprint-aware enclosure around one structure", () => {
    const structure = { x: 5, y: 5 };
    const plan = planVillageWalls(makeMap(), [physical(structure.x, structure.y)]);
    expect(plan.interior).toHaveLength(19);
    expect(plan.edges).toHaveLength(30);
    expect(plan.vertices.every((vertex) => vertex.edges.length === 2)).toBe(true);
    expect(plan.contours).toHaveLength(1);
    expect(plan.contours[0]).toHaveLength(plan.vertices.length);
    expect(
      plan.edges.every((edge) => getOddQHexDistance(structure, edge.tile) >= 2),
    ).toBe(true);
  });

  it("reserves a canopy-safe decoration clearing around every wall", () => {
    const plan = planVillageWalls(makeMap(), [physical(5, 5)]);
    const clearance = getVillageWallDecorationClearanceKeys(plan);
    for (const edge of plan.edges) {
      expect(clearance.has(getSectorTileKey(edge.tile.x, edge.tile.y))).toBe(true);
      const outside = getNeighborCoordinates(edge.tile)[edge.direction];
      expect(outside).toBeDefined();
      if (outside) {
        expect(clearance.has(getSectorTileKey(outside.x, outside.y))).toBe(true);
        expect(
          getNeighborCoordinates(outside).every((neighbor) =>
            clearance.has(getSectorTileKey(neighbor.x, neighbor.y)),
          ),
        ).toBe(true);
      }
    }
    expect(clearance.has("5,5")).toBe(false);
  });

  it("marks the village-side terrain below every wall segment as foundation", () => {
    const plan = planVillageWalls(makeMap(), [physical(5, 5)]);
    const foundations = getVillageWallFoundationKeys(plan);
    expect(foundations.size).toBeGreaterThan(0);
    for (const edge of plan.edges) {
      expect(foundations.has(getSectorTileKey(edge.tile.x, edge.tile.y))).toBe(true);
      const outside = getNeighborCoordinates(edge.tile)[edge.direction];
      if (outside) {
        expect(foundations.has(getSectorTileKey(outside.x, outside.y))).toBe(false);
      }
    }
  });

  it("connects far-apart protected regions into one deterministic enclosure", () => {
    const structures = [physical(3, 3), physical(8, 7), physical(4, 8)];
    const forward = planVillageWalls(makeMap(12, 12), structures);
    const reverse = planVillageWalls(makeMap(12, 12), [...structures].reverse());
    expect(componentCount(forward.interior)).toBe(1);
    expect(forward.edges).toEqual(reverse.edges);
    expect(forward.vertices.every((vertex) => vertex.edges.length === 2)).toBe(true);
    for (const structure of structures) {
      expect(
        getNeighborCoordinates({ x: structure.longitude, y: structure.latitude }).every(
          (neighbor) =>
            forward.interior.some(
              (point) => point.x === neighbor.x && point.y === neighbor.y,
            ),
        ),
      ).toBe(true);
    }
  });

  it("deduplicates identical structure coordinates", () => {
    const plan = planVillageWalls(makeMap(), [physical(5, 5), physical(5, 5)]);
    expect(plan.structures).toEqual([{ x: 5, y: 5 }]);
  });

  it("places one gate where a road crosses the wall", () => {
    const map = makeMap();
    const roadKeys = new Set(["5,7", "5,8"]);
    map.tiles = map.tiles.map((tile) =>
      roadKeys.has(getSectorTileKey(tile.x, tile.y))
        ? { ...tile, zone: "road" as const }
        : tile,
    );
    const plan = planVillageWalls(map, [physical(5, 5)]);
    const gates = plan.edges.filter((edge) => edge.kind === "gate");
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({
      tile: { x: 5, y: 7 },
      direction: 0,
      axis: "horizontal",
    });
  });

  it("does not treat a tangential road as a crossing", () => {
    const map = makeMap();
    map.anchors = [];
    map.tiles = map.tiles.map((tile) =>
      tile.x === 5 && tile.y === 7 ? { ...tile, zone: "road" as const } : tile,
    );
    const plan = planVillageWalls(map, [physical(5, 5)]);
    expect(plan.edges.some((edge) => edge.kind === "gate")).toBe(false);
  });

  it("falls back to the wall edge closest to spawn.default", () => {
    const plan = planVillageWalls(makeMap(), [physical(5, 5)]);
    expect(plan.edges.filter((edge) => edge.kind === "gate")).toHaveLength(1);
  });

  it("never emits duplicate wall edges or invalid vertex degrees", () => {
    const plan = planVillageWalls(makeMap(16, 16), [
      physical(3, 3),
      physical(12, 3),
      physical(4, 12),
      physical(11, 11),
      physical(7, 7),
    ]);
    const ids = plan.edges.map(
      (edge) => `${edge.tile.x},${edge.tile.y},${edge.direction}`,
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.vertices.every((vertex) => vertex.edges.length === 2)).toBe(true);
  });

  it("places a bounded set of towers on salient, well-spaced contour corners", () => {
    const plan = planVillageWalls(makeMap(18, 18), [
      physical(4, 8),
      physical(9, 8),
      physical(14, 8),
    ]);
    const contour = plan.contours[0] ?? [];
    const gateVertices = new Set(
      plan.edges
        .filter((edge) => edge.kind === "gate")
        .flatMap((edge) => [...edge.vertices]),
    );
    const towers = selectVillageWallTowerVertices(contour, gateVertices, 4);
    expect(towers).toHaveLength(4);
    expect(towers.every((vertex) => !gateVertices.has(vertex))).toBe(true);
    const indices = towers.map((vertex) => contour.indexOf(vertex));
    expect(
      indices.every((index, position) =>
        indices.slice(position + 1).every((other) => {
          const distance = Math.abs(index - other);
          return Math.min(distance, contour.length - distance) >= 2;
        }),
      ),
    ).toBe(true);
  });
});
