import { describe, expect, it } from "bun:test";
import { getActiveObjective } from "@/libs/objectives";
import { getNewTrackers } from "@/libs/quest";
import { trackerGoal, trackerQuest, trackerUser } from "../../setup/quest";

describe("travel followed by dialogue", () => {
  it("requires arrival before accepting a dialogue choice and then opens dialogue", () => {
    const quest = {
      ...trackerQuest("travel-dialog", [
        {
          id: "travel",
          task: "move_to_location",
          sectorType: "specific",
          locationType: "specific",
          sector: 1,
          longitude: 12,
          latitude: 7,
          nextObjectiveId: "dialog",
        },
        {
          id: "dialog",
          task: "dialog",
          nextObjectiveId: [{ text: "Continue", nextObjectiveId: "finish" }],
        },
        { id: "finish", task: "win_quest" },
      ]),
      consecutiveObjectives: true,
    };
    const user = trackerUser([quest]);
    Object.assign(user, { longitude: 1, latitude: 1 });
    const pending = getNewTrackers(user, [{ task: "any" }]);
    user.questData = pending.trackers;
    const skipped = getNewTrackers(user, [{ task: "dialog", contentId: "finish" }]);
    expect(trackerGoal(skipped, quest.id, "travel")?.done).toBe(false);
    expect(trackerGoal(skipped, quest.id, "dialog")?.done).toBe(false);

    user.questData = skipped.trackers;
    Object.assign(user, { longitude: 12, latitude: 7 });
    const arrived = getNewTrackers(user, [{ task: "move_to_location" }]);
    expect(trackerGoal(arrived, quest.id, "travel")?.done).toBe(true);
    expect(trackerGoal(arrived, quest.id, "dialog")?.done).toBe(false);
    const definition = user.userQuests[0]?.quest;
    const tracker = arrived.trackers.find((entry) => entry.id === quest.id);
    expect(definition && tracker && getActiveObjective(definition, tracker)?.id).toBe(
      "dialog",
    );
  });
});
