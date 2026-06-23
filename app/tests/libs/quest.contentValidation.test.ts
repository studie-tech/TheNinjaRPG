import { describe, expect, it } from "vitest";
import {
  verifyDialogBranches,
  verifyQuestContentForSave,
  verifyQuestObjectiveFlow,
} from "@/libs/quest";
import type { AllObjectivesType } from "@/validators/objectives";

const objs = (o: unknown[]) => o as unknown as AllObjectivesType[];

// A dialog branch with no nextObjectiveId can never advance the objective, so it
// soft-locks the player (the overworld dialog handler re-shows the same dialog).
const terminalDialog = objs([
  { id: "d1", task: "dialog", nextObjectiveId: [{ text: "Goodbye" }] },
]);
const routedDialog = objs([
  { id: "d1", task: "dialog", nextObjectiveId: [{ text: "Continue", nextObjectiveId: "o2" }] },
  { id: "o2", task: "collect_item" },
]);
// Two independent objectives = two "starting" objectives: a legitimate shape for a
// NON-consecutive quest, but one verifyQuestObjectiveFlow rejects.
const parallelNonDialog = objs([
  { id: "a", task: "collect_item" },
  { id: "b", task: "collect_item" },
]);

describe("verifyDialogBranches", () => {
  it("rejects a dialog branch with no nextObjectiveId", () => {
    expect(verifyDialogBranches(terminalDialog).check).toBe(false);
  });

  it("rejects a dialog objective with no branches", () => {
    expect(
      verifyDialogBranches(objs([{ id: "d1", task: "dialog", nextObjectiveId: [] }])).check,
    ).toBe(false);
  });

  it("accepts dialog branches that all route to a next objective", () => {
    expect(verifyDialogBranches(routedDialog).check).toBe(true);
  });

  it("rejects a dialog branch routing to a non-existent objective id", () => {
    const dangling = objs([
      { id: "d1", task: "dialog", nextObjectiveId: [{ text: "Continue", nextObjectiveId: "ghost" }] },
    ]);
    expect(verifyDialogBranches(dangling).check).toBe(false);
  });

  it("is vacuously satisfied when there are no dialog objectives", () => {
    expect(verifyDialogBranches(parallelNonDialog).check).toBe(true);
  });
});

describe("verifyQuestContentForSave", () => {
  it("rejects a terminal dialog branch even when the quest is NOT consecutive (the gating-bypass fix)", () => {
    expect(verifyQuestContentForSave(terminalDialog, false).check).toBe(false);
  });

  it("rejects a terminal dialog branch when the quest IS consecutive", () => {
    expect(verifyQuestContentForSave(terminalDialog, true).check).toBe(false);
  });

  it("accepts a valid routed dialog in a non-consecutive quest", () => {
    expect(verifyQuestContentForSave(routedDialog, false).check).toBe(true);
  });

  it("does NOT apply chain/reachability validation to non-consecutive quests", () => {
    // Sanity: the flow validator WOULD reject parallel objectives...
    expect(verifyQuestObjectiveFlow(parallelNonDialog).check).toBe(false);
    // ...but a non-consecutive quest legitimately has them, so save-validation allows it.
    expect(verifyQuestContentForSave(parallelNonDialog, false).check).toBe(true);
  });

  it("applies chain/reachability validation to consecutive quests", () => {
    expect(verifyQuestContentForSave(parallelNonDialog, true).check).toBe(false);
  });
});
