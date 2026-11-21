import { describe, expect, it } from "bun:test";
import { getNewTrackers } from "@/libs/quest";
import { findTowerDefenseChallenge } from "@/libs/towerDefense/challenge";
import { WinTowerDefense } from "@/validators/objectives";
import {
  trackerGoal as goal,
  trackerUser as makeUser,
  trackerQuest,
} from "../../setup/quest";

/** A tower defense challenge objective at sector 5, position [3, 4]. */
const challengeObjective = (id: string, overrides: object = {}) =>
  WinTowerDefense.parse({
    id,
    task: "win_tower_defense",
    sector: 5,
    longitude: 3,
    latitude: 4,
    startWave: 21,
    waves: 5,
    enemyHealth: 150,
    enemyDamage: 80,
    ...overrides,
  });

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

describe("win_tower_defense objectives", () => {
  it("parses with the defaults content staff start from", () => {
    const parsed = WinTowerDefense.parse({ id: "td", task: "win_tower_defense" });
    expect(parsed).toMatchObject({
      startWave: 1,
      waves: 10,
      enemyHealth: 100,
      enemyDamage: 100,
    });
    expect(
      WinTowerDefense.safeParse({ id: "td", task: "win_tower_defense", waves: 0 })
        .success,
    ).toBe(false);
    expect(
      WinTowerDefense.safeParse({ id: "td", task: "win_tower_defense", enemyHealth: 5 })
        .success,
    ).toBe(false);
  });

  it("completes only from the verified win naming it", () => {
    const quest = trackerQuest("q1", [challengeObjective("td")], "mission");
    const user = makeUser([quest], [], at(5, 3, 4));
    expect(goal(getNewTrackers(user, [{ task: "any" }]), "q1", "td")?.done).toBeFalsy();
    expect(
      goal(
        getNewTrackers(user, [
          { task: "move_to_location" },
          { task: "defeat_opponents" },
        ]),
        "q1",
        "td",
      )?.done,
    ).toBeFalsy();
    expect(
      goal(
        getNewTrackers(user, [{ task: "win_tower_defense", contentId: "other" }]),
        "q1",
        "td",
      )?.done,
    ).toBeFalsy();
    expect(
      goal(
        getNewTrackers(user, [{ task: "win_tower_defense", contentId: "td" }]),
        "q1",
        "td",
      )?.done,
    ).toBe(true);
  });

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
    const here = findTowerDefenseChallenge(makeUser([quest], questData, at(7, 2, 2)), {
      questId: "q1",
      objectiveId: "td",
    });
    expect(here).toMatchObject({ done: false, available: true, atLocation: true });
    expect(here?.objective).toMatchObject({ sector: 7, longitude: 2, latitude: 2 });
    const away = findTowerDefenseChallenge(makeUser([quest], questData, at(5, 3, 4)), {
      questId: "q1",
      objectiveId: "td",
    });
    expect(away?.atLocation).toBe(false);
  });

  it("reports a finished challenge and one the quest has not reached", () => {
    const done = trackerQuest("q1", [challengeObjective("td")], "mission");
    const doneData = [{ id: "q1", goals: [{ id: "td", done: true, value: 0 }] }];
    expect(
      findTowerDefenseChallenge(makeUser([done], doneData, at(5, 3, 4)), {
        questId: "q1",
        objectiveId: "td",
      })?.done,
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
      findTowerDefenseChallenge(makeUser([ordered], orderedData, at(5, 3, 4)), {
        questId: "q2",
        objectiveId: "td",
      })?.available,
    ).toBe(false);
  });

  it("finds nothing for another task or another player's quest", () => {
    const quest = trackerQuest("q1", [moveObjective("move")], "mission");
    const user = makeUser([quest], [], at(9, 1, 1));
    expect(
      findTowerDefenseChallenge(user, { questId: "q1", objectiveId: "move" }),
    ).toBeNull();
    expect(
      findTowerDefenseChallenge(user, { questId: "q9", objectiveId: "td" }),
    ).toBeNull();
  });
});
