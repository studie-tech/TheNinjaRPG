import { describe, expect, it } from "bun:test";
import { getNewTrackers } from "@/libs/quest";
import {
  trackerGoal as goal,
  trackerUser as makeUser,
  trackerChallengeObjective,
  trackerKessenObjective,
  trackerQuest,
  trackerStormObjective,
} from "../../setup/quest";

const at = (sector: number, longitude: number, latitude: number) => ({
  sector,
  longitude,
  latitude,
});

describe.each([
  ["win_tower_defense", trackerChallengeObjective],
  ["win_chakra_storm", trackerStormObjective],
  ["win_kessen_challenge", trackerKessenObjective],
] as const)("%s objectives", (task, challengeObjective) => {
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
      goal(getNewTrackers(user, [{ task, contentId: "other", text: "q1" }]), "q1", "td")
        ?.done,
    ).toBeFalsy();
    expect(
      goal(getNewTrackers(user, [{ task, contentId: "td", text: "q1" }]), "q1", "td")
        ?.done,
    ).toBe(true);
  });

  it("completes only the challenge of the quest that won it", () => {
    // A cloned quest keeps its objective ids, so both quests hold an objective "td".
    const won = trackerQuest("q1", [challengeObjective("td")], "mission");
    const clone = trackerQuest("q2", [challengeObjective("td")], "mission");
    const user = makeUser([won, clone], [], at(5, 3, 4));
    const trackers = getNewTrackers(user, [{ task, contentId: "td", text: "q1" }]);
    expect(goal(trackers, "q1", "td")?.done).toBe(true);
    expect(goal(trackers, "q2", "td")?.done).toBeFalsy();
  });
});
