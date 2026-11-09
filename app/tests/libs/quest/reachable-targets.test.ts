import { afterEach, describe, expect, it, vi } from "bun:test";
import {
  MAP_TOTAL_SECTORS,
  MAP_WAKE_ISLAND_SECTOR,
  MAP_WAR_TORN_BATTLEGROUND_SECTOR,
} from "@/drizzle/constants";
import {
  getNewTrackers,
  getQuestTargetSectorsToCheck,
  snapQuestTargetsToReachable,
} from "@/libs/quest";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { findNearestReachableCoordinate } from "@/libs/sector-map/validation";
import { trackerQuest, trackerUser } from "../../setup/quest";
import { sectorTile } from "../../setup/sectorMap";

/** Small map with the given tiles missing and spawn.default at `spawn`. */
const makeMap = (
  missing: [number, number][],
  spawn: { x: number; y: number } | null = { x: 0, y: 0 },
  size = 6,
): Pick<NormalizedSectorMap, "width" | "height" | "tiles" | "anchors"> => {
  const missingKeys = new Set(missing.map(([x, y]) => `${x},${y}`));
  const tiles: NormalizedSectorMap["tiles"] = [];
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (missingKeys.has(`${x},${y}`)) continue;
      tiles.push(sectorTile(x, y));
    }
  }
  return {
    width: size,
    height: size,
    tiles,
    anchors: spawn ? [{ key: "spawn.default", ...spawn }] : [],
  };
};

/** Missing column `x` splits a map into a west and an east pocket. */
const wallAtColumn = (x: number, size = 6): [number, number][] =>
  Array.from({ length: size }, (_, y) => [x, y] as [number, number]);

const moveObjective = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  task: "move_to_location" as const,
  description: "",
  successDescription: "",
  sectorType: "specific",
  sector: 5,
  sectorList: [],
  locationType: "specific",
  longitude: 3,
  latitude: 3,
  hideLocation: false,
  ...overrides,
});

const makeQuest = (id: string, objectives: Record<string, unknown>[]) =>
  trackerQuest(id, objectives, "mission");

const makeUser = (quest: ReturnType<typeof makeQuest>, questData: unknown[] = []) =>
  trackerUser([quest], questData, { longitude: 0, latitude: 0 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findNearestReachableCoordinate", () => {
  it("keeps a walkable coordinate connected to spawn", () => {
    expect(findNearestReachableCoordinate(makeMap([]), { x: 3, y: 4 })).toEqual({
      x: 3,
      y: 4,
    });
  });

  it("moves a missing coordinate to the nearest existing tile", () => {
    const result = findNearestReachableCoordinate(makeMap([[3, 3]]), { x: 3, y: 3 });
    expect(result).not.toBeNull();
    expect(result).not.toEqual({ x: 3, y: 3 });
    expect(Math.max(Math.abs(result!.x - 3), Math.abs(result!.y - 3))).toBe(1);
  });

  it("keeps a shaded coordinate reachable without relocating it", () => {
    const map = makeMap([]);
    Object.assign(map.tiles.find((tile) => tile.x === 3 && tile.y === 3)!, {
      blocked: true,
      walkCost: 0,
    });
    expect(findNearestReachableCoordinate(map, { x: 3, y: 3 })).toEqual({ x: 3, y: 3 });
  });

  it("moves a walkable tile cut off from spawn into the spawn's region", () => {
    // Spawn sits west of the wall at column 3; (5, 2) is walkable but unreachable.
    const map = makeMap(wallAtColumn(3));
    expect(findNearestReachableCoordinate(map, { x: 5, y: 2 })).toEqual({ x: 2, y: 2 });
  });

  it("falls back to plain walkability when the spawn anchor is missing", () => {
    const map = makeMap(wallAtColumn(3), null);
    expect(findNearestReachableCoordinate(map, { x: 5, y: 2 })).toEqual({ x: 5, y: 2 });
  });

  it("returns null when nothing is walkable", () => {
    const all: [number, number][] = [];
    for (let x = 0; x < 6; x++) all.push(...wallAtColumn(x));
    expect(findNearestReachableCoordinate(makeMap(all), { x: 1, y: 1 })).toBeNull();
  });
});

describe("random quest sectors", () => {
  it.each([MAP_WAKE_ISLAND_SECTOR, MAP_WAR_TORN_BATTLEGROUND_SECTOR])(
    "never assigns reserved sector %i",
    (reserved) => {
      vi.spyOn(Math, "random").mockReturnValue((reserved + 0.5) / MAP_TOTAL_SECTORS);
      const quest = makeQuest("q1", [moveObjective("m1", { sectorType: "random" })]);
      const { trackers } = getNewTrackers(makeUser(quest), [{ task: "any" }]);
      const sector = trackers[0]?.goals[0]?.sector;
      expect(sector).toBeDefined();
      expect(sector).not.toBe(reserved);
    },
  );
});

describe("snapQuestTargetsToReachable", () => {
  it("moves an instantiated target off a missing tile and marks it checked", () => {
    const quest = makeQuest("q1", [moveObjective("m1")]);
    const user = makeUser(quest);
    const { trackers } = getNewTrackers(user, [{ task: "any" }]);

    expect(getQuestTargetSectorsToCheck(user, trackers)).toEqual([5]);
    const changed = snapQuestTargetsToReachable(
      user,
      trackers,
      new Map([[5, makeMap([[3, 3]])]]),
    );

    const goal = trackers[0]?.goals[0];
    expect(changed).toBe(true);
    expect(goal?.locationChecked).toBe(true);
    expect({ x: goal?.longitude, y: goal?.latitude }).not.toEqual({ x: 3, y: 3 });
    // The objective shown to the client follows the tracker.
    const objective = user.userQuests[0]?.quest.content.objectives[0];
    expect(objective && "longitude" in objective && objective.longitude).toBe(
      goal?.longitude,
    );
    // Checked targets are not fetched or touched again.
    expect(getQuestTargetSectorsToCheck(user, trackers)).toEqual([]);
    expect(snapQuestTargetsToReachable(user, trackers, new Map())).toBe(false);
  });

  it("re-checks a persisted target whose tile is missing", () => {
    const quest = makeQuest("q1", [moveObjective("m1", { locationType: "random" })]);
    const legacy = [
      { id: "q1", goals: [{ id: "m1", sector: 5, longitude: 3, latitude: 3 }] },
    ];
    const user = makeUser(quest, legacy);
    const { trackers } = getNewTrackers(user, [{ task: "any" }]);

    snapQuestTargetsToReachable(user, trackers, new Map([[5, makeMap([[3, 3]])]]));

    const goal = trackers[0]?.goals[0];
    expect(goal?.locationChecked).toBe(true);
    expect({ x: goal?.longitude, y: goal?.latitude }).not.toEqual({ x: 3, y: 3 });
  });

  it("leaves reachable targets in place", () => {
    const quest = makeQuest("q1", [moveObjective("m1")]);
    const user = makeUser(quest);
    const { trackers } = getNewTrackers(user, [{ task: "any" }]);

    snapQuestTargetsToReachable(user, trackers, new Map([[5, makeMap([])]]));

    const goal = trackers[0]?.goals[0];
    expect(goal).toMatchObject({ longitude: 3, latitude: 3, locationChecked: true });
  });

  it("repairs a checked mission target when the player visits a changed sector", () => {
    const quest = makeQuest("q1", [
      moveObjective("m1", { sector: 724, longitude: 14, latitude: 6 }),
    ]);
    const user = makeUser(quest);
    const { trackers } = getNewTrackers(user, [{ task: "any" }]);
    snapQuestTargetsToReachable(
      user,
      trackers,
      new Map([[724, makeMap([], undefined, 26)]]),
    );
    expect(trackers[0]?.goals[0]).toMatchObject({
      longitude: 14,
      latitude: 6,
      locationChecked: true,
    });

    // A checked remote target does not fetch its map until the player visits.
    expect(getQuestTargetSectorsToCheck(user, trackers, true)).toEqual([]);
    user.sector = 724;
    expect(getQuestTargetSectorsToCheck(user, trackers, true)).toEqual([724]);
    const maps = new Map([[724, makeMap([[14, 6]], undefined, 26)]]);
    expect(snapQuestTargetsToReachable(user, trackers, maps)).toBe(true);
    const goal = trackers[0]?.goals[0];
    expect({ x: goal?.longitude, y: goal?.latitude }).not.toEqual({ x: 14, y: 6 });
    const objective = user.userQuests[0]?.quest.content.objectives[0];
    expect(objective).toMatchObject({
      longitude: goal?.longitude,
      latitude: goal?.latitude,
    });

    // Rechecking the same map must not keep writing the tracker.
    expect(snapQuestTargetsToReachable(user, trackers, maps)).toBe(false);
    // Mutation response eligibility only asks whether initial checks are pending.
    expect(getQuestTargetSectorsToCheck(user, trackers)).toEqual([]);
  });

  it("repairs a checked tile cut off from spawn by a map edit", () => {
    const quest = makeQuest("q1", [moveObjective("m1", { longitude: 5, latitude: 2 })]);
    const user = makeUser(quest);
    const { trackers } = getNewTrackers(user, [{ task: "any" }]);
    snapQuestTargetsToReachable(user, trackers, new Map([[5, makeMap([])]]));
    user.sector = 5;
    snapQuestTargetsToReachable(
      user,
      trackers,
      new Map([[5, makeMap(wallAtColumn(3))]]),
    );
    expect(trackers[0]?.goals[0]).toMatchObject({ longitude: 2, latitude: 2 });

    user.longitude = 2;
    user.latitude = 2;
    user.questData = trackers;
    const progressed = getNewTrackers(user, [{ task: "move_to_location" }]);
    expect(progressed.trackers[0]?.goals[0]?.done).toBe(true);
  });

  it("keeps a goal unchecked while its sector has no published map", () => {
    const quest = makeQuest("q1", [moveObjective("m1")]);
    const user = makeUser(quest);
    const { trackers } = getNewTrackers(user, [{ task: "any" }]);

    expect(snapQuestTargetsToReachable(user, trackers, new Map())).toBe(false);
    expect(trackers[0]?.goals[0]?.locationChecked).toBeUndefined();
    expect(getQuestTargetSectorsToCheck(user, trackers)).toEqual([5]);
  });

  it("skips finished and placement-bound objectives", () => {
    const quest = makeQuest("q1", [
      moveObjective("m1"),
      {
        id: "d1",
        task: "defeat_opponents",
        description: "",
        successDescription: "",
        sectorType: "specific",
        sector: 5,
        sectorList: [],
        locationType: "specific",
        longitude: 3,
        latitude: 3,
        overworldPlacementId: "placement-1",
        opponentAIs: [],
        value: 1,
      },
    ]);
    const legacy = [
      {
        id: "q1",
        goals: [{ id: "m1", done: true, sector: 5, longitude: 3, latitude: 3 }],
      },
    ];
    const user = makeUser(quest, legacy);
    const trackers = [
      {
        id: "q1",
        startAt: new Date().toISOString(),
        goals: [
          {
            id: "m1",
            done: true,
            value: 0,
            collected: false,
            recentlyDied: false,
            sector: 5,
            longitude: 3,
            latitude: 3,
          },
          {
            id: "d1",
            done: false,
            value: 0,
            collected: false,
            recentlyDied: false,
            sector: 5,
            longitude: 3,
            latitude: 3,
          },
        ],
      },
    ];

    expect(getQuestTargetSectorsToCheck(user, trackers)).toEqual([]);
    expect(
      snapQuestTargetsToReachable(user, trackers, new Map([[5, makeMap([[3, 3]])]])),
    ).toBe(false);
    expect(trackers[0]?.goals.map((g) => [g.longitude, g.latitude])).toEqual([
      [3, 3],
      [3, 3],
    ]);
  });
});
