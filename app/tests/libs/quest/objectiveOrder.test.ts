import { describe, expect, it } from "bun:test";
import { getNewTrackers } from "@/libs/quest";
import { verifyQuestContentForSave } from "@/libs/quest/validation";
import { getObjectiveSchema } from "@/validators/objectives";
import { trackerGoal, trackerQuest, trackerUser } from "../../setup/quest";

const objective = (value: Record<string, unknown>) =>
  getObjectiveSchema(value.task as string).parse(value);

const fight = objective({
  id: "fight",
  task: "start_battle",
  opponentAIs: [{ ids: ["foe"], number: 1 }],
});

describe("consecutive objective evaluation order", () => {
  it.each([false, true])(
    "starts the arrival battle in the arrival update (reversed: %s)",
    (reversed) => {
      const travel = objective({
        id: "travel",
        task: "move_to_location",
        sector: 5,
        longitude: 3,
        latitude: 3,
        nextObjectiveId: "fight",
      });
      const objectives = reversed ? [fight, travel] : [travel, fight];
      expect(verifyQuestContentForSave(objectives, true).check).toBe(true);
      const quest = trackerQuest("arrival", objectives, "mission", {
        consecutiveObjectives: true,
      });
      const user = trackerUser([quest], [], {
        status: "AWAKE",
        longitude: 0,
        latitude: 0,
      });
      const pending = getNewTrackers(user, [{ task: "any" }]);
      expect(pending.consequences.filter((entry) => entry.type === "combat")).toEqual(
        [],
      );
      expect(trackerGoal(pending, quest.id, "travel")).toMatchObject({
        done: false,
        selectedNextObjectiveId: "fight",
      });
      user.questData = pending.trackers;
      Object.assign(user, { sector: 5, longitude: 3, latitude: 3 });

      const arrived = getNewTrackers(
        user,
        [{ task: "any" }],
        undefined,
        undefined,
        undefined,
        true,
      );
      expect(trackerGoal(arrived, quest.id, "travel")?.done).toBe(true);
      expect(
        arrived.consequences.filter((entry) => entry.type === "combat"),
      ).toMatchObject([{ questId: quest.id, objectiveId: "fight", ids: ["foe"] }]);
      expect(arrived.trackers[0]?.goals.map((goal) => goal.id)).toEqual(
        objectives.map((entry) => entry.id),
      );
    },
  );

  it("runs an unlocked chain once while applying each event increment once", () => {
    const objectives = [
      fight,
      objective({
        id: "collect",
        task: "collect_item",
        collectItemIds: ["scroll"],
        item_name: "Scroll",
        sector: 1,
        longitude: 3,
        latitude: 3,
        nextObjectiveId: "fight",
      }),
      objective({
        id: "new",
        task: "new_quest",
        newQuestIds: ["followup"],
        nextObjectiveId: "collect",
      }),
      objective({
        id: "counter",
        task: "stats_trained",
        value: 1,
        nextObjectiveId: "new",
      }),
    ];
    expect(verifyQuestContentForSave(objectives, true).check).toBe(true);
    const quest = trackerQuest("chain", objectives, "mission", {
      consecutiveObjectives: true,
    });
    const daily = trackerQuest("daily", [
      objective({ id: "partial", task: "stats_trained", value: 10 }),
    ]);
    const user = trackerUser([quest, daily], [], {
      status: "AWAKE",
      longitude: 3,
      latitude: 3,
    });
    user.questData = getNewTrackers(user, [{ task: "any" }]).trackers;
    const result = getNewTrackers(user, [
      { task: "any" },
      { task: "stats_trained", increment: 1 },
      { task: "collect_item" },
    ]);

    expect(trackerGoal(result, quest.id, "counter")).toMatchObject({
      value: 1,
      done: true,
    });
    expect(trackerGoal(result, daily.id, "partial")).toMatchObject({
      value: 1,
      done: false,
    });
    expect(result.consequences.filter((entry) => entry.type === "start_quest")).toEqual(
      [{ type: "start_quest", ids: ["followup"] }],
    );
    expect(result.consequences.filter((entry) => entry.type === "add_item")).toEqual([
      { type: "add_item", ids: ["scroll"] },
    ]);
    expect(result.consequences.filter((entry) => entry.type === "combat")).toHaveLength(
      1,
    );
  });

  it("follows the selected branch through a shared successor", () => {
    const objectives = [
      fight,
      objective({
        id: "left",
        task: "new_quest",
        newQuestIds: ["selected"],
        nextObjectiveId: "fight",
      }),
      objective({
        id: "right",
        task: "new_quest",
        newQuestIds: ["unselected"],
        nextObjectiveId: "fight",
      }),
      objective({
        id: "choose",
        task: "dialog",
        nextObjectiveId: [
          { text: "Left", nextObjectiveId: "left" },
          { text: "Right", nextObjectiveId: "right" },
        ],
      }),
    ];
    expect(verifyQuestContentForSave(objectives, true).check).toBe(true);
    const quest = trackerQuest("branch", objectives, "mission", {
      consecutiveObjectives: true,
    });
    const user = trackerUser([quest], [], { status: "AWAKE" });
    user.questData = getNewTrackers(user, [{ task: "any" }]).trackers;
    const result = getNewTrackers(user, [
      { task: "any" },
      { task: "dialog", contentId: "left" },
    ]);
    expect(trackerGoal(result, quest.id, "right")?.done).toBe(false);
    expect(result.consequences.filter((entry) => entry.type === "start_quest")).toEqual(
      [{ type: "start_quest", ids: ["selected"] }],
    );
    expect(result.consequences.filter((entry) => entry.type === "combat")).toHaveLength(
      1,
    );
  });
});
