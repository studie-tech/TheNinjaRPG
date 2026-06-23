import { describe, expect, it } from "vitest";
import { verifyQuestObjectiveFlow } from "@/libs/quest";
import type { AllObjectivesType } from "@/validators/objectives";

const flow = (objectives: unknown[]) =>
  verifyQuestObjectiveFlow(objectives as unknown as AllObjectivesType[]);

describe("verifyQuestObjectiveFlow — dialog branch routing", () => {
  it("rejects a dialog branch with no nextObjectiveId (terminal-branch soft-lock guard)", () => {
    // A branch with no nextObjectiveId can never complete the objective, so authoring it must fail.
    const res = flow([
      { id: "d1", task: "dialog", nextObjectiveId: [{ text: "Goodbye" }] },
    ]);
    expect(res.check).toBe(false);
    expect(res.message).toContain("nextObjectiveId");
  });

  it("rejects a dialog with a mix of routed and terminal branches", () => {
    const res = flow([
      {
        id: "d1",
        task: "dialog",
        nextObjectiveId: [
          { text: "Continue", nextObjectiveId: "o2" },
          { text: "Leave" },
        ],
      },
      { id: "o2", task: "collect_item" },
    ]);
    expect(res.check).toBe(false);
  });

  it("accepts dialog branches that all route to a next objective", () => {
    const res = flow([
      {
        id: "d1",
        task: "dialog",
        nextObjectiveId: [{ text: "Continue", nextObjectiveId: "o2" }],
      },
      { id: "o2", task: "collect_item" },
    ]);
    expect(res.check).toBe(true);
  });
});
