import { describe, expect, it } from "vitest";
import {
  verifyDialogBranches,
  verifyQuestContentForSave,
  verifyQuestObjectiveFlow,
} from "@/libs/quest";
import type { AllObjectivesType } from "@/validators/objectives";

/** Narrows compact objective fixtures to the validator's full objective type. */
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

describe("verifyQuestContentForSave — overworld multi-bound guard", () => {
  // A placement-bound objective completes when the player stands on its NPC, so two objectives bound
  // to different NPCs on a non-consecutive quest can be completed out of order — the author must make
  // the quest consecutive so the ordering is expressed in the chain.
  const twoBoundDifferent = objs([
    { id: "a", task: "defeat_opponents", overworldPlacementId: "p1" },
    { id: "b", task: "deliver_item", overworldPlacementId: "p2" },
  ]);
  const twoBoundSame = objs([
    { id: "a", task: "defeat_opponents", overworldPlacementId: "p1" },
    { id: "b", task: "deliver_item", overworldPlacementId: "p1" },
  ]);
  const oneBound = objs([
    { id: "a", task: "deliver_item", overworldPlacementId: "p1" },
    { id: "b", task: "collect_item" },
  ]);
  const twoBoundConsecutive = objs([
    { id: "a", task: "defeat_opponents", overworldPlacementId: "p1", nextObjectiveId: "b" },
    { id: "b", task: "deliver_item", overworldPlacementId: "p2" },
  ]);
  const emptyPlacement = objs([
    { id: "a", task: "deliver_item", overworldPlacementId: "" },
    { id: "b", task: "deliver_item", overworldPlacementId: "p1" },
  ]);

  it("rejects two objectives bound to different placements when non-consecutive", () => {
    expect(verifyQuestContentForSave(twoBoundDifferent, false).check).toBe(false);
  });

  it("rejects two objectives bound to the same placement when non-consecutive", () => {
    expect(verifyQuestContentForSave(twoBoundSame, false).check).toBe(false);
  });

  it("allows a single bound objective on a non-consecutive quest", () => {
    expect(verifyQuestContentForSave(oneBound, false).check).toBe(true);
  });

  it("allows multiple bound objectives on a consecutive quest (order is in the chain)", () => {
    expect(verifyQuestContentForSave(twoBoundConsecutive, true).check).toBe(true);
  });

  it("does not count an empty-string placement as bound", () => {
    expect(verifyQuestContentForSave(emptyPlacement, false).check).toBe(true);
  });

  it("rejects an unsupported task carrying the shared placement field", () => {
    const unsupported = objs([
      { id: "a", task: "pvp_kills", overworldPlacementId: "p1" },
    ]);
    expect(verifyQuestContentForSave(unsupported, false).check).toBe(false);
  });
});
