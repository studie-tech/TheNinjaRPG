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
