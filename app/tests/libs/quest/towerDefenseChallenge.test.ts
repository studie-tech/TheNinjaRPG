import { describe, expect, it } from "bun:test";
import { getNewTrackers } from "@/libs/quest";
import { WinTowerDefense } from "@/validators/objectives";
import {
  trackerChallengeObjective as challengeObjective,
  trackerGoal as goal,
  trackerUser as makeUser,
  trackerQuest,
} from "../../setup/quest";

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
        getNewTrackers(user, [
          { task: "win_tower_defense", contentId: "other", text: "q1" },
        ]),
        "q1",
        "td",
      )?.done,
    ).toBeFalsy();
    expect(
      goal(
        getNewTrackers(user, [
          { task: "win_tower_defense", contentId: "td", text: "q1" },
        ]),
        "q1",
        "td",
      )?.done,
    ).toBe(true);
  });

  it("completes only the challenge of the quest that won it", () => {
    // A cloned quest keeps its objective ids, so both quests hold an objective "td".
    const won = trackerQuest("q1", [challengeObjective("td")], "mission");
    const clone = trackerQuest("q2", [challengeObjective("td")], "mission");
    const user = makeUser([won, clone], [], at(5, 3, 4));
    const trackers = getNewTrackers(user, [
      { task: "win_tower_defense", contentId: "td", text: "q1" },
    ]);
    expect(goal(trackers, "q1", "td")?.done).toBe(true);
    expect(goal(trackers, "q2", "td")?.done).toBeFalsy();
  });
});
