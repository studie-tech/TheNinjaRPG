import { describe, expect, it } from "vitest";
import { TERMINAL_DIALOG_PREFIX, type QuestType } from "@/drizzle/constants";
import { getNewTrackers } from "@/libs/quest";

// ---------------------------------------------------------------------------
// Runtime completion of TERMINAL dialog branches (branches with no follow-up
// objective). Save-time validation now blocks authoring these, but already-saved
// legacy content can still contain them — the runtime must complete them via the
// objective-scoped sentinel instead of re-opening the same dialog forever.
// Fixtures mirror quest_killcount.test.ts: minimal casts accepted at runtime.
// ---------------------------------------------------------------------------

const dialogObjective = (
  id: string,
  branches: { text: string; nextObjectiveId?: string }[],
) => ({
  id,
  task: "dialog" as const,
  description: "",
  successDescription: "",
  image: "",
  nextObjectiveId: branches,
});

const collectObjective = (id: string) => ({
  id,
  task: "collect_item" as const,
  description: "",
  successDescription: "",
});

type Objective =
  | ReturnType<typeof dialogObjective>
  | ReturnType<typeof collectObjective>;

const makeQuest = (id: string, objectives: Objective[]) => ({
  id,
  name: `Quest ${id}`,
  questType: "mission" as QuestType,
  hidden: false,
  consecutiveObjectives: false,
  maxAttempts: 100,
  maxCompletes: 100,
  requiredVillage: null,
  requiredBloodlineId: null,
  prerequisiteQuestId: null,
  requiredLevel: null,
  maxLevel: null,
  medicalRank: null,
  huntingRank: null,
  gatheringRank: null,
  endsAt: null,
  content: { objectives, reward: {}, sceneBackground: "", sceneCharacters: [] },
});

const makeUser = (quests: ReturnType<typeof makeQuest>[]) =>
  ({
    userId: "u1",
    level: 50,
    rank: "JONIN",
    role: "USER",
    villageId: "v1",
    isOutlaw: false,
    bloodlineId: null,
    sector: 1,
    village: { id: "v1", sector: 1 },
    activeWars: [],
    completedQuests: [],
    questData: [],
    userQuests: quests.map((q) => ({
      id: `uq-${q.id}`,
      questId: q.id,
      completed: 0,
      previousAttempts: 0,
      previousCompletes: 0,
      quest: q,
    })),
  }) as unknown as Parameters<typeof getNewTrackers>[0];

const goal = (
  result: ReturnType<typeof getNewTrackers>,
  questId: string,
  objectiveId: string,
) =>
  result.trackers.find((t) => t.id === questId)?.goals.find((g) => g.id === objectiveId);

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
});
