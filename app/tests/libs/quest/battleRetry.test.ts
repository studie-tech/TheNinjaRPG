import { describe, expect, it } from "bun:test";
import { canRetryQuestBattle } from "@/libs/objectives";
import { getNewTrackers } from "@/libs/quest";
import { trackerQuest, trackerUser } from "../../setup/quest";

// ---------------------------------------------------------------------------
// The "Retry Battle" button on a start_battle objective must only be offered while
// the lost battle is still the open objective. A loss that routes to a
// failObjectiveId branch completes the objective, so retrying it would only
// advance the quest into its fail branch.
// ---------------------------------------------------------------------------

const AI_ID = "ai-1";

/** A start_battle objective against one AI, optionally routing losses to `failId`. */
const battleObjective = (failId?: string) =>
  ({
    id: "battle",
    task: "start_battle" as const,
    description: "",
    successDescription: "",
    completionOutcome: "Win",
    opponentAIs: [{ ids: [AI_ID], number: 1, quantity: 1 }],
    nextObjectiveId: "won",
    ...(failId ? { failObjectiveId: failId } : {}),
  }) as unknown;

/** A terminal objective of the given task. */
const terminalObjective = (id: string, task: "win_quest" | "fail_quest") =>
  ({ id, task, description: "", successDescription: "" }) as unknown;

/** Minimal consecutive quest containing the supplied objectives. */
const makeQuest = (objectives: unknown[]) =>
  trackerQuest("q1", objectives as object[], "story", {
    consecutiveObjectives: true,
    maxAttempts: 1,
    maxCompletes: 1,
  });

/** User parked on the battle objective of `quest`. */
const makeUser = (quest: ReturnType<typeof makeQuest>) =>
  trackerUser(
    [{ quest, previousAttempts: 1 }],
    [{ id: quest.id, startAt: new Date(), goals: [{ id: "battle", done: false }] }],
  );

/** Battle goal after the player lost against the quest AI. */
const goalAfterLoss = (quest: ReturnType<typeof makeQuest>) =>
  getNewTrackers(makeUser(quest), [
    { task: "start_battle", text: "Lost", contentId: AI_ID },
  ])
    .trackers.find((t) => t.id === quest.id)
    ?.goals.find((g) => g.id === "battle");

describe("canRetryQuestBattle", () => {
  it("allows a retry only for a lost objective that is still open", () => {
    expect(canRetryQuestBattle({ recentlyDied: true, done: false })).toBe(true);
    expect(canRetryQuestBattle({ recentlyDied: true, done: true })).toBe(false);
    expect(canRetryQuestBattle({ recentlyDied: false, done: false })).toBe(false);
    expect(canRetryQuestBattle(undefined)).toBe(false);
  });
});

describe("start_battle loss and retry eligibility", () => {
  it("keeps the battle retryable when a loss has no fail branch", () => {
    const quest = makeQuest([battleObjective(), terminalObjective("won", "win_quest")]);
    const goal = goalAfterLoss(quest);

    expect(goal?.recentlyDied).toBe(true);
    expect(goal?.done).toBeFalsy();
    expect(canRetryQuestBattle(goal)).toBe(true);
  });

  it("does not offer a retry once a loss routed the quest into its fail branch", () => {
    const quest = makeQuest([
      battleObjective("lost"),
      terminalObjective("won", "win_quest"),
      terminalObjective("lost", "fail_quest"),
    ]);
    const goal = goalAfterLoss(quest);

    expect(goal?.done).toBe(true);
    expect(goal?.selectedNextObjectiveId).toBe("lost");
    expect(canRetryQuestBattle(goal)).toBe(false);
  });
});
