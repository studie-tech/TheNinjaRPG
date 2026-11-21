import { describe, expect, it } from "bun:test";
import { findQuestChallenge } from "@/libs/quest/challenge";
import {
  trackerChallengeObjective as challengeObjective,
  trackerUser as makeUser,
  trackerQuest,
  trackerStormObjective,
} from "../../setup/quest";

const moveObjective = (id: string) => ({
  id,
  task: "move_to_location" as const,
  sector: 9,
  longitude: 1,
  latitude: 1,
});

const at = (sector: number, longitude: number, latitude: number) => ({
  sector,
  longitude,
  latitude,
});

describe("findQuestChallenge", () => {
  it("finds the challenge with the location rolled for the player", () => {
    const quest = trackerQuest("q1", [challengeObjective("td")], "mission");
    const questData = [
      {
        id: "q1",
        startAt: new Date().toISOString(),
        goals: [
          { id: "td", done: false, value: 0, sector: 7, longitude: 2, latitude: 2 },
        ],
      },
    ];
    const here = findQuestChallenge(
      makeUser([quest], questData, at(7, 2, 2)),
      {
        questId: "q1",
        objectiveId: "td",
      },
      "win_tower_defense",
    );
    expect(here).toMatchObject({ done: false, available: true, atLocation: true });
    expect(here?.objective).toMatchObject({ sector: 7, longitude: 2, latitude: 2 });
    const away = findQuestChallenge(
      makeUser([quest], questData, at(5, 3, 4)),
      {
        questId: "q1",
        objectiveId: "td",
      },
      "win_tower_defense",
    );
    expect(away?.atLocation).toBe(false);
  });

  it("reports a finished challenge and one the quest has not reached", () => {
    const done = trackerQuest("q1", [challengeObjective("td")], "mission");
    const doneData = [{ id: "q1", goals: [{ id: "td", done: true, value: 0 }] }];
    expect(
      findQuestChallenge(
        makeUser([done], doneData, at(5, 3, 4)),
        {
          questId: "q1",
          objectiveId: "td",
        },
        "win_tower_defense",
      )?.done,
    ).toBe(true);

    const ordered = trackerQuest(
      "q2",
      [{ ...moveObjective("first"), nextObjectiveId: "td" }, challengeObjective("td")],
      "mission",
      { consecutiveObjectives: true },
    );
    const orderedData = [
      {
        id: "q2",
        goals: [
          { id: "first", done: false, value: 0 },
          { id: "td", done: false, value: 0 },
        ],
      },
    ];
    expect(
      findQuestChallenge(
        makeUser([ordered], orderedData, at(5, 3, 4)),
        {
          questId: "q2",
          objectiveId: "td",
        },
        "win_tower_defense",
      )?.available,
    ).toBe(false);
  });

  it("finds a storm challenge only under its own task", () => {
    const quest = trackerQuest("q1", [trackerStormObjective("cs")], "mission");
    const user = makeUser([quest], [], at(5, 3, 4));
    const request = { questId: "q1", objectiveId: "cs" };
    expect(findQuestChallenge(user, request, "win_chakra_storm")).toMatchObject({
      objective: { stage: "akasumi", surviveMinutes: 3 },
      atLocation: true,
    });
    expect(findQuestChallenge(user, request, "win_tower_defense")).toBeNull();
  });

  it("finds nothing for another task or another player's quest", () => {
    const quest = trackerQuest("q1", [moveObjective("move")], "mission");
    const user = makeUser([quest], [], at(9, 1, 1));
    expect(
      findQuestChallenge(
        user,
        { questId: "q1", objectiveId: "move" },
        "win_tower_defense",
      ),
    ).toBeNull();
    expect(
      findQuestChallenge(
        user,
        { questId: "q9", objectiveId: "td" },
        "win_tower_defense",
      ),
    ).toBeNull();
  });
});
