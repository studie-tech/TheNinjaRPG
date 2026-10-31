import type { Grid } from "honeycomb-grid";
import { validateActionTarget } from "@/libs/combat/targetValidation";
import type {
  CombatAction,
  ReturnedBattle,
  ReturnedUserState,
} from "@/libs/combat/types";
import { getPossibleActionTiles, type TerrainHex } from "@/libs/hexgrid";
import type { TerrainTint } from "@/libs/rendering/primitives/terrain";

/** One snapshot produces complete targeting colors, including restored and newly added tiles. */
export const combatHighlightPlan = (info: {
  grid: Grid<TerrainHex>;
  battle: ReturnedBattle;
  user?: ReturnedUserState;
  action?: CombatAction;
  actions: CombatAction[];
  hovered: TerrainHex | null;
  canUse: boolean;
  timeDiff: number;
  targetTiles?: TerrainHex[];
}) => {
  const tints = new Map<string, TerrainTint>(),
    edges: { tile: TerrainHex; color: number }[] = [];
  const { user, grid, battle, action, hovered, canUse } = info;
  if (info.targetTiles) {
    for (const tile of info.targetTiles)
      tints.set(`${tile.col},${tile.row}`, { color: "#ff3232", strength: 0.8 });
    return { tints, edges, valid: false };
  }
  const origin = user && grid.getHex({ col: user.longitude, row: user.latitude });
  if (canUse && origin)
    for (const tile of getPossibleActionTiles(action, origin, grid) ?? []) {
      tints.set(`${tile.col},${tile.row}`, { color: "#505050", strength: 0.7 });
      edges.push({ tile, color: 0x64b4ff });
    }
  let valid = false;
  if (canUse && user && hovered && action) {
    const result = validateActionTarget({
      user,
      battle,
      action,
      target: hovered,
      grid,
      timeDiff: info.timeDiff,
      precomputedUserId: user.userId,
      precomputedActions: info.actions,
    });
    valid = result.isValid;
    for (const tile of result.greenTiles ?? []) {
      const move =
        action.effects.some((effect) => effect.type === "move") && tile === hovered;
      tints.set(`${tile.col},${tile.row}`, {
        color: move ? "#0096ff" : "#00ff64",
        strength: 0.8,
      });
      edges.push({ tile, color: move ? 0x0096ff : 0x00ff64 });
    }
    for (const tile of result.redTiles ?? []) {
      tints.set(`${tile.col},${tile.row}`, { color: "#ff3232", strength: 0.2 });
      edges.push({ tile, color: 0xff5050 });
    }
  }
  return { tints, edges, valid };
};

/** Shared targeting edges follow visible face elevations; a selected color owns its shared border. */
export const combatHighlightEdges = (
  selections: { tile: TerrainHex; color: number }[],
  offsets: ReadonlyMap<string, number>,
) => {
  const tiles = new Map<string, (typeof selections)[number]>();
  for (const entry of selections) {
    const key = `${entry.tile.col},${entry.tile.row}`;
    tiles.delete(key);
    tiles.set(key, entry);
  }
  const edges = new Map<
    string,
    {
      a: { x: number; y: number };
      b: { x: number; y: number };
      color: number;
      offset: number;
      hidden: boolean;
    }
  >();
  for (const { tile, color } of tiles.values()) {
    const offset = offsets.get(`${tile.col},${tile.row}`) ?? 0;
    tile.corners.forEach((a, index) => {
      const b = tile.corners[(index + 1) % tile.corners.length];
      if (!b) return;
      const key = [a, b]
        .map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`)
        .sort()
        .join(":");
      const before = edges.get(key);
      // A continuous range needs no second outline across its shoreline's vertical step.
      const hidden = !!before && before.offset !== offset && before.color === color;
      edges.set(key, { a, b, color, offset, hidden });
    });
  }
  const batches = new Map<string, { layer: number; color: number; points: number[] }>();
  for (const { a, b, color, offset, hidden } of edges.values()) {
    if (hidden) continue;
    const layer = offset < 0 ? -0.5 : 0,
      key = `${layer}:${color}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = { layer, color, points: [] };
      batches.set(key, batch);
    }
    batch.points.push(a.x, a.y + offset, b.x, b.y + offset);
  }
  return [...batches.values()];
};
