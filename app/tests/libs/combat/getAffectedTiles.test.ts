import type { Grid } from "honeycomb-grid";
import { describe, expect, it } from "vitest";
import type { TerrainHex } from "@/libs/hexgrid";
import { getAffectedTiles } from "@/libs/combat/util";
import type { CombatAction, ReturnedUserState } from "@/libs/combat/types";

const createTile = (col: number, row: number) =>
  ({ col, row, q: col, r: row }) as TerrainHex;

const createAction = (): CombatAction =>
  ({
    id: "action-id",
    name: "Circle Spawn",
    image: "",
    battleDescription: "",
    type: "jutsu",
    target: "GROUND",
    method: "AOE_CIRCLE_SPAWN",
    range: 1,
    healthCost: 0,
    chakraCost: 0,
    staminaCost: 0,
    actionCostPerc: 0,
    updatedAt: 0,
    cooldown: 0,
    originalCooldown: 0,
    effects: [{ type: "damage" } as CombatAction["effects"][number]],
  }) as CombatAction;

const createUser = (): ReturnedUserState =>
  ({
    userId: "actor-id",
    direction: "left",
    curHealth: 100,
    fledBattle: false,
    longitude: 0,
    latitude: 0,
  }) as ReturnedUserState;

describe("getAffectedTiles", () => {
  it("deduplicates the shared start tile for aoe wall shoot", () => {
    // AOE_WALL_SHOOT traverses two lines both starting at b. Use a second
    // distinct object at the same coords so reference equality on Set<TerrainHex>
    // does NOT filter it — only the coordinate-keyed seenTiles dedup can.
    const b = createTile(3, 4);
    const bDup = createTile(3, 4);
    const northTile = createTile(3, 3);
    const southTile = createTile(3, 5);
    const grid = {
      traverse: () => [b, northTile, bDup, southTile],
    } as unknown as Grid<TerrainHex>;

    const action = {
      ...createAction(),
      name: "Wall Shoot",
      method: "AOE_WALL_SHOOT" as const,
    } as CombatAction;

    // Place actor far enough on q-axis so deltaX >= deltaY (N/S wall)
    const a = createTile(0, 4);

    const { green, red } = getAffectedTiles({
      a,
      b,
      action,
      grid,
      users: [createUser()],
      ground: [],
      userId: "actor-id",
    });

    expect(red.size).toBe(0);
    // 3 unique tiles: b, northTile, southTile (b not duplicated)
    expect(green.size).toBe(3);
    const coords = [...green].map((tile) => [tile.col, tile.row]);
    expect(coords).toEqual(
      expect.arrayContaining([
        [3, 4],
        [3, 3],
        [3, 5],
      ]),
    );
  });

});
