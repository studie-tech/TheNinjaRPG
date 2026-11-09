import { describe, expect, it } from "bun:test";
import { getNewTrackers } from "@/libs/quest";
import {
  DialogObjective,
  MoveToObjective,
  SimpleObjective,
} from "@/validators/objectives";
import {
  trackerGoal as goalOf,
  trackerQuest as makeQuest,
  trackerUser as makeUser,
} from "../../setup/quest";

const NOW = Date.now();
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000 - 1000);

/** One passive objective of `task`, large enough not to complete. */
const passive = (
  task: string,
  user: object = {},
  goal: object = { id: "o1", value: 7, done: false },
) => {
  const quest = makeQuest("q1", [
    SimpleObjective.parse({ id: "o1", task, value: 1_000_000 }),
  ]);
  const tracked = makeUser(
    [quest],
    [{ id: "q1", startAt: daysAgo(0).toISOString(), goals: [goal] }],
    user,
  );
  return { result: getNewTrackers(tracked, [{ task: "any" }]) };
};

describe("getNewTrackers passive snapshots", () => {
  it.each<[string, object, number]>([
    ["dungeons_completed", { dungeonsCompleted: 3 }, 3],
    ["dungeons_completed", {}, 7],
    ["raids_completed", { raidsCompleted: 4 }, 4],
    ["raids_completed", {}, 7],
    ["user_level", { level: 40 }, 40],
    ["user_level", { level: 40, originalLevel: 25 }, 25],
    ["farming_level", { farmingExperience: 0 }, 1],
    ["farming_collection_log", { farmingCollectionCount: 12 }, 12],
    ["farming_collection_log", {}, 7],
    ["days_in_village", { joinedVillageAt: daysAgo(3) }, 3],
    ["reputation_points", { reputationPointsTotal: 55 }, 55],
    ["a_missions_total", { missionsA: 5 }, 5],
    ["d_missions_total", { missionsD: 6 }, 6],
    ["b_crimes_total", { crimesB: 8 }, 8],
    ["errands_total", { errands: 9 }, 9],
    ["medical_experience", { medicalExperience: 11 }, 11],
    ["crafting_experience", { craftingExperience: 12 }, 12],
    ["hunting_experience", { huntingExperience: 13 }, 13],
    ["gathering_experience", { gatheringExperience: 14 }, 14],
    ["minutes_training", {}, 7],
  ])("%s from %j reads %d", (task, user, value) => {
    expect(goalOf(passive(task, user).result, "q1", "o1")?.value).toBe(value);
  });

  it("reads minutes since the tracker started", () => {
    const quest = makeQuest("q1", [
      SimpleObjective.parse({ id: "o1", task: "minutes_passed", value: 1000 }),
    ]);
    const user = makeUser(
      [quest],
      [
        {
          id: "q1",
          startAt: new Date(NOW - 5 * 60_000 - 1000).toISOString(),
          goals: [],
        },
      ],
    );
    expect(goalOf(getNewTrackers(user, [{ task: "any" }]), "q1", "o1")?.value).toBe(5);
  });

  it("reads days as Kage only for the village's Kage", () => {
    const village = { id: "v1", sector: 1, kageId: "u1", leaderUpdatedAt: daysAgo(2) };
    expect(goalOf(passive("days_as_kage", { village }).result, "q1", "o1")?.value).toBe(
      2,
    );
    expect(
      goalOf(
        passive("days_as_kage", { village: { ...village, kageId: "other" } }).result,
        "q1",
        "o1",
      )?.value,
    ).toBe(7);
  });

  it("totals lifetime completions by quest type", () => {
    const completedQuests = [
      { questType: "story", completed: 1, previousCompletes: 3 },
      { questType: "story", completed: 1, previousCompletes: 0 },
      { questType: "event", completed: 1, previousCompletes: 9 },
      { completed: 1, previousCompletes: 9 },
    ];
    expect(
      goalOf(passive("stories_completed", { completedQuests }).result, "q1", "o1")
        ?.value,
    ).toBe(4);
  });

  it("requests one persisted write when a snapshot earns a completion", () => {
    const { result } = passive("dungeons_completed", { dungeonsCompleted: 2_000_000 });
    expect(goalOf(result, "q1", "o1")?.done).toBe(true);
    expect(result.consequences).toEqual([
      { type: "update_user", ids: ["activity_completion"] },
    ]);
    expect(result.questIdsUpdated).toEqual(["q1"]);
  });

  it("leaves a finished goal's snapshot and effects alone", () => {
    const { result } = passive(
      "dungeons_completed",
      { dungeonsCompleted: 3 },
      { id: "o1", value: 7, done: true },
    );
    expect(goalOf(result, "q1", "o1")?.value).toBe(7);
    expect(result.consequences).toEqual([]);
  });
});

/** A move objective rolled from `location`, against any persisted `goal` fields. */
const located = (
  location: object,
  user: object = {},
  goal?: object,
  quest: Record<string, unknown> = {},
) => {
  const objective = MoveToObjective.parse({
    id: "o1",
    task: "move_to_location",
    ...location,
  });
  const definition = makeQuest("q1", [objective], "daily", quest);
  const tracked = makeUser(
    [definition],
    goal ? [{ id: "q1", goals: [{ id: "o1", value: 0, done: false, ...goal }] }] : [],
    user,
  );
  const result = getNewTrackers(tracked, [{ task: "any" }]);
  return { result, objective, goal: goalOf(result, "q1", "o1") };
};

const war = (attackerVillageId: string, defenderVillageId: string) => ({
  attackerVillageId,
  defenderVillageId,
  attackerVillage: { sector: 30 },
  defenderVillage: { sector: 40 },
});

describe("getNewTrackers location instantiation", () => {
  const rolled = { locationType: "specific", longitude: 4, latitude: 5 };

  it.each<[object, object, number]>([
    [{ sectorType: "specific", sector: 9 }, {}, 9],
    [{ sectorType: "from_list", sectorList: ["17"] }, {}, 17],
    [
      { sectorType: "user_village" },
      { sector: 2, village: { id: "v1", sector: 6 } },
      6,
    ],
    [{ sectorType: "user_village" }, { sector: 2, village: null }, 2],
    [{ sectorType: "current_sector" }, { sector: 2 }, 2],
    [{ sectorType: "enemy_village" }, { activeWars: [war("v1", "other")] }, 40],
    [{ sectorType: "enemy_village" }, { activeWars: [war("other", "v1")] }, 30],
  ])("rolls the sector for %j", (location, user, sector) => {
    const { goal, objective, result } = located({ ...rolled, ...location }, user);
    expect(goal).toMatchObject({ sector, longitude: 4, latitude: 5 });
    expect(objective).toMatchObject({ sector, longitude: 4, latitude: 5 });
    expect(result.consequences).toContainEqual({
      type: "update_user",
      ids: ["location_update"],
    });
  });

  it.each([
    { sectorType: "random" },
    { sectorType: "from_list", sectorList: [] },
    { sectorType: "enemy_village" },
  ])("falls back to a placeable sector for %j", (location) => {
    expect(located({ ...rolled, ...location }).goal?.sector).toBeNumber();
  });

  it("keeps a rolled location without another write", () => {
    const { goal, result } = located(
      { sectorType: "random", locationType: "random" },
      {},
      { sector: 3, longitude: 8, latitude: 9 },
    );
    expect(goal).toMatchObject({ sector: 3, longitude: 8, latitude: 9 });
    expect(result.consequences).toEqual([]);
  });

  it("rolls random coordinates inside the sector and pins the objective", () => {
    const { goal, objective } = located({
      sectorType: "specific",
      sector: 9,
      locationType: "random",
    });
    expect(goal?.longitude).toBeGreaterThan(0);
    expect(goal?.latitude).toBeGreaterThan(0);
    expect(objective).toMatchObject({
      locationType: "specific",
      longitude: goal?.longitude,
      latitude: goal?.latitude,
    });
  });

  it("recovers a persisted masked placeholder from the authored fixed location", () => {
    const { goal, result } = located(
      { sector: 9, longitude: 4, latitude: 5 },
      {},
      { sector: 1337, longitude: 1337, latitude: 1337, locationChecked: true },
    );
    expect(goal).toMatchObject({ sector: 9, longitude: 4, latitude: 5 });
    expect(goal).not.toHaveProperty("locationChecked");
    expect(result.consequences).toContainEqual({
      type: "update_user",
      ids: ["location_update"],
    });
  });

  it("rerolls a masked placeholder from its random definition", () => {
    const { goal } = located(
      {
        sectorType: "from_list",
        sectorList: ["17"],
        locationType: "specific",
        longitude: 4,
        latitude: 5,
      },
      {},
      { sector: 1337, longitude: 2, latitude: 3 },
    );
    expect(goal).toMatchObject({ sector: 17, longitude: 2, latitude: 3 });
  });

  it("moves an accepted attempt onto a public landmark's entrance", () => {
    const { goal, result } = located(
      { ...rolled, sectorType: "specific", sector: 9, structureAssetId: "gate" },
      {},
      { sector: 3, longitude: 1, latitude: 1, locationChecked: true },
      { publicLocations: true },
    );
    expect(goal).toMatchObject({
      sector: 9,
      longitude: 4,
      latitude: 5,
      locationChecked: false,
    });
    expect(result.consequences).toContainEqual({
      type: "update_user",
      ids: ["location_update"],
    });
  });

  const dialogChain = (fromGoal: object, extra: object = {}) => {
    const first = MoveToObjective.parse({
      id: "first",
      task: "move_to_location",
      sector: 9,
      longitude: 4,
      latitude: 5,
      nextObjectiveId: "talk",
      ...extra,
    });
    const talk = DialogObjective.parse({ id: "talk", task: "dialog" });
    const quest = makeQuest("q1", [first, talk], "daily", {
      consecutiveObjectives: true,
    });
    const user = makeUser(
      [quest],
      [
        {
          id: "q1",
          goals: [
            { id: "first", value: 0, done: true, selectedNextObjectiveId: "talk" },
            { id: "talk", value: 0, done: false, ...fromGoal },
          ],
        },
      ],
    );
    const result = getNewTrackers(user, [{ task: "any" }]);
    return { result, talk: goalOf(result, "q1", "talk") };
  };

  it("carries a completed predecessor's location onto an implicit dialog", () => {
    const { talk, result } = dialogChain({});
    expect(talk).toMatchObject({ sector: 9, longitude: 4, latitude: 5 });
    expect(result.consequences).toEqual(
      expect.arrayContaining([
        { type: "update_user", ids: ["sector_update"] },
        { type: "update_user", ids: ["longitude_update"] },
        { type: "update_user", ids: ["latitude_update"] },
      ]),
    );
  });
});
