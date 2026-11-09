import { describe, expect, it } from "bun:test";
import { TERMINAL_DIALOG_PREFIX } from "@/drizzle/constants";
import { getNewTrackers } from "@/libs/quest";
import {
  trackerGoal as goal,
  trackerUser as makeUser,
  trackerQuest,
} from "../../setup/quest";

const makeQuest = (id: string, objectives: object[]) =>
  trackerQuest(id, objectives, "mission");

// ---------------------------------------------------------------------------
// Runtime completion of TERMINAL dialog branches (branches with no follow-up
// objective). Save-time validation blocks authoring these, but already-saved
// legacy content can contain them — the runtime must complete them via the
// objective-scoped sentinel instead of re-opening the same dialog forever.
// ---------------------------------------------------------------------------

/** Creates a dialog objective fixture with the supplied branches and optional placement binding. */
const dialogObjective = (
  id: string,
  branches: { text: string; nextObjectiveId?: string }[],
  overworldPlacementId?: string,
) => ({
  id,
  task: "dialog" as const,
  description: "",
  successDescription: "",
  image: "",
  nextObjectiveId: branches,
  overworldPlacementId,
});

/** Creates a minimal collect-item objective fixture. */
const collectObjective = (id: string) => ({
  id,
  task: "collect_item" as const,
  description: "",
  successDescription: "",
});

/** Builds the objective-scoped sentinel used to record a terminal dialog choice. */
const terminal = (objectiveId: string) => `${TERMINAL_DIALOG_PREFIX}${objectiveId}`;

describe("getNewTrackers — terminal dialog branches", () => {
  it("completes a terminal-branch dialog via the objective-scoped sentinel, without routing onward", () => {
    const quest = makeQuest("q1", [dialogObjective("d1", [{ text: "Farewell" }])]);
    const result = getNewTrackers(makeUser([quest]), [
      { task: "dialog", contentId: terminal("d1") },
    ]);

    const g = goal(result, "q1", "d1");
    expect(g?.done).toBe(true);
    // Terminal branch ends the chain here — no next objective is selected.
    expect(g?.selectedNextObjectiveId).toBeUndefined();
  });

  it("refuses the sentinel for an objective that has no terminal branch (spoof guard)", () => {
    // d1 only routes onward; a client naming it with the terminal sentinel must NOT complete it.
    const quest = makeQuest("q1", [
      dialogObjective("d1", [{ text: "Continue", nextObjectiveId: "o2" }]),
      collectObjective("o2"),
    ]);
    const result = getNewTrackers(makeUser([quest]), [
      { task: "dialog", contentId: terminal("d1") },
    ]);

    expect(goal(result, "q1", "d1")?.done).toBeFalsy();
  });

  it("scopes terminal completion to the named objective only (no sibling over-completion)", () => {
    // Two active quests, each a terminal dialog. The sentinel names d1, so d2 must stay open —
    // getNewTrackers applies the dialog update to every dialog objective across active quests.
    const q1 = makeQuest("q1", [dialogObjective("d1", [{ text: "Bye" }])]);
    const q2 = makeQuest("q2", [dialogObjective("d2", [{ text: "Bye" }])]);
    const result = getNewTrackers(makeUser([q1, q2]), [
      { task: "dialog", contentId: terminal("d1") },
    ]);

    expect(goal(result, "q1", "d1")?.done).toBe(true);
    expect(goal(result, "q2", "d2")?.done).toBeFalsy();
  });

  it("still routes a normal (non-terminal) branch to its next objective", () => {
    const quest = makeQuest("q1", [
      dialogObjective("d1", [{ text: "Continue", nextObjectiveId: "o2" }]),
      collectObjective("o2"),
    ]);
    const result = getNewTrackers(makeUser([quest]), [
      { task: "dialog", contentId: "o2" },
    ]);

    const g = goal(result, "q1", "d1");
    expect(g?.done).toBe(true);
    expect(g?.selectedNextObjectiveId).toBe("o2");
  });

  it("does not complete a placement-bound dialog without authoritative placement context", () => {
    const quest = makeQuest("q1", [
      dialogObjective("d1", [{ text: "Continue", nextObjectiveId: "o2" }], "p1"),
      collectObjective("o2"),
    ]);
    const result = getNewTrackers(makeUser([quest]), [
      { task: "dialog", contentId: "o2" },
    ]);
    expect(goal(result, "q1", "d1")?.done).toBeFalsy();
  });

  it("completes a placement-bound dialog at its authoritative placement", () => {
    const quest = makeQuest("q1", [
      dialogObjective("d1", [{ text: "Continue", nextObjectiveId: "o2" }], "p1"),
      collectObjective("o2"),
    ]);
    const result = getNewTrackers(
      makeUser([quest]),
      [{ task: "dialog", contentId: "o2" }],
      undefined,
      undefined,
      new Set(["p1"]),
    );
    expect(goal(result, "q1", "d1")?.done).toBe(true);
  });
});
