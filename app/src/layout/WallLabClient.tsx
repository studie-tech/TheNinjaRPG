"use client";

import { useMemo, useState } from "react";
import {
  type CombatBiome,
  IMG_BUILDING_ACADEMY,
  IMG_BUILDING_BANK,
  IMG_BUILDING_HOSPITAL,
  IMG_BUILDING_MISSIONHALL,
} from "@/drizzle/constants";
import SectorPreview from "@/layout/SectorPreview";
import VillageWallAtlas from "@/layout/VillageWallAtlas";
import { DECORATION_ASSETS_BY_KEY } from "@/libs/sector-map/decorations";
import { BUILTIN_TERRAINS_BY_KEY } from "@/libs/sector-map/terrains";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { STONE_VILLAGE_WALL_KIT } from "@/libs/sector-map/village-wall-assets";
import { planVillageWalls } from "@/libs/sector-map/village-walls";
import { createGenericStructure } from "@/libs/threejs/sector";

type TerrainKey = "ground" | "dessert" | "snow" | "ice" | "ocean";

const fixtureCoordinates = {
  compact: [[9, 9]],
  forest: [[9, 9]],
  line: [
    [5, 9],
    [9, 9],
    [13, 9],
  ],
  diagonal: [
    [4, 4],
    [7, 7],
    [10, 10],
    [13, 13],
  ],
  lShape: [
    [5, 5],
    [5, 11],
    [11, 11],
  ],
  uShape: [
    [4, 5],
    [4, 12],
    [9, 12],
    [14, 12],
    [14, 5],
  ],
  nearBorder: [
    [3, 3],
    [8, 3],
    [14, 3],
  ],
  roadGate: [
    [6, 7],
    [12, 7],
    [6, 12],
    [12, 12],
  ],
} as const;

type FixtureKey = keyof typeof fixtureCoordinates;

const terrainBiome: Record<TerrainKey, CombatBiome> = {
  ground: "ground",
  dessert: "dessert",
  snow: "snow",
  ice: "ice",
  ocean: "ocean",
};

const buildingImages = [
  IMG_BUILDING_HOSPITAL,
  IMG_BUILDING_ACADEMY,
  IMG_BUILDING_BANK,
  IMG_BUILDING_MISSIONHALL,
];

const forestDecorationCoordinates = [
  [9, 6],
  [11, 6],
  [12, 8],
  [12, 10],
  [11, 12],
  [9, 12],
  [7, 12],
  [6, 10],
  [6, 8],
  [7, 6],
  [4, 5],
  [14, 5],
  [4, 13],
  [14, 13],
] as const;

const makeMap = (fixture: FixtureKey, terrain: TerrainKey): NormalizedSectorMap => {
  const width = 18;
  const height = 18;
  return {
    formatVersion: 1,
    sector: 0,
    name: `${fixture}-${terrain}`,
    width,
    height,
    tiles: Array.from({ length: width * height }, (_, index) => {
      const x = index % width;
      const y = Math.floor(index / width);
      const road = fixture === "roadGate" && x === 9;
      return {
        x,
        y,
        terrain,
        walkCost: 1,
        blocked: false,
        zone: road ? "road" : "village",
        battleBiome: terrainBiome[terrain],
        decoration: false,
      };
    }),
    objects:
      fixture === "forest"
        ? forestDecorationCoordinates.map(([x, y], index) => ({
            id: `forest-tree-${index}`,
            type: "decoration" as const,
            x,
            y,
            assetKey:
              index % 3 === 0
                ? "tree.green.tall"
                : index % 3 === 1
                  ? "tree.green.round"
                  : "tree.green.wide",
            scale: 2.2,
          }))
        : [],
    anchors: [{ key: "spawn.default", x: 9, y: 16 }],
    exits: [],
    metadata: {
      importedAt: "2026-07-22T00:00:00.000Z",
      source: "tiled",
      sourceHash: `${fixture}-${terrain}`,
    },
  };
};

const WallLabClient = () => {
  const [fixture, setFixture] = useState<FixtureKey>("compact");
  const [terrain, setTerrain] = useState<TerrainKey>("ground");
  const structures = useMemo(
    () =>
      fixtureCoordinates[fixture].map(([longitude, latitude], index) =>
        createGenericStructure({
          name: `Building ${index + 1}`,
          route: "/wall-lab",
          image: buildingImages[index % buildingImages.length] ?? IMG_BUILDING_HOSPITAL,
          longitude,
          latitude,
        }),
      ),
    [fixture],
  );
  const map = useMemo(() => makeMap(fixture, terrain), [fixture, terrain]);
  const plan = useMemo(() => planVillageWalls(map, structures), [map, structures]);
  const assetEntries = [
    ["Tower", STONE_VILLAGE_WALL_KIT.tower.url],
    ["Pier", STONE_VILLAGE_WALL_KIT.pier.url],
    ...Object.entries(STONE_VILLAGE_WALL_KIT.panels).map(([key, value]) => [
      `Panel ${key}`,
      value.url,
    ]),
    ...Object.entries(STONE_VILLAGE_WALL_KIT.gates).map(([key, value]) => [
      `Gate ${key}`,
      value.url,
    ]),
  ] as [string, string][];

  return (
    <main className="mx-auto max-w-7xl space-y-8 p-6">
      <div>
        <h1 className="font-bold text-2xl">Village wall adversarial lab</h1>
        <p className="text-muted-foreground text-sm">
          Kit {STONE_VILLAGE_WALL_KIT.version}; real Three.js sprite path and sector
          preview.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Generated source assets</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {assetEntries.map(([label, url]) => (
            <figure key={label} className="rounded-md bg-[#2563a6] p-2">
              {/* Deliberately use a blue matte to expose alpha residue. */}
              {/* biome-ignore lint/performance/noImgElement: QA must show raw CDN pixels. */}
              <img
                src={url}
                alt={label}
                className="aspect-square w-full object-contain"
              />
              <figcaption className="mt-1 text-center text-[10px] text-white">
                {label}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">All 27 wall/gate junction states</h2>
        <VillageWallAtlas />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          <label className="space-y-1 text-sm">
            <span className="block font-medium">Village shape</span>
            <select
              data-testid="wall-fixture"
              value={fixture}
              onChange={(event) => setFixture(event.target.value as FixtureKey)}
              className="rounded border bg-background px-3 py-2"
            >
              {Object.keys(fixtureCoordinates).map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="block font-medium">Terrain</span>
            <select
              data-testid="wall-terrain"
              value={terrain}
              onChange={(event) => setTerrain(event.target.value as TerrainKey)}
              className="rounded border bg-background px-3 py-2"
            >
              {Object.keys(terrainBiome).map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <p data-testid="wall-stats" className="text-muted-foreground text-sm">
            {structures.length} structures · {plan.interior.length} interior hexes ·{" "}
            {plan.edges.length} edges ·{" "}
            {plan.edges.filter((edge) => edge.kind === "gate").length} gates ·{" "}
            {plan.contours.length} contours
          </p>
        </div>
        <div className="overflow-hidden rounded-md border">
          <SectorPreview
            map={map}
            sector={0}
            decorationAssets={DECORATION_ASSETS_BY_KEY}
            terrainRegistry={BUILTIN_TERRAINS_BY_KEY}
            structures={structures}
            villageType="VILLAGE"
          />
        </div>
      </section>
    </main>
  );
};

export default WallLabClient;
