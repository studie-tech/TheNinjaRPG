import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import globe from "@/data/hexasphere.json";
import { MAP_WAKE_ISLAND_SECTOR } from "@/drizzle/constants";
import {
  WAKE_ISLAND_STRUCTURE_POSITIONS,
  WORLD_LANDMARKS,
} from "@/libs/sector-map/landmarks";
import {
  type EdgeIndex,
  sectorMapEdgeForGlobeEdge,
} from "@/libs/sector-map/crossing";
import {
  globalElevation,
  globalMoisture,
} from "@/libs/sector-map/worldgen";
import { buildTiledJson } from "../../scripts/generate-sector-map";

const TERRAIN_NAMES = ["ocean", "ground", "dessert", "ice"] as const;
const MAP_SIZE = 26;

type TerrainName = (typeof TERRAIN_NAMES)[number];

const GLOBE_COLORS = {
  ocean: 0x3f9ed9,
  ground: 0x3cc164,
  dessert: 0xe7cd89,
  ice: 0xdaebf0,
} as const;

const unpackColor = (packed: number) => [
  (packed >> 16) & 0xff,
  (packed >> 8) & 0xff,
  packed & 0xff,
];

/**
 * The label stem ends at tile.c. Since the visual grid has an even scale, that
 * point is exactly the middle vertex in vc rather than an average of nearby
 * sectors. Classify that rendered color so tests cover what a player actually
 * sees underneath each marker, not only the sector's majority biome.
 */
const globalMarkerTerrain = (sector: number): TerrainName => {
  const tile = globe.tiles[sector]!;
  const scale = globe.visualScale;
  const centerIndex = (scale / 2) * (scale + 1) + scale / 2;
  const color = unpackColor(tile.vc[centerIndex]!);
  return TERRAIN_NAMES.reduce((nearest, terrain) => {
    const target = unpackColor(GLOBE_COLORS[terrain]);
    const distance = color.reduce(
      (sum, channel, index) => sum + (channel - target[index]!) ** 2,
      0,
    );
    const nearestTarget = unpackColor(GLOBE_COLORS[nearest]);
    const nearestDistance = color.reduce(
      (sum, channel, index) => sum + (channel - nearestTarget[index]!) ** 2,
      0,
    );
    return distance < nearestDistance ? terrain : nearest;
  });
};

const angularDistanceDegrees = (sectorA: number, sectorB: number) => {
  const a = globe.tiles[sectorA]!.c;
  const b = globe.tiles[sectorB]!.c;
  const cosine =
    (a.x * b.x + a.y * b.y + a.z * b.z) / globe.radius ** 2;
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
};

const globalTerrainCounts = (sector: number) => {
  const counts = new Map<TerrainName, number>(
    TERRAIN_NAMES.map((name) => [name, 0]),
  );
  for (const terrain of globe.tiles[sector]!.v) {
    const name = TERRAIN_NAMES[terrain]!;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
};

const localTerrainGrid = (sector: number, village = true) => {
  const tiled = buildTiledJson({
    sector,
    width: MAP_SIZE,
    height: MAP_SIZE,
    village,
    seed: "v1",
    ensureWalkable: [],
  });
  const terrainData = tiled.layers[0]?.data;
  if (!terrainData) throw new Error(`Sector ${sector} has no terrain tile layer`);
  const terrainByGid = new Map(
    tiled.tilesets[0]!.tiles.map((tile) => [
      tile.id + 1,
      tile.properties.find((property) => property.name === "terrain")!.value as string,
    ]),
  );
  return terrainData.map((gid) => terrainByGid.get(gid)!);
};

describe("canonical world landmarks", () => {
  it("keeps every settlement on a distinct, intentional sector", () => {
    expect(
      Object.fromEntries(
        WORLD_LANDMARKS.map(({ name, sector }) => [name, sector]),
      ),
    ).toEqual({
      "Freedom State": 555,
      "Wake Island": 222,
      Akikaze: 724,
      Horizon: 301,
      Tsukimori: 1490,
      "Iron Shield": 352,
      Syndicate: 1062,
      SafariFaction: 1000,
      Hyorin: 177,
      Shirohana: 1538,
      Akasumi: 1335,
    });
    expect(new Set(WORLD_LANDMARKS.map(({ sector }) => sector)).size).toBe(
      WORLD_LANDMARKS.length,
    );
  });

  it("places every landmark in the biome implied by its setting", () => {
    for (const landmark of WORLD_LANDMARKS) {
      const counts = globalTerrainCounts(landmark.sector);
      if (
        landmark.expectedTerrain === "ground" ||
        landmark.expectedTerrain === "dessert" ||
        landmark.expectedTerrain === "ice"
      ) {
        expect(
          counts.get(landmark.expectedTerrain),
          landmark.name,
        ).toBeGreaterThanOrEqual(30);
      } else if (landmark.expectedTerrain === "lush") {
        expect(counts.get("ground"), landmark.name).toBeGreaterThanOrEqual(30);
        const center = globe.tiles[landmark.sector]!.c;
        expect(
          globalMoisture(center, globalElevation(center)),
          `${landmark.name} moisture`,
        ).toBeGreaterThan(0.6);
      } else if (landmark.expectedTerrain === "highland") {
        expect(counts.get("ground"), landmark.name).toBeGreaterThanOrEqual(30);
        expect(
          globalElevation(globe.tiles[landmark.sector]!.c),
          `${landmark.name} elevation`,
        ).toBeGreaterThan(0.5);
      } else if (landmark.expectedTerrain === "coast") {
        expect(counts.get("ground"), landmark.name).toBeGreaterThanOrEqual(12);
        expect(counts.get("ocean"), landmark.name).toBeGreaterThanOrEqual(12);
      } else {
        expect(counts.get("ground"), landmark.name).toBeGreaterThanOrEqual(8);
        expect(counts.get("ocean"), landmark.name).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it("anchors every global-map marker on its intended visible biome", () => {
    for (const landmark of WORLD_LANDMARKS) {
      const expectedCenter =
        landmark.expectedTerrain === "dessert" ||
        landmark.expectedTerrain === "ice"
          ? landmark.expectedTerrain
          : "ground";
      const tile = globe.tiles[landmark.sector]!;

      // t is generated from tile.c, the exact point used by the marker stem.
      expect(TERRAIN_NAMES[tile.t], `${landmark.name} center biome`).toBe(
        expectedCenter,
      );
      expect(
        globalMarkerTerrain(landmark.sector),
        `${landmark.name} marker color`,
      ).toBe(expectedCenter);
    }
  });

  it("keeps starting village Horizon geographically close to Wake Island", () => {
    const horizon = WORLD_LANDMARKS.find(({ name }) => name === "Horizon")!;
    expect(angularDistanceDegrees(horizon.sector, MAP_WAKE_ISLAND_SECTOR)).toBeLessThan(
      30,
    );
  });

  it("renders Wake Island as land inside one sector and ocean around it", () => {
    const wake = globe.tiles[MAP_WAKE_ISLAND_SECTOR]!;
    expect(wake.t).toBe(1);
    expect(wake.n.map((sector) => globe.tiles[sector]!.t)).toEqual([0, 0, 0, 0]);
    for (const neighbor of wake.n) {
      expect(new Set(globe.tiles[neighbor]!.v)).toEqual(new Set([0]));
    }

    const terrain = localTerrainGrid(MAP_WAKE_ISLAND_SECTOR);
    const ocean = terrain.filter((value) => value === "ocean").length;
    const island = terrain.length - ocean;
    expect(ocean).toBeGreaterThan(terrain.length * 0.5);
    expect(island).toBeGreaterThan(terrain.length * 0.3);
    expect(terrain[7 * MAP_SIZE + 13]).toBe("ground");
    expect(terrain[5 * MAP_SIZE + 13]).toBe("ground");
    expect(terrain[0 * MAP_SIZE + 13]).toBe("ocean");
    expect(terrain[13 * MAP_SIZE + 0]).toBe("ocean");
    for (const structure of WAKE_ISLAND_STRUCTURE_POSITIONS) {
      expect(
        terrain[structure.y * MAP_SIZE + structure.x],
        structure.name,
      ).not.toBe("ocean");
    }
  });

  it("keeps every generated local-map seam terrain-identical", () => {
    const grids = globe.tiles.map((_, sector) => localTerrainGrid(sector, false));
    const edge = (grid: string[], side: number) => {
      if (side === 0) return grid.slice(0, MAP_SIZE);
      if (side === 2) return grid.slice((MAP_SIZE - 1) * MAP_SIZE);
      return Array.from({ length: MAP_SIZE }, (_, y) =>
        grid[y * MAP_SIZE + (side === 1 ? MAP_SIZE - 1 : 0)],
      );
    };
    const mismatches: string[] = [];
    for (let sector = 0; sector < globe.tiles.length; sector++) {
      for (const side of [1, 2] as const) {
        const neighbor = globe.tiles[sector]!.n[side]!;
        if (neighbor < 0) continue;
        const entry = globe.tiles[sector]!.ne[side]!;
        const mapSide = sectorMapEdgeForGlobeEdge(side);
        const mapEntry = sectorMapEdgeForGlobeEdge(entry as EdgeIndex);
        if (
          edge(grids[sector]!, mapSide).join("|") !==
          edge(grids[neighbor]!, mapEntry).join("|")
        ) {
          mismatches.push(`${sector}:${side}->${neighbor}:${entry}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  }, 20_000);

  it("spills reserved polar terrain naturally into adjacent sectors", () => {
    const northOfReservedSector = localTerrainGrid(0, false);
    const ice = northOfReservedSector.filter((terrain) => terrain === "ice").length;
    expect(ice).toBeGreaterThan(northOfReservedSector.length * 0.25);
    expect(ice).toBeLessThan(northOfReservedSector.length * 0.6);
  });

  it("uses the same biome families in generated local village maps", () => {
    for (const landmark of WORLD_LANDMARKS) {
      const terrain = localTerrainGrid(landmark.sector);
      const count = (name: string) => terrain.filter((value) => value === name).length;
      if (
        landmark.expectedTerrain === "ground" ||
        landmark.expectedTerrain === "dessert" ||
        landmark.expectedTerrain === "ice"
      ) {
        expect(count(landmark.expectedTerrain), landmark.name).toBeGreaterThan(
          terrain.length * 0.75,
        );
      } else if (
        landmark.expectedTerrain === "lush" ||
        landmark.expectedTerrain === "highland"
      ) {
        expect(count("ground"), landmark.name).toBeGreaterThan(terrain.length * 0.9);
      } else {
        expect(count("ocean"), landmark.name).toBeGreaterThan(terrain.length * 0.35);
        expect(count("ground") + count("dessert"), landmark.name).toBeGreaterThan(
          terrain.length * 0.3,
        );
      }
    }
  });

  it("keeps the SQL relocation migration aligned with the canonical list", () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "drizzle/migrations/0021_relocate_world_landmarks.sql",
      ),
      "utf8",
    );
    for (const landmark of WORLD_LANDMARKS) {
      if (landmark.legacySectors.every((sector) => sector === landmark.sector)) {
        continue;
      }
      expect(sql).toContain(`WHERE \`name\` = '${landmark.name}'`);
      expect(sql).toContain(`SET \`sector\` = ${landmark.sector}`);
      for (const legacySector of landmark.legacySectors) {
        expect(sql, `${landmark.name} legacy sector ${legacySector}`).toMatch(
          new RegExp(
            "WHERE `sector` (?:= " +
              legacySector +
              "|IN \\([^)]*\\b" +
              legacySector +
              "\\b)",
          ),
        );
      }
    }
    for (const structure of WAKE_ISLAND_STRUCTURE_POSITIONS) {
      expect(sql).toContain(
        `SET \`longitude\` = ${structure.x}, \`latitude\` = ${structure.y}`,
      );
      expect(sql).toContain(`WHERE \`name\` = '${structure.name}'`);
    }
  });

  it("normalizes seeded villages through the canonical landmark list", () => {
    const seed = readFileSync(
      resolve(process.cwd(), "drizzle/seeds/village.ts"),
      "utf8",
    );
    expect(seed).toContain('import { WORLD_LANDMARKS }');
    expect(seed).toContain("for (const landmark of WORLD_LANDMARKS)");
    expect(seed).toContain(".set({ sector: landmark.sector })");
  });
});
