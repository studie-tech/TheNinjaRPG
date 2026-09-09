import { describe, expect, it } from "vitest";
import {
  computeBattleMaps,
  shouldInvalidateEndedBattleCaches,
} from "@/libs/combat/battleMaps";
import type { GroundEffect, ReturnedBattle, UserEffect } from "@/libs/combat/types";

const groundEffect = (longitude: number, latitude: number): GroundEffect =>
  ({ longitude, latitude }) as GroundEffect;

const userEffect = (targetId: string, rounds?: number): UserEffect =>
  ({ targetId, rounds }) as UserEffect;

const battleUser = (overrides: {
  userId: string;
  longitude?: number;
  latitude?: number;
  curHealth?: number;
  fledBattle?: boolean;
}) => ({
  longitude: 0,
  latitude: 0,
  curHealth: 10,
  fledBattle: false,
  ...overrides,
});

const battle = (overrides: Partial<ReturnedBattle> = {}): ReturnedBattle =>
  ({
    id: "battle-1",
    version: 1,
    groundEffects: [],
    usersEffects: [],
    usersState: [],
    ...overrides,
  }) as ReturnedBattle;

describe("computeBattleMaps", () => {
  it("indexes ground effects, active user effects, and living users", () => {
    const maps = computeBattleMaps(
      battle({
        groundEffects: [groundEffect(2, 3)],
        usersEffects: [userEffect("hero", 2), userEffect("hero", 0)],
        usersState: [
          battleUser({ userId: "hero", longitude: 1, latitude: 4 }),
          battleUser({ userId: "dead", curHealth: 0, longitude: 5, latitude: 5 }),
          battleUser({ userId: "fled", fledBattle: true, longitude: 6, latitude: 6 }),
        ],
      }),
    );

    expect(maps.groundEffectsByTile.get("2,3")).toHaveLength(1);
    expect(maps.userEffectsByUserId.get("hero")).toHaveLength(1);
    expect(maps.usersByTile.get("1,4")).toBe("hero");
    expect(maps.usersByTile.size).toBe(1);
  });

  it("returns the shared empty maps when there is no battle", () => {
    expect(computeBattleMaps(null)).toBe(computeBattleMaps(null));
  });
});

describe("shouldInvalidateEndedBattleCaches", () => {
  it("runs once per ended battle and again only for a new battle id", () => {
    expect(shouldInvalidateEndedBattleCaches(null, "battle-1", false)).toBe(false);
    expect(shouldInvalidateEndedBattleCaches(null, undefined, true)).toBe(false);
    expect(shouldInvalidateEndedBattleCaches(null, "battle-1", true)).toBe(true);
    expect(shouldInvalidateEndedBattleCaches("battle-1", "battle-1", true)).toBe(false);
    expect(shouldInvalidateEndedBattleCaches("battle-1", "battle-2", true)).toBe(true);
  });
});
