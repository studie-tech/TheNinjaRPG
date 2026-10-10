import { SECTOR_WIDTH, SECTOR_HEIGHT } from "@/drizzle/constants";
import { describe, expect, it } from "bun:test";
import {
  getNewTrackers,
  getPublicQuestUser,
  hasActiveHiddenQuestObjectives,
} from "@/libs/quest";
import type { UserWithRelations } from "@/routers/profile";

const makeUser = (sector = 1, role = "USER") =>
  ({
    role,
    sector,
    questData: [
      { id: "q", goals: [{ id: "o", sector: 8, longitude: 4, latitude: 5 }] },
    ],
    userQuests: [
      {
        questId: "q",
        quest: {
          id: "q",
          content: {
            objectives: [
              {
                id: "o",
                task: "move_to_location",
                hideLocation: true,
                sector: 2,
                longitude: 0,
                latitude: 0,
                sectorType: "random",
                sectorList: ["2", "8"],
                locationType: "random",
              },
            ],
          },
        },
      },
    ],
  }) as unknown as NonNullable<UserWithRelations>;

const objective = (user: NonNullable<UserWithRelations>) =>
  user.userQuests[0]!.quest.content.objectives[0]!;

describe("hidden quest response locations", () => {
  it("masks both client channels without modifying canonical trackers or quest definitions", () => {
    const user = makeUser();
    const original = structuredClone(user);
    const response = getPublicQuestUser(user);
    expect(objective(response)).toMatchObject({
      sector: 1337,
      longitude: 1337,
      latitude: 1337,
      sectorList: ["1337"],
    });
    expect(response.questData![0]!.goals[0]).not.toHaveProperty("sector");
    expect(response.questData![0]!.goals[0]).not.toHaveProperty("longitude");
    expect(response.questData![0]!.goals[0]).not.toHaveProperty("latitude");
    expect(user).toEqual(original);
  });

  it("reveals the existing rolled location after arriving, without rerolling or using authored defaults", () => {
    const user = makeUser();
    getPublicQuestUser(user);
    user.sector = 8;
    expect(objective(getPublicQuestUser(user))).toMatchObject({
      sector: 8,
      longitude: 4,
      latitude: 5,
    });
    expect(user.questData![0]!.goals[0]).toMatchObject({
      sector: 8,
      longitude: 4,
      latitude: 5,
    });
  });

  it("remasks a target on departure without destroying it for a later return", () => {
    const user = makeUser(8);
    expect(objective(getPublicQuestUser(user))).toMatchObject({ sector: 8 });
    user.sector = 1;
    expect(objective(getPublicQuestUser(user))).toMatchObject({ sector: 1337 });
    user.sector = 8;
    expect(objective(getPublicQuestUser(user))).toMatchObject({
      sector: 8,
      longitude: 4,
      latitude: 5,
    });
  });

  it("returns real coordinates if staff unhides the quest after a masked read", () => {
    const user = makeUser();
    getPublicQuestUser(user);
    const target = objective(user);
    if ("hideLocation" in target) target.hideLocation = false;
    expect(objective(getPublicQuestUser(user))).toMatchObject({
      sector: 8,
      longitude: 4,
      latitude: 5,
    });
  });

  it("preserves staff visibility", () => {
    expect(objective(getPublicQuestUser(makeUser(1, "CONTENT")))).toMatchObject({
      sector: 8,
      longitude: 4,
      latitude: 5,
    });
  });
});

const makeTrackedUser = (overrides: Record<string, unknown> = {}) => {
  const user = makeUser();
  Object.assign(user, {
    userId: "u1",
    level: 50,
    rank: "JONIN",
    villageId: "v1",
    isOutlaw: false,
    village: { id: "v1", sector: 1 },
    activeWars: [],
    completedQuests: [],
    dailyMissions: 0,
  });
  Object.assign(user.userQuests[0]!, {
    completed: 0,
    previousAttempts: 1,
    previousCompletes: 0,
  });
  Object.assign(user.userQuests[0]!.quest, {
    name: "Hidden target",
    questType: "mission",
    hidden: false,
    consecutiveObjectives: false,
    maxAttempts: 100,
    maxCompletes: 100,
    requiredVillage: null,
    requiredBloodlineId: null,
    prerequisiteQuestId: null,
    requiredLevel: null,
    maxLevel: null,
    medicalRank: null,
    huntingRank: null,
    gatheringRank: null,
    endsAt: null,
  });
  Object.assign(objective(user), {
    sectorType: "specific",
    locationType: "specific",
    ...overrides,
  });
  Object.assign(user.questData![0]!.goals[0]!, {
    done: false,
    value: 7,
    collected: false,
    sector: 1337,
    longitude: 1337,
    latitude: 1337,
    locationChecked: true,
  });
  return user;
};

describe("persisted masked target recovery", () => {
  it("restores an authored target and clears reachability verification without losing progress", () => {
    const user = makeTrackedUser();
    const result = getNewTrackers(user, [{ task: "any" }]);
    expect(result.trackers[0]!.goals[0]).toMatchObject({
      sector: 2,
      longitude: 0,
      latitude: 0,
      done: false,
      value: 7,
      collected: false,
    });
    expect(result.trackers[0]!.goals[0]).not.toHaveProperty("locationChecked");
    expect(result.consequences).toContainEqual({
      type: "update_user",
      ids: ["location_update"],
    });
  });

  it("rerolls an invalid private dynamic target using its authored sector policy", () => {
    const user = makeTrackedUser({
      sectorType: "from_list",
      sectorList: ["8"],
      locationType: "random",
    });
    const goal = getNewTrackers(user, [{ task: "any" }]).trackers[0]!.goals[0]!;
    expect(goal.sector).toBe(8);
    expect(goal.longitude).toBeGreaterThanOrEqual(1);
    expect(goal.longitude).toBeLessThan(SECTOR_WIDTH);
    expect(goal.latitude).toBeGreaterThanOrEqual(1);
    expect(goal.latitude).toBeLessThan(SECTOR_HEIGHT);
    expect(goal.value).toBe(7);
  });

  it("preserves valid tracker fields when only a sector is corrupted", () => {
    const user = makeTrackedUser();
    Object.assign(user.questData![0]!.goals[0]!, { longitude: 4, latitude: 5 });
    expect(getNewTrackers(user, [{ task: "any" }]).trackers[0]!.goals[0]).toMatchObject(
      { sector: 2, longitude: 4, latitude: 5 },
    );
  });

  it("repairs a legacy authored objective without location policy fields and preserves completion", () => {
    const user = makeTrackedUser();
    const target = objective(user);
    delete (target as unknown as Record<string, unknown>).sectorType;
    delete (target as unknown as Record<string, unknown>).locationType;
    user.questData![0]!.goals[0]!.done = true;
    expect(getNewTrackers(user, [{ task: "any" }]).trackers[0]!.goals[0]).toMatchObject(
      { sector: 2, longitude: 0, latitude: 0, done: true, value: 7 },
    );
  });
});

describe("global arrival quest refresh policy", () => {
  it("skips profile refresh without quests or for visible objectives", () => {
    const empty = makeUser();
    empty.userQuests = [];
    expect(hasActiveHiddenQuestObjectives(empty)).toBe(false);
    const visible = makeUser();
    Object.assign(objective(visible), { hideLocation: false });
    expect(hasActiveHiddenQuestObjectives(visible)).toBe(false);
  });

  it("skips completed objectives and ended or completed quest entries", () => {
    const done = makeUser();
    done.questData![0]!.goals[0]!.done = true;
    expect(hasActiveHiddenQuestObjectives(done)).toBe(false);
    const completed = makeUser();
    completed.userQuests[0]!.completed = 1;
    expect(hasActiveHiddenQuestObjectives(completed)).toBe(false);
    const ended = makeUser();
    ended.userQuests[0]!.endAt = new Date();
    expect(hasActiveHiddenQuestObjectives(ended)).toBe(false);
  });

  it("refreshes active hidden targets whether masked or already revealed, without mutating either", () => {
    for (const sector of [1, 8]) {
      const user = getPublicQuestUser(makeUser(sector));
      const original = structuredClone(user);
      expect(hasActiveHiddenQuestObjectives(user)).toBe(true);
      expect(user).toEqual(original);
    }
  });

  it("skips projection for staff whose hidden locations are already public", () => {
    expect(hasActiveHiddenQuestObjectives(makeUser(1, "CONTENT"))).toBe(false);
  });

  it("uses consecutive objective availability and skips a hidden target on an unopened branch", () => {
    const user = makeUser();
    const quest = user.userQuests[0]!.quest;
    quest.consecutiveObjectives = true;
    quest.content.objectives.unshift({
      id: "first",
      task: "win_quest",
      nextObjectiveId: "o",
    } as (typeof quest.content.objectives)[number]);
    user.questData![0]!.goals.unshift({ id: "first", done: false } as NonNullable<
      typeof user.questData
    >[number]["goals"][number]);
    expect(hasActiveHiddenQuestObjectives(user)).toBe(false);
    user.questData![0]!.goals[0]!.selectedNextObjectiveId = "o";
    user.questData![0]!.goals[0]!.done = true;
    expect(hasActiveHiddenQuestObjectives(user)).toBe(true);
  });
});
