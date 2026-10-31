import { createNoise2D } from "simplex-noise";
import { HEX_STACKING_DISPLACEMENT } from "@/drizzle/constants";
import {
  COMBAT_BORDER_BOTTOM,
  COMBAT_BORDER_LEFT,
  COMBAT_BORDER_RIGHT,
  COMBAT_BORDER_TOP,
} from "@/libs/combat/constants";
import type { ReturnedBattle } from "@/libs/combat/types";
import { getBattleGrid } from "@/libs/combat/util";
import {
  getProceduralTerrain,
  proceduralDecoration,
} from "@/libs/rendering/proceduralBiomes";
import type { WorldSpriteDescription } from "@/libs/rendering/sectorSprites";
import { buildHexTerrainData } from "@/libs/rendering/terrainData";

/** Arena generation keeps the game's seeded layout and traversal costs independent of rendering. */
export const prepareCombatTerrain = (
  width: number,
  battle: ReturnedBattle,
  prng: () => number,
  lightLayout: boolean,
) => {
  const hexSize =
    width / (battle.width - HEX_STACKING_DISPLACEMENT * (battle.width - 1));
  const noise = createNoise2D(prng),
    assets = createNoise2D(prng);
  const grid = getBattleGrid(hexSize, battle, {
    x: -hexSize * 0.5,
    y: -hexSize * 0.5,
  }).map((tile) => {
    const x = tile.col / battle.width - 0.5,
      y = tile.row / battle.height - 0.5;
    tile.level = noise(x, y) / 2 + 0.5;
    tile.assetStrength = assets(x, y) / 2 + 0.5;
    return tile;
  });
  const scenery: WorldSpriteDescription[] = [];
  const looks = new Map<string, ReturnType<typeof getProceduralTerrain>>();
  for (const tile of grid) {
    const look = getProceduralTerrain(tile, battle.background);
    tile.asset = look.spec.key;
    looks.set(`${tile.col},${tile.row}`, look);
    const { cost, description } = proceduralDecoration(prng, look.spec.key, tile);
    tile.cost = cost;
    if (
      !lightLayout &&
      description &&
      (!isCombatTile(tile, battle) || description.small)
    )
      scenery.push(description);
  }
  const terrain = buildHexTerrainData(
    grid,
    (tile) => {
      const look = looks.get(`${tile.col},${tile.row}`);
      if (!look) throw new Error("Combat terrain look is missing");
      return {
        color: look.spec.colors[look.variant] ?? look.spec.colors[0],
        texture: look.spec.textureUrl,
        depression: look.spec.depression,
        isWater: look.spec.isWater,
        waterDepth: look.spec.key === "ocean",
        waveOffset:
          look.spec.isWater && !lightLayout
            ? (Math.floor(prng() * 8) * Math.PI) / 4
            : -1,
      };
    },
    lightLayout,
  );
  return { grid, terrain, scenery: scenery.sort((a, b) => b.groundY - a.groundY) };
};

export const isCombatTile = (
  tile: { col: number; row: number },
  battle: Pick<ReturnedBattle, "width" | "height">,
) =>
  tile.col >= COMBAT_BORDER_LEFT &&
  tile.col < battle.width - COMBAT_BORDER_RIGHT &&
  tile.row >= COMBAT_BORDER_BOTTOM &&
  tile.row < battle.height - COMBAT_BORDER_TOP;
