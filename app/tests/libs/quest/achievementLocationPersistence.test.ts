import { afterEach, describe, expect, it, vi } from "bun:test";
import type { Quest } from "@/drizzle/schema";
import {
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  getQuestTargetSectorsToCheck,
  snapQuestTargetsToReachable,
} from "@/libs/quest";
import { mockAchievementHistoryEntries } from "@/libs/quest/projection";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import type { QuestTrackerType } from "@/validators/objectives";
import { DefeatOpponents, QuestTracker } from "@/validators/objectives";
import { trackerQuest, trackerUser } from "../../setup/quest";

const makeUser = (questData: QuestTrackerType[] = [], randomLocation = false) => {
  const defeatCreator = DefeatOpponents.parse({
    id: "defeat-creator",
    task: "defeat_opponents",
    sectorType: randomLocation ? "random" : "specific",
    sector: 0,
    locationType: randomLocation ? "random" : "specific",
    longitude: 0,
    latitude: 0,
    opponentAIs: [{ ids: ["creator-ai"], number: 1 }],
  });
  const achievement = trackerQuest("creator", [defeatCreator], "achievement", {
    name: "Kill the Creator",
    maxAttempts: 0,
    maxCompletes: 1,
  }) as unknown as Quest;
  const user = trackerUser([], structuredClone(questData), {
    userId: "player",
    villageId: "village",
    longitude: 1,
    latitude: 1,
    village: { id: "village", sector: 1 },
  });
  user.userQuests.push(...mockAchievementHistoryEntries([achievement], user));
  return user;
};

const creatorMap: Pick<NormalizedSectorMap, "width" | "height" | "tiles" | "anchors"> =
  {
    width: 1,
    height: 1,
    tiles: [
      {
        x: 0,
        y: 0,
        terrain: "ground",
        walkCost: 1,
        blocked: false,
        zone: "wilderness",
        battleBiome: "ground",
      },
    ],
    anchors: [{ key: "spawn.default", x: 0, y: 0 }],
  };

afterEach(() => vi.restoreAllMocks());

describe("achievement location persistence", () => {
  it("converges after instantiating and checking a mock achievement's zero-valued location", () => {
    const user = makeUser();
    const first = getNewTrackers(user, [{ task: "any" }]);
    expect(first.consequences).toEqual([
      { type: "update_user", ids: ["location_update"] },
      { type: "update_user", ids: ["location_update"] },
    ]);
    expect(getQuestTargetSectorsToCheck(user, first.trackers, true)).toEqual([0]);
    expect(
      snapQuestTargetsToReachable(user, first.trackers, new Map([[0, creatorMap]])),
    ).toBe(true);

    const persisted = filterQuestTrackersForDbPersist(first.trackers, user);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.goals[0]).toMatchObject({
      sector: 0,
      longitude: 0,
      latitude: 0,
      locationChecked: true,
      done: false,
      value: 0,
    });
    for (let pass = 0; pass < 3; pass++) {
      const reloaded = makeUser(persisted);
      const next = getNewTrackers(reloaded, [{ task: "any" }]);
      expect(next.consequences).toEqual([]);
      expect(next.notifications).toEqual([]);
      expect(getQuestTargetSectorsToCheck(reloaded, next.trackers, true)).toEqual([]);
      expect(filterQuestTrackersForDbPersist(next.trackers, reloaded)).toEqual(
        persisted,
      );
      expect(reloaded.userQuests[0]?.quest.content.objectives[0]).toMatchObject({
        sector: 0,
        longitude: 0,
        latitude: 0,
      });
    }
  });

  it("keeps an unchecked target for map retries without re-instantiating it", () => {
    const user = makeUser();
    const first = getNewTrackers(user, [{ task: "any" }]);
    expect(snapQuestTargetsToReachable(user, first.trackers, new Map())).toBe(false);
    const reloaded = makeUser(filterQuestTrackersForDbPersist(first.trackers, user));
    const next = getNewTrackers(reloaded, [{ task: "any" }]);
    expect(next.consequences).toEqual([]);
    expect(getQuestTargetSectorsToCheck(reloaded, next.trackers, true)).toEqual([0]);
  });

  it("retains a random target across reloads", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.25);
    const user = makeUser([], true);
    const first = getNewTrackers(user, [{ task: "any" }]);
    const persisted = filterQuestTrackersForDbPersist(first.trackers, user);
    random.mockReturnValue(0.75);
    const reloaded = makeUser(persisted, true);
    const next = getNewTrackers(reloaded, [{ task: "any" }]);
    expect(next.consequences).toEqual([]);
    expect(next.trackers[0]?.goals).toEqual(first.trackers[0]?.goals);
  });

  it.each(["sector", "longitude", "latitude"] as const)(
    "retains a partially instantiated %s at zero",
    (field) => {
      const user = makeUser();
      const tracker = QuestTracker.parse({
        id: "creator",
        goals: [{ id: "defeat-creator", [field]: 0 }],
      });
      expect(filterQuestTrackersForDbPersist([tracker], user)).toEqual([tracker]);
    },
  );

  it("still omits a mock achievement with no location or earned progress", () => {
    const user = makeUser();
    const tracker = QuestTracker.parse({
      id: "creator",
      goals: [{ id: "defeat-creator" }],
    });
    expect(filterQuestTrackersForDbPersist([tracker], user)).toEqual([]);
  });
});
