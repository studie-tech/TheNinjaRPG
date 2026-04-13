import type { Grid } from "honeycomb-grid";
import { describe, expect, it } from "vitest";
import type { TerrainHex } from "@/libs/hexgrid";
import { getAffectedTiles } from "@/libs/combat/util";
import type { CombatAction, GroundEffect, ReturnedUserState } from "@/libs/combat/types";

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

const createBarrier = (longitude: number, latitude: number): GroundEffect =>
  ({
    id: "barrier-id",
    type: "barrier",
    creatorId: "actor-id",
    level: 1,
    isNew: false,
    castThisRound: false,
    createdRound: 1,
    longitude,
    latitude,
    barrierAbsorb: 0,
    actionId: "action-id",
  }) as GroundEffect;

describe("getAffectedTiles", () => {
  it("deduplicates the shared start tile for aoe wall shoot", () => {
    // AOE_WALL_SHOOT traverses two lines both starting at b, so b appears twice
    const b = createTile(3, 4);
    const northTile = createTile(3, 3);
    const southTile = createTile(3, 5);
    // Simulate two line traversals that both include b
    const grid = {
      traverse: () => [b, northTile, b, southTile],
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

  it("deduplicates matching tile coordinates for aoe circle spawn", () => {
    const target = createTile(3, 4);
    const duplicateTarget = createTile(3, 4);
    const grid = {
      traverse: () => [target, duplicateTarget],
    } as unknown as Grid<TerrainHex>;

    const { green, red } = getAffectedTiles({
      a: createTile(0, 0),
      b: target,
      action: createAction(),
      grid,
      users: [createUser()],
      ground: [createBarrier(3, 4)],
      userId: "actor-id",
    });

    expect(red.size).toBe(0);
    expect(green.size).toBe(1);
    expect([...green].map((tile) => [tile.col, tile.row])).toEqual([[3, 4]]);
  });
});
