import { describe, expect, it } from "bun:test";
import { canRetryQuestBattle } from "@/libs/objectives";
import { applyQuestResets, getNewTrackers } from "@/libs/quest";
import { getObjectiveSchema } from "@/validators/objectives";

type TrackerUser = Parameters<typeof getNewTrackers>[0];

const parse = (objective: Record<string, unknown>) =>
  getObjectiveSchema(objective.task as string).parse(objective);

// Same shape as the live A-rank missions: losing the fight routes into a reset to the fight.
const objectives = [
  parse({
    id: "intro",
    task: "dialog",
    nextObjectiveId: [{ text: "Go", nextObjectiveId: "fight" }],
  }),
  parse({
    id: "fight",
    task: "start_battle",
    opponentAIs: [{ ids: ["foe"], number: 1 }],
    failObjectiveId: "again",
    nextObjectiveId: "won",
  }),
  parse({ id: "won", task: "win_quest" }),
  parse({ id: "again", task: "reset_quest", resetObjectiveId: "fight" }),
];

const makeUser = (status: string) =>
  ({
    userId: "hero",
    status,
    sector: 1,
    longitude: 1,
    latitude: 1,
    items: [],
    useritems: [],
    activeWars: [],
    completedQuests: [],
    questData: [
      {
        id: "mission",
        startAt: new Date().toISOString(),
        goals: [
          {
            id: "intro",
            done: true,
            value: 0,
            collected: false,
            recentlyDied: false,
            selectedNextObjectiveId: "fight",
          },
        ],
      },
    ],
    userQuests: [
      {
        questId: "mission",
        completed: 0,
        previousAttempts: 0,
        previousCompletes: 0,
        quest: {
          id: "mission",
          name: "Long Winter",
          questType: "mission",
          questRank: "A",
          hidden: false,
          consecutiveObjectives: true,
          maxAttempts: 100,
          maxCompletes: 100,
          content: { objectives },
        },
      },
    ],
  }) as unknown as TrackerUser;

/** Runs one tracker pass and applies its resets, as handleQuestConsequences does. */
const pass = (user: TrackerUser, tasks: Parameters<typeof getNewTrackers>[1]) => {
  const result = getNewTrackers(user, tasks);
  user.questData = applyQuestResets(
    result.trackers,
    result.consequences.filter((c) => c.type === "reset_quest"),
  );
  return result.consequences;
};

describe("quest battle reset after a loss", () => {
  it("does not restart the lost battle when the player leaves hospital", () => {
    // Battle settles as a loss while the player is still in battle
    const user = makeUser("BATTLE");
    pass(user, [{ task: "start_battle", contentId: "foe", text: "Lost" }]);
    // Hospitalised page loads route through the reset branch
    user.status = "HOSPITALIZED";
    pass(user, [{ task: "any" }]);
    pass(user, [{ task: "any" }]);
    // Leaving hospital: the next request must not drag the player straight back into combat
    user.status = "AWAKE";
    const consequences = pass(user, [{ task: "any" }]);
    expect(consequences.some((c) => c.type === "combat")).toBe(false);
    const fight = user.questData?.[0]?.goals.find((g) => g.id === "fight");
    expect(canRetryQuestBattle(fight)).toBe(true);
    // The player starts the fight again when ready
    const retried = pass(user, [{ task: "start_battle", text: "retry" }]);
    expect(retried.some((c) => c.type === "combat")).toBe(true);
  });

  it("keeps resetting a battle that was never lost", () => {
    const trackers = [
      {
        id: "mission",
        startAt: new Date().toISOString(),
        goals: [
          {
            id: "fight",
            done: true,
            value: 0,
            collected: false,
            recentlyDied: false,
            selectedNextObjectiveId: "again",
          },
          { id: "again", done: false, value: 0, collected: false, recentlyDied: false },
        ],
      },
    ];
    const reset = applyQuestResets(trackers, [
      { type: "reset_quest", ids: ["mission"], info: "fight" },
    ]);
    expect(reset?.[0]?.goals).toEqual([]);
  });

  it("lets managed runs resume their checkpoint without a manual retry", () => {
    const trackers = [
      {
        id: "pyramid",
        startAt: new Date().toISOString(),
        goals: [
          {
            id: "floor",
            done: true,
            value: 0,
            collected: false,
            recentlyDied: true,
            selectedNextObjectiveId: "checkpoint",
          },
          {
            id: "checkpoint",
            done: false,
            value: 0,
            collected: false,
            recentlyDied: false,
          },
        ],
      },
    ];
    const reset = applyQuestResets(
      trackers,
      [{ type: "reset_quest", ids: ["pyramid"], info: "floor" }],
      () => false,
    );
    expect(reset?.[0]?.goals).toEqual([]);
  });
});
