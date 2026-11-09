import { describe, expect, it } from "bun:test";
import { OVERWORLD_MAX_GROUPS_PER_SECTOR } from "@/drizzle/constants";
import { oddQHexDistance, oddQLineStep } from "@/libs/hexgrid";
import {
  isOverworldCopyInReach,
  liveNpcTiles,
  placementCopiesInSector,
  placementCopyPositions,
  placementToSectorUser,
} from "@/libs/overworldAi";
import {
  isWanderTile,
  snapToWanderTile,
  WANDER_STEP_MS,
  wanderGroupSize,
  wanderPose,
  wanderPoseTile,
  wanderSpots,
} from "@/libs/overworldWander";
import type {
  NormalizedSectorMap,
  NormalizedSectorTile,
} from "@/libs/sector-map/types";

/** A 20x15 meadow with a walled building in the middle and a village strip on the left. */
const map = (): NormalizedSectorMap =>
  ({
    width: 20,
    height: 15,
    tiles: Array.from({ length: 20 * 15 }, (_, index): NormalizedSectorTile => {
      const x = index % 20,
        y = Math.floor(index / 20);
      const building = x >= 9 && x <= 10 && y >= 6 && y <= 8;
      return {
        x,
        y,
        terrain: "ground",
        walkCost: 1,
        blocked: building,
        zone: building ? "structure" : x < 3 ? "village" : "wilderness",
        battleBiome: "ground",
      } as NormalizedSectorTile;
    }),
  }) as unknown as NormalizedSectorMap;
const placement = (patch: Record<string, unknown> = {}) => ({
  id: "deer",
  aiTemplateUserId: "ai",
  interactionType: "AMBIENT" as const,
  positionVersion: 4,
  sectorType: "random" as const,
  locationType: "random" as const,
  sector: 301,
  longitude: 6,
  latitude: 7,
  sectorList: [],
  spawnCount: 12,
  groupMin: 3,
  groupMax: 5,
  wildOnly: true,
  wanderRadius: 5,
  ...patch,
});

describe("wander spots", () => {
  it("keeps to open tiles within the radius that the anchor can walk to in a straight line", () => {
    const anchor = { x: 6, y: 7 };
    const spots = wanderSpots(map(), anchor, 5, true);
    expect(spots[0]).toEqual(anchor);
    for (const spot of spots) {
      expect(oddQHexDistance(anchor.x, anchor.y, spot.x, spot.y)).toBeLessThanOrEqual(
        5,
      );
      // Never inside the building or the village, and never behind the building from the anchor.
      expect(spot.x >= 3).toBe(true);
      expect(spot.x >= 9 && spot.x <= 10 && spot.y >= 6 && spot.y <= 8).toBe(false);
      const distance = oddQHexDistance(anchor.x, anchor.y, spot.x, spot.y);
      for (let step = 1; step < distance; step++) {
        const tile = oddQLineStep(
          { col: anchor.x, row: anchor.y },
          { col: spot.x, row: spot.y },
          step,
        );
        expect(tile.col >= 9 && tile.col <= 10 && tile.row >= 6 && tile.row <= 8).toBe(
          false,
        );
      }
    }
    expect(spots.some((spot) => spot.x === 11 && spot.y === 7)).toBe(false);
    expect(wanderSpots(map(), anchor, 0, true)).toEqual([anchor]);
  });

  it("keeps to land, even where authored water is zoned as wilderness", () => {
    const shore = map();
    for (const tile of shore.tiles) if (tile.x >= 14) tile.terrain = "ocean";
    const spots = wanderSpots(shore, { x: 12, y: 3 }, 4, false);
    expect(spots.length).toBeGreaterThan(1);
    expect(spots.every((spot) => spot.x < 14)).toBe(true);
    // An anchor out at sea snaps to the nearest shore column.
    expect(snapToWanderTile(shore, { x: 18, y: 3 }, false)?.x).toBe(13);
  });

  it("keeps clear of the stairs and plaza of the sector shrine", () => {
    const withShrine = {
      ...map(),
      anchors: [{ key: "shrine.default", x: 6, y: 3 }],
      objects: [],
    };
    const spots = wanderSpots(withShrine, { x: 6, y: 8 }, 5, true);
    expect(spots.length).toBeGreaterThan(1);
    for (const spot of spots.slice(1))
      expect(Math.abs(spot.x - 6) <= 2 && spot.y >= 0 && spot.y <= 5).toBe(false);
    expect(snapToWanderTile(withShrine, { x: 6, y: 4 }, true)).toEqual({ x: 6, y: 6 });
  });

  it("snaps wild placements off villages and buildings onto the nearest wild tile", () => {
    const wild = snapToWanderTile(map(), { x: 1, y: 4 }, true)!;
    expect(wild.x).toBe(3);
    expect(oddQHexDistance(wild.x, wild.y, 1, 4)).toBe(2);
    expect(snapToWanderTile(map(), { x: 1, y: 4 }, false)).toEqual({ x: 1, y: 4 });
    const snapped = snapToWanderTile(map(), { x: 9, y: 7 }, true)!;
    expect(oddQHexDistance(snapped.x, snapped.y, 9, 7)).toBe(1);
  });
});

describe("wander timeline", () => {
  const config = {
    seed: "deer:4:2",
    anchor: { x: 6, y: 7 },
    radius: 5,
    spots: wanderSpots(map(), { x: 6, y: 7 }, 5, true),
  };

  it("is a pure function of seed and clock, so server and clients agree", () => {
    for (const time of [0, 12_345, 987_654_321])
      expect(wanderPose(config, 2, time)).toEqual(
        wanderPose({ ...config, spots: [...config.spots] }, 2, time),
      );
    expect(wanderPose(config, 0, 1_000_000)).not.toEqual(
      wanderPose({ ...config, seed: "deer:5:2" }, 0, 1_000_000),
    );
  });

  it("walks between spots at a steady pace, resting between walks", () => {
    let moving = 0,
      resting = 0;
    let previous = wanderPoseTile(wanderPose(config, 0, 0));
    for (let time = 0; time < 600_000; time += 100) {
      const pose = wanderPose(config, 0, time);
      const tile = wanderPoseTile(pose);
      expect(config.spots).toContainEqual(pose.from);
      expect(config.spots).toContainEqual(pose.to);
      if (pose.moving) moving++;
      else resting++;
      // A tick never skips more than a hex, even through the anchor.
      expect(
        oddQHexDistance(previous.x, previous.y, tile.x, tile.y),
      ).toBeLessThanOrEqual(1);
      previous = tile;
    }
    expect(moving).toBeGreaterThan(0);
    expect(resting).toBeGreaterThan(moving);
    expect(100 / WANDER_STEP_MS).toBeLessThan(1);
  });

  it("spreads a herd around its leader and staggers departures", () => {
    const poses = [0, 1, 2, 3].map((member) => wanderPose(config, member, 0));
    expect(poses[0]!.fromOffset).toEqual({ x: 0, y: 0 });
    const offsets = poses
      .slice(1)
      .map((pose) => Math.hypot(pose.toOffset.x, pose.toOffset.y));
    for (const offset of offsets) expect(offset).toBeGreaterThan(0.2);
    // Every member walks to the same spot, each on its own clock.
    for (let time = 0; time < 120_000; time += 50) {
      const [leader, follower] = [0, 2].map((member) =>
        wanderPose(config, member, time),
      );
      expect(follower!.to).toEqual(leader!.to);
      if (follower!.progress > 0) expect(leader!.progress).toBeGreaterThan(0);
    }
  });

  it("keeps a stationary placement on its anchor and fixes each copy's group size", () => {
    const still = { ...config, radius: 0, spots: [config.anchor] };
    for (const time of [0, 50_000, 1e9])
      expect(wanderPoseTile(wanderPose(still, 1, time))).toEqual(config.anchor);
    const sizes = Array.from({ length: 40 }, (_, copy) =>
      wanderGroupSize(`deer:4:${copy}`, 3, 5),
    );
    expect(new Set(sizes)).toEqual(new Set([3, 4, 5]));
    expect(wanderGroupSize("x", 1, 1)).toBe(1);
  });
});

describe("placement copies", () => {
  it("keeps copy 0 on its stored tile and rolls the rest from the version seed and habitat pool", () => {
    const pool = [301, 302, 303];
    const positions = placementCopyPositions(placement(), pool);
    expect(positions).toHaveLength(12);
    expect(positions[0]).toEqual({ sector: 301, longitude: 6, latitude: 7 });
    for (const position of positions.slice(1)) expect(pool).toContain(position.sector);
    expect(placementCopyPositions(placement(), pool)).toEqual(positions);
    expect(placementCopyPositions(placement({ positionVersion: 5 }), pool)).not.toEqual(
      positions,
    );
  });

  it("anchors only the copies in a sector, wild ones on wild tiles, with stable herd sizes", () => {
    const copies = placementCopiesInSector(
      placement({ spawnCount: 30 }),
      301,
      map(),
      [301, 302],
    );
    expect(copies.length).toBeGreaterThan(5);
    expect(copies[0]?.copy).toBe(0);
    for (const copy of copies) {
      expect(copy.anchor.x).toBeGreaterThanOrEqual(3);
      expect(copy.groupSize).toBeGreaterThanOrEqual(3);
      expect(copy.groupSize).toBeLessThanOrEqual(5);
    }
    // Copies served away from the stored sector report the sector they stand in.
    const [away] = placementCopiesInSector(
      placement({ spawnCount: 30 }),
      302,
      map(),
      [301, 302],
    );
    const template = {
      userId: "ai",
      username: "Deer",
      avatar: null,
      avatarLight: null,
      curHealth: 1,
      maxHealth: 1,
      level: 1,
      rank: "STUDENT" as const,
    };
    expect(away?.copy).toBeGreaterThan(0);
    expect(placementToSectorUser(placement(), template, away).sector).toBe(302);
    // A hand-placed, non-wild copy 0 keeps its doorstep tile exactly.
    const keeper = placementCopiesInSector(
      placement({ wildOnly: false, longitude: 1, latitude: 2, spawnCount: 1 }),
      301,
      map(),
    );
    expect(keeper.map((copy) => copy.anchor)).toEqual([{ x: 1, y: 2 }]);
  });

  it("keeps the stored copy on its tile when the sector has no land, dropping only extra copies", () => {
    const ocean = map();
    for (const tile of ocean.tiles) tile.terrain = "ocean";
    const copies = placementCopiesInSector(placement({ spawnCount: 30 }), 301, ocean, [301]);
    expect(copies.map((copy) => [copy.copy, copy.anchor])).toEqual([[0, { x: 6, y: 7 }]]);
  });
});

describe("biome placements", () => {
  const biome = (patch: Record<string, unknown> = {}) =>
    placement({ sectorType: "biome", spawnCount: 2, ...patch });
  const pool = [301, 302, 303];

  it("puts its groups in every sector of the pool and nowhere else", () => {
    for (const sector of pool) {
      const copies = placementCopiesInSector(biome(), sector, map(), pool);
      expect(copies.map((copy) => copy.copy)).toEqual([
        sector * OVERWORLD_MAX_GROUPS_PER_SECTOR,
        sector * OVERWORLD_MAX_GROUPS_PER_SECTOR + 1,
      ]);
      for (const copy of copies) {
        expect(copy.sector).toBe(sector);
        expect(
          isWanderTile(map().tiles[copy.anchor.y * 20 + copy.anchor.x], true),
        ).toBe(true);
      }
    }
    expect(placementCopiesInSector(biome(), 304, map(), pool)).toEqual([]);
  });

  it("keeps a sector's groups stable for the day and reshuffles them with the daily version", () => {
    const today = placementCopiesInSector(biome(), 302, map(), pool);
    expect(placementCopiesInSector(biome(), 302, map(), [...pool])).toEqual(today);
    expect(
      placementCopiesInSector(biome({ positionVersion: 5 }), 302, map(), pool),
    ).not.toEqual(today);
    // The stored sample spot never adds a copy of its own.
    expect(placementCopiesInSector(biome({ sector: 302 }), 302, map(), pool)).toEqual(
      today,
    );
  });

  it("lets a player reach a group in the sector they stand in", () => {
    const roaming = biome({ spawnCount: 1, groupMin: 1, groupMax: 1 });
    const [copy] = placementCopiesInSector(roaming, 303, map(), pool);
    const template = {
      userId: "ai",
      username: "Deer",
      avatar: null,
      avatarLight: null,
      curHealth: 1,
      maxHealth: 1,
      level: 1,
      rank: "STUDENT" as const,
    };
    const npc = placementToSectorUser(roaming, template, copy);
    expect(npc).toMatchObject({ sector: 303, npcCopy: copy!.copy });
    const [live] = liveNpcTiles([npc], map(), 50_000, new Map());
    const player = {
      sector: 303,
      longitude: live!.longitude,
      latitude: live!.latitude,
    };
    expect(
      isOverworldCopyInReach({
        placement: roaming,
        copy: copy!.copy,
        map: map(),
        pool,
        player,
        timeMs: 50_000,
      }),
    ).toBe(true);
    expect(
      isOverworldCopyInReach({
        placement: roaming,
        copy: copy!.copy,
        map: map(),
        pool,
        player: { ...player, sector: 301 },
        timeMs: 50_000,
      }),
    ).toBe(false);
  });
});

describe("reach", () => {
  const player = (longitude: number, latitude: number) => ({
    sector: 301,
    longitude,
    latitude,
  });

  it("requires a still NPC's own tile but accepts a neighbour of a roaming member", () => {
    const still = placement({
      spawnCount: 1,
      wanderRadius: 0,
      wildOnly: false,
      groupMin: 1,
      groupMax: 1,
    });
    expect(
      isOverworldCopyInReach({
        placement: still,
        copy: 0,
        map: map(),
        player: player(6, 7),
        timeMs: 0,
      }),
    ).toBe(true);
    expect(
      isOverworldCopyInReach({
        placement: still,
        copy: 0,
        map: map(),
        player: player(6, 8),
        timeMs: 0,
      }),
    ).toBe(false);
    const roaming = placement({
      spawnCount: 1,
      groupMin: 1,
      groupMax: 1,
      wildOnly: false,
    });
    const [copy] = placementCopiesInSector(roaming, 301, map());
    const npc = placementToSectorUser(
      roaming,
      {
        userId: "ai",
        username: "Deer",
        avatar: null,
        avatarLight: null,
        curHealth: 1,
        maxHealth: 1,
        level: 1,
        rank: "STUDENT",
      },
      copy,
    );
    for (const time of [0, 33_000, 400_000]) {
      const [live] = liveNpcTiles([npc], map(), time, new Map());
      const at = player(live!.longitude, live!.latitude);
      expect(
        isOverworldCopyInReach({
          placement: roaming,
          copy: 0,
          map: map(),
          player: at,
          timeMs: time,
        }),
      ).toBe(true);
      expect(
        isOverworldCopyInReach({
          placement: roaming,
          copy: 3,
          map: map(),
          player: at,
          timeMs: time,
        }),
      ).toBe(false);
      expect(
        isOverworldCopyInReach({
          placement: roaming,
          copy: 0,
          map: map(),
          player: { ...at, sector: 302 },
          timeMs: time,
        }),
      ).toBe(false);
    }
  });
});
