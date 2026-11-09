import { describe, expect, it } from "bun:test";
import { TUTORIAL_STEPS_COUNT } from "@/drizzle/constants";
import { getArrivalQuestTriggers } from "@/libs/quest";
import { trackerQuest, trackerUser } from "../../setup/quest";

const here = { sector: 4, longitude: 12, latitude: 7 };
const elsewhere = { sector: 4, longitude: 3, latitude: 3 };
const playing = { tutorialOn: false };

const travel = (id: string, extra: object = {}) => ({
  id,
  task: "move_to_location",
  sector: 4,
  longitude: 12,
  latitude: 7,
  ...extra,
});

describe("getArrivalQuestTriggers", () => {
  it("checks the quest when standing on an available objective's tile", () => {
    const user = trackerUser([trackerQuest("q", [travel("go")])], [], playing);
    expect(getArrivalQuestTriggers(user, here)).toEqual({
      shouldCheckQuest: true,
      dialogQuestIds: [],
    });
    expect(getArrivalQuestTriggers(user, elsewhere)).toEqual({
      shouldCheckQuest: false,
      dialogQuestIds: [],
    });
  });

  it("matches the objective's sector as well as its coordinates", () => {
    const user = trackerUser([trackerQuest("q", [travel("go")])], [], playing);
    expect(getArrivalQuestTriggers(user, { ...here, sector: 5 }).shouldCheckQuest).toBe(
      false,
    );
  });

  it("checks hidden-location and random-encounter objectives from any tile", () => {
    for (const extra of [
      { hideLocation: true },
      { attackers: [{ ids: ["ai"], number: 5 }] },
    ]) {
      const user = trackerUser([trackerQuest("q", [travel("go", extra)])], [], playing);
      expect(getArrivalQuestTriggers(user, elsewhere).shouldCheckQuest).toBe(true);
    }
    const empty = trackerUser(
      [trackerQuest("q", [travel("go", { attackers: [] })])],
      [],
      playing,
    );
    expect(getArrivalQuestTriggers(empty, elsewhere).shouldCheckQuest).toBe(false);
  });

  it("checks a running timed collection away from its tile only", () => {
    const collect = travel("collect", {
      task: "collect_item",
      collect_time_minutes: 5,
    });
    const tracked = (done: boolean) =>
      trackerUser(
        [trackerQuest("q", [collect])],
        [{ id: "q", goals: [{ id: "collect", done, timestamp: new Date() }] }],
        playing,
      );
    expect(getArrivalQuestTriggers(tracked(false), elsewhere).shouldCheckQuest).toBe(
      true,
    );
    expect(getArrivalQuestTriggers(tracked(true), elsewhere).shouldCheckQuest).toBe(
      false,
    );
    const untimed = trackerUser(
      [trackerQuest("q", [collect])],
      [{ id: "q", goals: [{ id: "collect", done: false }] }],
      playing,
    );
    expect(getArrivalQuestTriggers(untimed, elsewhere).shouldCheckQuest).toBe(false);
  });

  it("ignores objectives that a consecutive quest has not reached", () => {
    const quest = trackerQuest(
      "q",
      [travel("first", { sector: 9, nextObjectiveId: "second" }), travel("second")],
      "daily",
      { consecutiveObjectives: true },
    );
    const pending = trackerUser(
      [quest],
      [
        {
          id: "q",
          goals: [
            { id: "first", done: false },
            { id: "second", done: false },
          ],
        },
      ],
      playing,
    );
    expect(getArrivalQuestTriggers(pending, here).shouldCheckQuest).toBe(false);
    const reached = trackerUser(
      [quest],
      [
        {
          id: "q",
          goals: [
            { id: "first", done: true, selectedNextObjectiveId: "second" },
            { id: "second", done: false },
          ],
        },
      ],
      playing,
    );
    expect(getArrivalQuestTriggers(reached, here).shouldCheckQuest).toBe(true);
  });

  it("opens each unbound dialog quest on its tile outside the tutorial", () => {
    const dialog = (id: string, extra: object = {}) =>
      trackerQuest(id, [travel(`${id}-talk`, { task: "dialog", ...extra })]);
    const quests = [
      dialog("a"),
      dialog("bound", { overworldPlacementId: "npc" }),
      dialog("b"),
    ];
    expect(
      getArrivalQuestTriggers(trackerUser(quests, [], playing), here).dialogQuestIds,
    ).toEqual(["a", "b"]);
    expect(
      getArrivalQuestTriggers(trackerUser(quests, [], playing), elsewhere)
        .dialogQuestIds,
    ).toEqual([]);
    expect(
      getArrivalQuestTriggers(
        trackerUser(quests, [], { tutorialOn: true, tutorialStep: 0 }),
        here,
      ).dialogQuestIds,
    ).toEqual([]);
    expect(
      getArrivalQuestTriggers(
        trackerUser(quests, [], {
          tutorialOn: true,
          tutorialStep: TUTORIAL_STEPS_COUNT,
        }),
        here,
      ).dialogQuestIds,
    ).toEqual(["a", "b"]);
  });

  it("returns no triggers for a user without quests", () => {
    const user = trackerUser([], [], playing);
    expect(
      getArrivalQuestTriggers({ ...user, userQuests: undefined } as never, here),
    ).toEqual({
      shouldCheckQuest: false,
      dialogQuestIds: [],
    });
  });
});
