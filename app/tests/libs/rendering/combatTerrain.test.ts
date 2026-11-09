import alea from "alea";
import { describe, expect, it } from "bun:test";
import { COMBAT_BIOMES } from "@/drizzle/constants";
import type { ReturnedBattle } from "@/libs/combat/types";
import { getProceduralTerrain } from "@/libs/rendering/proceduralBiomes";
import {
  isCombatTile,
  prepareCombatTerrain,
} from "@/libs/rendering/scenes/combatTerrain";
import { hexTerrainAt } from "@/libs/rendering/terrainData";

const battle = (background: ReturnedBattle["background"] = "ground") =>
  ({ id: "battle", width: 12, height: 10, background }) as ReturnedBattle;
const prepare = (background: ReturnedBattle["background"], light = false) =>
  prepareCombatTerrain(1024, battle(background), alea("arena"), light);

describe("procedural terrain bands", () => {
  const bands: Record<string, [level: number, key: string, variant: number][]> = {
    ocean: [
      [0.29, "ocean", 0],
      [0.3, "ocean", 1],
      [0.6, "ocean", 2],
      [0.8, "dessert", 0],
      [0.85, "dessert", 1],
      [0.9, "dessert", 2],
      [0.95, "ground", 2],
      [1, "ground", 2],
    ],
    ground: [
      [0, "ocean", 0],
      [0.05, "ocean", 1],
      [0.1, "ocean", 2],
      [0.15, "ground", 2],
      [0.2, "ground", 1],
      [0.5, "ground", 0],
      [0.8, "dessert", 0],
      [0.9, "dessert", 1],
      [0.95, "dessert", 2],
    ],
    dessert: [
      [0, "ocean", 2],
      [0.05, "ground", 2],
      [0.1, "dessert", 0],
      [0.3, "dessert", 1],
      [0.6, "dessert", 2],
    ],
    ice: [
      [0, "ocean", 2],
      [0.05, "ice", 0],
      [0.1, "ice", 1],
      [0.2, "ice", 2],
      [0.25, "snow", 0],
      [0.3, "snow", 1],
      [0.6, "snow", 2],
    ],
  };
  const biomes = {
    ocean: "ocean",
    ground: "ground",
    default: "ground",
    arena: "ground",
    dessert: "dessert",
    ice: "ice",
    snow: "ice",
  } as const;

  it.each(COMBAT_BIOMES)("starts each %s band at its limit", (biome) => {
    for (const [level, key, variant] of bands[biomes[biome]]!) {
      expect(getProceduralTerrain({ level }, biome)).toMatchObject({
        spec: { key },
        variant,
      });
    }
  });

  it("renders a missing biome as the default", () => {
    const missing = undefined as unknown as ReturnedBattle["background"];
    expect(getProceduralTerrain({ level: 0.3 }, missing)).toEqual(
      getProceduralTerrain({ level: 0.3 }, "default"),
    );
  });

  it.each(COMBAT_BIOMES)(
    "gives %s its top band for a level that compares to nothing",
    (biome) => {
      const top = bands[biomes[biome]]!.at(-1)!;
      expect(getProceduralTerrain({ level: Number.NaN }, biome)).toMatchObject({
        spec: { key: top[1] },
        variant: top[2],
      });
    },
  );
});

describe("combat terrain preparation", () => {
  it("preserves the procedural biome threshold boundaries", () => {
    expect(getProceduralTerrain({ level: 0.04 }, "ground").spec.key).toBe("ocean");
    expect(getProceduralTerrain({ level: 0.2 }, "ground")).toMatchObject({
      spec: { key: "ground" },
      variant: 1,
    });
    expect(getProceduralTerrain({ level: 0.9 }, "ocean")).toMatchObject({
      spec: { key: "dessert" },
      variant: 2,
    });
    expect(getProceduralTerrain({ level: 0.25 }, "ice").spec.key).toBe("snow");
  });
  it.each(COMBAT_BIOMES)(
    "keeps the %s grid, costs and decorations deterministic",
    (background) => {
      const first = prepare(background),
        second = prepare(background);
      expect(first.scenery).toEqual(second.scenery);
      expect(first.terrain.segments).toEqual(second.terrain.segments);
      expect(first.grid.size).toBe(120);
      expect(first.grid.toArray().map((tile) => tile.cost)).toEqual(
        second.grid.toArray().map((tile) => tile.cost),
      );
      for (const tile of first.grid) {
        expect([2, 6]).toContain(tile.cost);
        const offset = first.terrain.faceOffsets.get(`${tile.col},${tile.row}`) ?? 0;
        expect(
          hexTerrainAt(first.grid, first.terrain.faceOffsets, tile.x, tile.y + offset),
        ).toBe(tile);
      }
      for (const sprite of first.scenery) {
        expect(sprite.nearest).toBe(true);
        expect(sprite.rendition).toBe(sprite.small ? 50 : 128);
        const coordinates = sprite.id.replace("scenery:", "").split(",").map(Number);
        if (
          isCombatTile(
            { col: coordinates[0] ?? -1, row: coordinates[1] ?? -1 },
            battle(background),
          )
        )
          expect(sprite.small).toBe(true);
      }
    },
  );
  it("light layout retains navigation while dropping decoration and animation work", () => {
    const full = prepare("ground"),
      light = prepare("ground", true);
    expect(light.grid.toArray().map((tile) => tile.cost)).toEqual(
      full.grid.toArray().map((tile) => tile.cost),
    );
    expect(light.scenery).toEqual([]);
    expect(light.terrain.animatedTiles).toBe(0);
  });
});
