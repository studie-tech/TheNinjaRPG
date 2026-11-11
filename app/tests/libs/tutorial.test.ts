import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TUTORIAL_ARENA_DUMMY_ID,
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_STARTER_QUEST_ID,
  TUTORIAL_STEPS_COUNT,
} from "@/drizzle/constants";
import { WORLD_LANDMARKS } from "@/libs/sector-map/landmarks";
import {
  canPositionTutorialHighlight,
  GENIN_QUEST_OBJECTIVES,
  getStarterQuestProgress,
  getTutorialBattleReturnPage,
  getTutorialCatchUpStepIndex,
  getTutorialChapterProgress,
  getTutorialCombatGuidance,
  getTutorialHighlightedQuestId,
  getTutorialPortraitSide,
  getTutorialRewindStepIndex,
  getTutorialStepPath,
  getTutorialStrandedBattleStepId,
  getTutorialTakeQuestId,
  hasOutgrownTutorial,
  isStarterObjectiveSatisfied,
  isTutorialActive,
  isTutorialCaptureStep,
  isTutorialGuidedBattle,
  isTutorialItemBuyStep,
  isTutorialJutsuPickStep,
  isTutorialPageMatch,
  isUsableHighlightRect,
  STARTER_QUEST_OBJECTIVES,
  TUTORIAL_CAPTURE_STEP_ID,
  TUTORIAL_CAPTURE_TRAVEL_STEP_ID,
  TUTORIAL_HOME_SECTOR,
  TUTORIAL_ITEM_BUY_STEP_ID,
  TUTORIAL_JUTSU_PICK_STEP_ID,
  TUTORIAL_WAKE_TRAVEL_STEP_ID,
  TutorialTriggers,
} from "@/libs/tutorial";

/**
 * Read the step source and slice it to the array, so `id:` keys elsewhere in
 * the file cannot leak in.
 */
const readTutorialStepsSource = () => {
  const tutorialPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../src/libs/tutorialSteps.tsx",
  );
  const source = readFileSync(tutorialPath, "utf8");
  const start = source.indexOf("export const TUTORIAL_STEPS");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n];", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const stepIds = () =>
  [...readTutorialStepsSource().matchAll(/^ {4}id: "([^"]+)"/gm)].map(
    (match) => match[1],
  );

/** Source of one step object, from its id to the end of its block. */
const stepBlock = (stepId: string) => {
  const source = readTutorialStepsSource();
  const start = source.indexOf(`id: "${stepId}"`);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("\n  },", start));
};

describe("getTutorialStepPath", () => {
  it("strips in-page hashes", () => {
    expect(getTutorialStepPath("/townhall#Kage")).toBe("/townhall");
  });

  it("strips the query used to pick a profile tab", () => {
    expect(getTutorialStepPath("/profile?tab=pet")).toBe("/profile");
  });

  it("returns empty string for missing pages", () => {
    expect(getTutorialStepPath()).toBe("");
  });
});

describe("isTutorialPageMatch", () => {
  it("matches the exact pathname", () => {
    expect(isTutorialPageMatch("/profile", "/profile")).toBe(true);
  });

  it("does not treat /profile as a prefix of /profile/experience", () => {
    expect(isTutorialPageMatch("/profile/experience", "/profile")).toBe(false);
    expect(isTutorialPageMatch("/profile", "/profile/experience")).toBe(false);
  });

  it("matches hashed tab steps against the base route", () => {
    expect(isTutorialPageMatch("/blackmarket#Ryo", "/blackmarket")).toBe(true);
  });
});

describe("getTutorialBattleReturnPage", () => {
  const steps = [
    { id: "fight", page: "/combat", onCombatWin: "training", onCombatLoss: "arena" },
    { id: "training", page: "/village" },
    { id: "arena", page: "/battlearena" },
    { id: "puppy", page: "/travel", onCombatWin: "home" },
    { id: "home", page: "/travel" },
  ];
  const active = { tutorialOn: true, tutorialStep: 0, status: "AWAKE" };

  it("returns a first polled win directly to training before its step write settles", () => {
    expect(getTutorialBattleReturnPage(steps, active, "Won", "/profile")).toBe(
      "/village",
    );
  });

  it("uses the confirmed lesson when progress has already advanced", () => {
    expect(
      getTutorialBattleReturnPage(
        steps,
        { ...active, tutorialStep: 1 },
        "Won",
        "/profile",
      ),
    ).toBe("/village");
  });

  it("keeps the puppy victory on travel and a hospitalized player on healing", () => {
    expect(
      getTutorialBattleReturnPage(
        steps,
        { ...active, tutorialStep: 3 },
        "Won",
        "/profile",
      ),
    ).toBe("/travel");
    expect(
      getTutorialBattleReturnPage(
        steps,
        { ...active, status: "HOSPITALIZED" },
        "Lost",
        "/profile",
      ),
    ).toBe("/hospital");
  });

  it("preserves the chosen destination after the tutorial is disabled or finished", () => {
    expect(
      getTutorialBattleReturnPage(
        steps,
        { ...active, tutorialOn: false },
        "Won",
        "/profile",
      ),
    ).toBe("/profile");
    expect(
      getTutorialBattleReturnPage(
        steps,
        { ...active, tutorialStep: TUTORIAL_STEPS_COUNT },
        "Won",
        "/profile",
      ),
    ).toBe("/profile");
  });

  it("does not send an unresolved battle return back to combat", () => {
    expect(getTutorialBattleReturnPage(steps, active, undefined, "/profile")).toBe(
      "/profile",
    );
  });
});

describe("isTutorialJutsuPickStep", () => {
  it("identifies the jutsu-pick step by id", () => {
    expect(isTutorialJutsuPickStep({ id: TUTORIAL_JUTSU_PICK_STEP_ID })).toBe(true);
    expect(isTutorialJutsuPickStep({ id: "other" })).toBe(false);
  });
});

describe("isTutorialItemBuyStep", () => {
  it("identifies the shuriken purchase step by id", () => {
    expect(isTutorialItemBuyStep({ id: TUTORIAL_ITEM_BUY_STEP_ID })).toBe(true);
    expect(isTutorialItemBuyStep({ id: TUTORIAL_JUTSU_PICK_STEP_ID })).toBe(false);
  });
});

describe("TUTORIAL_HOME_SECTOR", () => {
  it("matches the Horizon landmark sector", () => {
    const horizon = WORLD_LANDMARKS.find((landmark) => landmark.name === "Horizon");
    expect(horizon?.sector).toBe(TUTORIAL_HOME_SECTOR);
    expect(TUTORIAL_HOME_SECTOR).not.toBe(296);
  });
});

describe("getTutorialTakeQuestId", () => {
  it("reads the quest id from a take-quest highlight", () => {
    expect(
      getTutorialTakeQuestId({
        elementIds: ["logbook-entry-abc", "tutorial-take-quest-quest-99"],
      }),
    ).toBe("quest-99");
  });
});

describe("getTutorialHighlightedQuestId", () => {
  it("prefers the take-quest button id, then the quest of a dialog or reward step", () => {
    expect(
      getTutorialHighlightedQuestId({
        advanceOn: "questDialog",
        relatedValue: "fallback",
        elementIds: ["tutorial-take-quest-exam-1"],
      }),
    ).toBe("exam-1");
    expect(
      getTutorialHighlightedQuestId({
        advanceOn: "questDialog",
        relatedValue: "quest-2",
      }),
    ).toBe("quest-2");
    expect(
      getTutorialHighlightedQuestId({
        advanceOn: "questReward",
        relatedValue: "quest-3",
      }),
    ).toBe("quest-3");
  });

  it("ignores the sector a travel step targets", () => {
    expect(
      getTutorialHighlightedQuestId({ advanceOn: "travelArrive", relatedValue: 227 }),
    ).toBeUndefined();
  });
});

describe("isTutorialActive", () => {
  it("is active for a freshly registered account", () => {
    // Schema defaults for a new UserData row
    expect(isTutorialActive({ tutorialOn: true, tutorialStep: 0 })).toBe(true);
  });

  it("is inactive once the tutorial is switched off or finished", () => {
    expect(isTutorialActive({ tutorialOn: false, tutorialStep: 0 })).toBe(false);
    expect(
      isTutorialActive({ tutorialOn: true, tutorialStep: TUTORIAL_STEPS_COUNT }),
    ).toBe(false);
  });

  it("is inactive without a user", () => {
    expect(isTutorialActive(undefined)).toBe(false);
    expect(isTutorialActive(null)).toBe(false);
  });
});

describe("isUsableHighlightRect", () => {
  it("rejects unusable highlight rects", () => {
    expect(isUsableHighlightRect({ width: 0, height: 20 })).toBe(false);
    expect(isUsableHighlightRect({ width: 40, height: 20 })).toBe(true);
  });
});

describe("tutorial highlight placement", () => {
  it("brings a desktop battlefield back into view after an action below it is selected", () => {
    expect(canPositionTutorialHighlight(608, 1000, 900)).toBe(true);
  });

  it("keeps the complete mobile sector map above the assistant when there is room", () => {
    expect(canPositionTutorialHighlight(500, 844, 635)).toBe(true);
  });

  it("leaves a map taller than the available area under the player's scroll control", () => {
    expect(canPositionTutorialHighlight(900, 1000, 800)).toBe(false);
  });
});

describe("getTutorialPortraitSide", () => {
  // The strip above a 420px dock at the bottom-left of a 1280x800 window.
  const frame = { top: 330, left: 20, width: 420, height: 180 };
  const portrait = { frame, portraitWidth: 170, inset: 16 };

  it("stands at the dock's right end when nothing is highlighted", () => {
    expect(getTutorialPortraitSide({ ...portrait, avoid: null })).toBe("right");
  });

  it("stays at the right end when the highlight is elsewhere", () => {
    const avoid = { top: 120, left: 700, width: 200, height: 40 };
    expect(getTutorialPortraitSide({ ...portrait, avoid })).toBe("right");
  });

  it("steps to the left end when the highlight is under her", () => {
    const avoid = { top: 400, left: 330, width: 90, height: 40 };
    expect(getTutorialPortraitSide({ ...portrait, avoid })).toBe("left");
  });

  it("keeps clear of the hand pointer bouncing below the highlight", () => {
    // The highlight ends 60px above the strip; the hand hangs into it.
    const avoid = { top: 230, left: 300, width: 100, height: 40 };
    expect(getTutorialPortraitSide({ ...portrait, avoid })).toBe("left");
  });

  it("leaves when the highlight spans the whole dock", () => {
    const avoid = { top: 380, left: 0, width: 600, height: 60 };
    expect(getTutorialPortraitSide({ ...portrait, avoid })).toBeNull();
  });
});

describe("TUTORIAL_STEPS", () => {
  it("highlights travel confirmation and arrival before the globe and the Global tab", () => {
    // Travel steps share one element list defined above the step array.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../src/libs/tutorialSteps.tsx"),
      "utf8",
    );
    const start = source.indexOf("const globalTravelElements = [");
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(start, source.indexOf("];", start));
    // Once the travel modal opens its proceed button must win the highlight;
    // the always-mounted globe would otherwise keep it for the whole step.
    expect(block.indexOf("tutorial-global-travel-proceed")).toBeLessThan(
      block.indexOf("tutorial-travel-arrival"),
    );
    expect(block.indexOf("tutorial-travel-arrival")).toBeLessThan(
      block.indexOf("tutorial-global-map"),
    );
    expect(block.indexOf("tutorial-global-map")).toBeLessThan(
      block.indexOf("tutorial-Global"),
    );
    expect(
      readTutorialStepsSource().match(/elementIds: globalTravelElements/g),
    ).toHaveLength(2);
  });

  it("uses unique ids so findIndex cannot jump to an earlier step", () => {
    const ids = stepIds();
    expect(ids.length).toBe(TUTORIAL_STEPS_COUNT);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it("keeps the pinned-step constants pointing at real steps", () => {
    const ids = stepIds();
    for (const id of [
      TUTORIAL_JUTSU_PICK_STEP_ID,
      TUTORIAL_ITEM_BUY_STEP_ID,
      TUTORIAL_CAPTURE_TRAVEL_STEP_ID,
      TUTORIAL_CAPTURE_STEP_ID,
      TUTORIAL_WAKE_TRAVEL_STEP_ID,
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("travels to the pup and walks up to it in consecutive steps", () => {
    const ids = stepIds();
    expect(ids.indexOf(TUTORIAL_CAPTURE_STEP_ID)).toBe(
      ids.indexOf(TUTORIAL_CAPTURE_TRAVEL_STEP_ID) + 1,
    );
  });

  it("routes every battle outcome to a step that exists", () => {
    const ids = stepIds();
    const targets = [
      ...readTutorialStepsSource().matchAll(/onCombat(?:Win|Loss): "([^"]+)"/g),
    ].map((match) => match[1]);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(ids).toContain(target);
  });

  it("only waits for game actions that a page reports", () => {
    const triggers = [
      ...readTutorialStepsSource().matchAll(/advanceOn: "([^"]+)"/g),
    ].map((match) => match[1] ?? "");
    for (const trigger of triggers) {
      expect(TutorialTriggers as readonly string[]).toContain(trigger);
    }
  });

  it("ties quest dialog and reward steps to the quest objective they wait for", () => {
    const source = readTutorialStepsSource();
    const questSteps = stepIds().filter((id) => {
      const block = stepBlock(id ?? "");
      return /advanceOn: "quest(?:Dialog|Reward)"/.test(block);
    });
    expect(questSteps.length).toBeGreaterThan(0);
    for (const id of questSteps) {
      const block = stepBlock(id ?? "");
      const isGeninStep = block.includes("relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID");
      expect(block).toContain(
        isGeninStep
          ? "relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID"
          : "relatedValue: TUTORIAL_STARTER_QUEST_ID",
      );
      expect(block).toContain(
        isGeninStep
          ? "objectiveId: GENIN_QUEST_OBJECTIVES."
          : "objectiveId: STARTER_QUEST_OBJECTIVES.",
      );
    }
    expect(source).not.toContain("hideDialog");
  });

  it("sends the exam's travel steps to the quest's own location", () => {
    for (const stepId of ["exam-walk", "exam-report"]) {
      const block = stepBlock(stepId);
      expect(block).toContain("relatedValue: TUTORIAL_GENIN_EXAM_QUEST_ID");
      expect(block).toContain("objectiveId: GENIN_QUEST_OBJECTIVES.");
      expect(block).toContain("autoTravelLabel:");
    }
  });

  it("gives every single-action step a way forward", () => {
    // A step that waits for a purchase or training can fail for reasons the
    // lesson does not cover (no ryo, a full slot), so it carries Next as well.
    for (const stepId of [
      TUTORIAL_ITEM_BUY_STEP_ID,
      "tools-train-stat",
      "tools-buy-ramen",
      "bond-adopt",
      "exam-farewell",
    ]) {
      expect(stepBlock(stepId)).toContain("showNextButton: true");
    }
  });

  it("has no Next past Sonic Slash, which the starter quest cannot go on without", () => {
    expect(stepBlock(TUTORIAL_JUTSU_PICK_STEP_ID)).not.toContain("showNextButton");
    expect(stepBlock(TUTORIAL_JUTSU_PICK_STEP_ID)).toContain(
      "objectiveId: STARTER_QUEST_OBJECTIVES.jutsu",
    );
    expect(stepBlock("tools-claim-jutsu")).toContain(
      "objectiveStepId: TUTORIAL_JUTSU_PICK_STEP_ID",
    );
  });

  it("never sends a player to a page outside the game shell", () => {
    const pages = [...readTutorialStepsSource().matchAll(/page: "([^"]+)"/g)].map(
      (match) => match[1] ?? "",
    );
    for (const page of pages) expect(page.startsWith("/")).toBe(true);
  });
});

describe("isTutorialCaptureStep", () => {
  it("identifies the walk up to the pup", () => {
    expect(isTutorialCaptureStep({ id: TUTORIAL_CAPTURE_STEP_ID })).toBe(true);
    expect(isTutorialCaptureStep({ id: TUTORIAL_CAPTURE_TRAVEL_STEP_ID })).toBe(false);
  });
});

describe("isTutorialGuidedBattle", () => {
  const learner = { tutorialOn: true, tutorialStep: 4 };

  it("guides the arena dummy and starter quest fights while the tutorial runs", () => {
    expect(
      isTutorialGuidedBattle(learner, { opponentIds: [TUTORIAL_ARENA_DUMMY_ID] }),
    ).toBe(true);
    expect(
      isTutorialGuidedBattle(learner, { questId: TUTORIAL_STARTER_QUEST_ID }),
    ).toBe(true);
  });

  it("leaves other fights, and players past the tutorial, on their own preference", () => {
    expect(isTutorialGuidedBattle(learner, { opponentIds: ["someone"] })).toBe(false);
    expect(isTutorialGuidedBattle(learner, { questId: "another-quest" })).toBe(false);
    expect(
      isTutorialGuidedBattle(
        { tutorialOn: false, tutorialStep: 4 },
        { opponentIds: [TUTORIAL_ARENA_DUMMY_ID] },
      ),
    ).toBe(false);
    expect(
      isTutorialGuidedBattle(
        { tutorialOn: true, tutorialStep: TUTORIAL_STEPS_COUNT },
        { questId: TUTORIAL_STARTER_QUEST_ID },
      ),
    ).toBe(false);
  });
});

describe("getTutorialChapterProgress", () => {
  const steps = [
    { chapter: "a" },
    { chapter: "a" },
    { chapter: "b" },
    { chapter: "b" },
    { chapter: "b" },
  ];

  it("counts the position within the current chapter", () => {
    expect(getTutorialChapterProgress(steps, 0)).toEqual({
      chapter: "a",
      position: 1,
      total: 2,
    });
    expect(getTutorialChapterProgress(steps, 4)).toEqual({
      chapter: "b",
      position: 3,
      total: 3,
    });
  });

  it("has no progress past the last step", () => {
    expect(getTutorialChapterProgress(steps, 5)).toBeUndefined();
  });
});

describe("starter quest progress", () => {
  const O = STARTER_QUEST_OBJECTIVES;
  const activeQuest = { questId: TUTORIAL_STARTER_QUEST_ID, completed: 0, endAt: null };
  const user = (
    goals: {
      id: string;
      done?: boolean;
      collected?: boolean;
      selectedNextObjectiveId?: string;
    }[],
  ) => ({
    userQuests: [activeQuest],
    questData: [{ id: TUTORIAL_STARTER_QUEST_ID, goals }],
  });

  it("follows the chain to the first objective that is not done", () => {
    const progress = getStarterQuestProgress(
      user([
        { id: O.accept, done: true, selectedNextObjectiveId: O.arena },
        { id: O.arena, done: true, collected: true, selectedNextObjectiveId: O.jutsu },
        { id: O.jutsu },
      ]),
    );
    expect(progress).toMatchObject({ finished: false, activeIndex: 2 });
  });

  it("places a player by the path their tracker took, not the current chain", () => {
    // The previous chain went straight from the opening dialog to the pup.
    const progress = getStarterQuestProgress(
      user([
        { id: O.accept, done: true, selectedNextObjectiveId: O.pup },
        { id: O.pup },
      ]),
    );
    if (!progress) throw new Error("expected progress");
    expect(progress.activeIndex).toBe(4);
    expect(isStarterObjectiveSatisfied(O.arena, progress, true)).toBe(true);
    expect(isStarterObjectiveSatisfied(O.brief, progress)).toBe(true);
    expect(isStarterObjectiveSatisfied(O.pup, progress)).toBe(false);
  });

  it("waits for a completed objective's reward to be claimed on reward steps", () => {
    const progress = getStarterQuestProgress(
      user([
        { id: O.accept, done: true, selectedNextObjectiveId: O.arena },
        { id: O.arena, done: true, selectedNextObjectiveId: O.jutsu },
      ]),
    );
    if (!progress) throw new Error("expected progress");
    expect(isStarterObjectiveSatisfied(O.arena, progress)).toBe(true);
    expect(isStarterObjectiveSatisfied(O.arena, progress, true)).toBe(false);
  });

  it("reports a finished quest, and nothing while quest data is loading", () => {
    expect(getStarterQuestProgress({ userQuests: [], questData: [] })).toMatchObject({
      finished: true,
    });
    expect(getStarterQuestProgress({})).toBeUndefined();
    expect(getStarterQuestProgress({ userQuests: [activeQuest], questData: [] })).toBe(
      undefined,
    );
  });
});

describe("hasOutgrownTutorial", () => {
  const graduate = { tutorialOn: true, tutorialStep: 0, rank: "GENIN", userQuests: [] };
  const exam = { questId: TUTORIAL_GENIN_EXAM_QUEST_ID, endAt: null, completed: 0 };

  it("is true for a running tutorial whose player already graduated", () => {
    expect(hasOutgrownTutorial(graduate)).toBe(true);
  });

  it("waits for the exam quest and for quest data", () => {
    expect(hasOutgrownTutorial({ ...graduate, rank: "STUDENT" })).toBe(false);
    expect(hasOutgrownTutorial({ ...graduate, userQuests: [exam] })).toBe(false);
    expect(hasOutgrownTutorial({ ...graduate, userQuests: undefined })).toBe(false);
  });

  it("leaves a finished or switched-off tutorial alone", () => {
    expect(hasOutgrownTutorial({ ...graduate, tutorialOn: false })).toBe(false);
    expect(
      hasOutgrownTutorial({ ...graduate, tutorialStep: TUTORIAL_STEPS_COUNT }),
    ).toBe(false);
  });
});

describe("getTutorialRewindStepIndex", () => {
  const O = STARTER_QUEST_OBJECTIVES;
  const steps = [
    { id: "pick", objectiveId: O.jutsu },
    { id: "claim", objectiveId: O.jutsu, objectiveStepId: "pick" },
    { id: "after" },
  ];
  const activeQuest = { questId: TUTORIAL_STARTER_QUEST_ID, completed: 0, endAt: null };
  const withGoals = (goals: object[]) => ({
    userQuests: [activeQuest],
    questData: [{ id: TUTORIAL_STARTER_QUEST_ID, goals }] as never,
  });
  const reachedJutsu = [
    { id: O.accept, done: true, selectedNextObjectiveId: O.arena },
    { id: O.arena, done: true, collected: true, selectedNextObjectiveId: O.jutsu },
  ];

  it("sends a player who skipped the lesson back from the empty claim step", () => {
    const user = withGoals([
      ...reachedJutsu,
      { id: O.jutsu, done: false, value: 0, selectedNextObjectiveId: O.brief },
    ]);
    expect(getTutorialRewindStepIndex(steps, 1, user)).toBe(0);
    expect(getTutorialCatchUpStepIndex(steps, 1, user)).toBeUndefined();
  });

  it("stays on the claim step once there is something to claim", () => {
    const user = withGoals([...reachedJutsu, { id: O.jutsu, done: true }]);
    expect(getTutorialRewindStepIndex(steps, 1, user)).toBeUndefined();
  });

  it("does not bounce a player the quest has not brought this far", () => {
    const user = withGoals([{ id: O.accept, done: true }, { id: O.arena }]);
    expect(getTutorialRewindStepIndex(steps, 1, user)).toBeUndefined();
  });

  it("leaves steps without a lesson to return to, and finished quests, alone", () => {
    const user = withGoals([...reachedJutsu, { id: O.jutsu, done: false }]);
    expect(getTutorialRewindStepIndex(steps, 0, user)).toBeUndefined();
    expect(getTutorialRewindStepIndex(steps, 2, user)).toBeUndefined();
    expect(
      getTutorialRewindStepIndex(steps, 1, { userQuests: [], questData: [] }),
    ).toBeUndefined();
    expect(getTutorialRewindStepIndex(steps, 1, {})).toBeUndefined();
  });
});

describe("getTutorialCatchUpStepIndex", () => {
  const O = STARTER_QUEST_OBJECTIVES;
  const steps = [
    { objectiveId: O.accept, advanceOn: "questDialog" as const },
    {},
    { objectiveId: O.arena, advanceOn: "questReward" as const },
    { objectiveId: O.pup, advanceOn: "travelArrive" as const },
    { objectiveId: O.pup },
    { objectiveId: O.pup, advanceOn: "questReward" as const },
    {},
  ];
  const activeQuest = { questId: TUTORIAL_STARTER_QUEST_ID, completed: 0, endAt: null };

  it("stays on a step whose objective is still ahead", () => {
    const user = {
      userQuests: [activeQuest],
      questData: [{ id: TUTORIAL_STARTER_QUEST_ID, goals: [{ id: O.accept }] }],
    };
    expect(getTutorialCatchUpStepIndex(steps, 0, user)).toBeUndefined();
    expect(getTutorialCatchUpStepIndex(steps, 1, user)).toBeUndefined();
  });

  it("skips every consecutive step the quest is already past", () => {
    const user = {
      userQuests: [activeQuest],
      questData: [
        {
          id: TUTORIAL_STARTER_QUEST_ID,
          goals: [
            { id: O.accept, done: true, selectedNextObjectiveId: O.pup },
            { id: O.pup, done: true, selectedNextObjectiveId: O.sanctuary },
          ],
        },
      ],
    };
    // The pup is beaten but its reward is unclaimed: land on the claim step.
    expect(getTutorialCatchUpStepIndex(steps, 3, user)).toBe(5);
  });

  it("skips a claimed reward step", () => {
    const user = {
      userQuests: [activeQuest],
      questData: [
        {
          id: TUTORIAL_STARTER_QUEST_ID,
          goals: [
            { id: O.accept, done: true, selectedNextObjectiveId: O.arena },
            {
              id: O.arena,
              done: true,
              collected: true,
              selectedNextObjectiveId: O.jutsu,
            },
          ],
        },
      ],
    };
    expect(getTutorialCatchUpStepIndex(steps, 2, user)).toBe(3);
  });

  it("runs past every quest step once the quest is finished", () => {
    const user = { userQuests: [], questData: [] };
    expect(getTutorialCatchUpStepIndex(steps, 3, user)).toBe(6);
  });

  describe("from the opening lessons", () => {
    // Same shape as TUTORIAL_STEPS: lessons without an objective lead up to each one.
    const lessons = [
      {}, // 0: welcome
      {}, // 1: open the village
      { objectiveId: O.accept, advanceOn: "questDialog" as const }, // 2
      {}, // 3: enter the arena
      {}, // 4: fight
      { objectiveId: O.arena, advanceOn: "questReward" as const }, // 5
      {}, // 6: assign experience
      { objectiveId: O.jutsu, advanceOn: "trainJutsu" as const }, // 7
      { objectiveId: O.jutsu, advanceOn: "questReward" as const }, // 8
      {}, // 9: buy a tool
    ];
    const withGoals = (
      goals: { id: string; done?: boolean; collected?: boolean }[],
    ) => ({
      userQuests: [activeQuest],
      questData: [{ id: TUTORIAL_STARTER_QUEST_ID, goals }],
    });
    const accepted = { id: O.accept, done: true, collected: true };

    it("keeps a new player at the welcome until the trials are accepted", () => {
      const user = withGoals([{ id: O.accept }, { id: O.arena }]);
      expect(getTutorialCatchUpStepIndex(lessons, 0, user)).toBeUndefined();
    });

    it("moves a player who accepted the trials on to the arena lesson", () => {
      const user = withGoals([accepted, { id: O.arena }]);
      expect(getTutorialCatchUpStepIndex(lessons, 0, user)).toBe(3);
    });

    it("lands on the claim step when the fight was won but not claimed", () => {
      const user = withGoals([accepted, { id: O.arena, done: true }, { id: O.jutsu }]);
      expect(getTutorialCatchUpStepIndex(lessons, 0, user)).toBe(5);
    });

    it("lands on the lesson after the last objective they finished", () => {
      const user = withGoals([
        accepted,
        { id: O.arena, done: true, collected: true },
        { id: O.jutsu },
      ]);
      expect(getTutorialCatchUpStepIndex(lessons, 0, user)).toBe(6);
      expect(getTutorialCatchUpStepIndex(lessons, 1, user)).toBe(6);
    });

    it("does not skip lessons for a player who is already past the opening", () => {
      const user = withGoals([
        accepted,
        { id: O.arena, done: true, collected: true },
        { id: O.jutsu, done: true, collected: true },
      ]);
      expect(getTutorialCatchUpStepIndex(lessons, 3, user)).toBeUndefined();
      expect(getTutorialCatchUpStepIndex(lessons, 6, user)).toBeUndefined();
      expect(getTutorialCatchUpStepIndex(lessons, 9, user)).toBeUndefined();
    });

    it("runs to the last lesson once the quest is finished", () => {
      const user = { userQuests: [], questData: [] };
      expect(getTutorialCatchUpStepIndex(lessons, 0, user)).toBe(9);
    });
  });
});

describe("getTutorialCombatGuidance", () => {
  const options = (overrides: Partial<Record<string, boolean>> = {}) => [
    {
      id: "basicAttack",
      name: "Basic Attack",
      type: "basic" as const,
      range: 1,
      isUsable: overrides.basicAttack ?? true,
    },
    {
      id: "move",
      name: "Move",
      type: "basic" as const,
      range: 1,
      isUsable: overrides.move ?? true,
    },
    {
      id: "meditate",
      name: "Meditate",
      type: "basic" as const,
      range: 0,
      isUsable: true,
    },
    { id: "wait", name: "End Turn", type: "basic" as const, range: 0, isUsable: true },
    {
      id: "slash",
      name: "Sonic Slash",
      type: "jutsu" as const,
      range: 3,
      isUsable: overrides.slash ?? true,
    },
    {
      id: "shuriken",
      name: "Shuriken",
      type: "item" as const,
      range: 4,
      isUsable: overrides.shuriken ?? true,
    },
  ];

  it("waits while it is the opponent's turn", () => {
    expect(
      getTutorialCombatGuidance({
        isPlayersTurn: false,
        distanceToEnemy: 3,
        options: options(),
      }),
    ).toEqual({ kind: "wait" });
  });

  it("walks closer when nothing reaches the opponent", () => {
    expect(
      getTutorialCombatGuidance({
        isPlayersTurn: true,
        distanceToEnemy: 6,
        options: options(),
      }),
    ).toMatchObject({ kind: "select", actionId: "move", reason: "move" });
  });

  it("prefers the jutsu, then thrown tools, then the basic attack", () => {
    expect(
      getTutorialCombatGuidance({
        isPlayersTurn: true,
        distanceToEnemy: 2,
        options: options(),
      }),
    ).toMatchObject({ actionId: "slash", reason: "attack" });
    expect(
      getTutorialCombatGuidance({
        isPlayersTurn: true,
        distanceToEnemy: 4,
        options: options(),
      }),
    ).toMatchObject({ actionId: "shuriken" });
    expect(
      getTutorialCombatGuidance({
        isPlayersTurn: true,
        distanceToEnemy: 1,
        options: options({ slash: false, shuriken: false }),
      }),
    ).toMatchObject({ actionId: "basicAttack" });
  });

  it("asks for a target once the right action is selected", () => {
    expect(
      getTutorialCombatGuidance({
        isPlayersTurn: true,
        distanceToEnemy: 1,
        selectedActionId: "basicAttack",
        options: options(),
      }),
    ).toMatchObject({ kind: "target", actionId: "basicAttack", reason: "attack" });
  });

  it("ends the turn when nothing useful is affordable", () => {
    expect(
      getTutorialCombatGuidance({
        isPlayersTurn: true,
        distanceToEnemy: 1,
        options: options({
          basicAttack: false,
          slash: false,
          shuriken: false,
          move: false,
        }),
      }),
    ).toMatchObject({ kind: "select", actionId: "wait", reason: "end" });
    expect(
      getTutorialCombatGuidance({
        isPlayersTurn: true,
        distanceToEnemy: 1,
        selectedActionId: "wait",
        options: options({
          basicAttack: false,
          slash: false,
          shuriken: false,
          move: false,
        }),
      }),
    ).toMatchObject({ kind: "target", actionId: "wait", reason: "end" });
  });
});

describe("getTutorialCatchUpStepIndex on Road to Genin", () => {
  const G = GENIN_QUEST_OBJECTIVES;
  const steps = [
    { objectiveId: G.exam },
    { objectiveId: G.tour, advanceOn: "questDialog" as const },
    { objectiveId: G.choose, advanceOn: "questDialog" as const },
    { objectiveId: G.join, advanceOn: "questDialog" as const },
    { objectiveId: G.report },
    { objectiveId: G.win, advanceOn: "questReward" as const },
    {},
  ];
  const activeQuest = {
    questId: TUTORIAL_GENIN_EXAM_QUEST_ID,
    completed: 0,
    endAt: null,
  };
  const withGoals = (goals: { id: string; done?: boolean; collected?: boolean }[]) => ({
    rank: "STUDENT",
    userQuests: [activeQuest],
    questData: [{ id: TUTORIAL_GENIN_EXAM_QUEST_ID, goals }],
  });

  it("waits at the exam marker until the player walks there", () => {
    expect(
      getTutorialCatchUpStepIndex(steps, 0, withGoals([{ id: G.exam }])),
    ).toBeUndefined();
  });

  it("counts whichever village the player chose", () => {
    const user = withGoals([
      { id: G.exam, done: true },
      { id: G.tour, done: true },
      { id: G.choose, done: true },
      { id: "xAiqy", done: true },
    ]);
    expect(getTutorialCatchUpStepIndex(steps, 0, user)).toBe(4);
  });

  it("holds the claim step until the quest is claimed, though winning collects itself", () => {
    const user = withGoals([
      { id: "lhFP_", done: true },
      { id: G.win, done: true, collected: true },
    ]);
    expect(getTutorialCatchUpStepIndex(steps, 4, user)).toBe(5);
    expect(getTutorialCatchUpStepIndex(steps, 5, user)).toBeUndefined();
  });

  it("treats a Genin who no longer has the quest as finished with it", () => {
    const user = { rank: "GENIN", userQuests: [], questData: [] };
    expect(getTutorialCatchUpStepIndex(steps, 0, user)).toBe(6);
  });

  it("does not skip ahead for a student who has not started the quest", () => {
    const user = { rank: "STUDENT", userQuests: [], questData: [] };
    expect(getTutorialCatchUpStepIndex(steps, 0, user)).toBeUndefined();
  });
});

describe("getTutorialStrandedBattleStepId", () => {
  const O = STARTER_QUEST_OBJECTIVES;
  const activeQuest = { questId: TUTORIAL_STARTER_QUEST_ID, completed: 0, endAt: null };
  // Same shape as the combat chapter and the pup fight in TUTORIAL_STEPS.
  const outcomes = {
    onCombatWin: "combat-claim-reward",
    onCombatLoss: "combat-enter-arena",
  };
  const steps = [
    { id: "combat-arena-building", page: "/village" },
    { id: "combat-enter-arena", page: "/battlearena" },
    { id: "combat-battlefield", page: "/combat", ...outcomes },
    { id: "combat-turns", page: "/combat", ...outcomes },
    { id: "combat-fight", page: "/combat", ...outcomes },
    { id: "combat-claim-reward", page: "/profile", objectiveId: O.arena },
    {
      id: TUTORIAL_CAPTURE_STEP_ID,
      page: "/travel",
      objectiveId: O.pup,
      onCombatWin: "mission-claim-pup",
      onCombatLoss: TUTORIAL_CAPTURE_TRAVEL_STEP_ID,
    },
    { id: "mission-claim-pup", page: "/travel", objectiveId: O.pup },
  ];
  const battleIndex = 4;
  const awake = (goals: { id: string; done?: boolean; collected?: boolean }[]) => ({
    status: "AWAKE",
    battleId: null,
    userQuests: [activeQuest],
    questData: [{ id: TUTORIAL_STARTER_QUEST_ID, goals }],
  });
  const accepted = { id: O.accept, done: true, collected: true };

  it("sends a player whose fight ended elsewhere back to the arena", () => {
    for (const index of [2, 3, 4]) {
      expect(
        getTutorialStrandedBattleStepId(
          steps,
          index,
          awake([accepted, { id: O.arena }]),
          "/profile",
        ),
      ).toBe("combat-enter-arena");
    }
  });

  it("moves on to the reward when the arena fight was won while away", () => {
    expect(
      getTutorialStrandedBattleStepId(
        steps,
        battleIndex,
        awake([accepted, { id: O.arena, done: true }]),
        "/village",
      ),
    ).toBe("combat-claim-reward");
  });

  it("leaves a running fight, the battle page and the hospital alone", () => {
    const user = awake([accepted, { id: O.arena }]);
    const inBattle = { ...user, status: "BATTLE", battleId: "battle-1" };
    expect(
      getTutorialStrandedBattleStepId(steps, battleIndex, inBattle, "/profile"),
    ).toBeUndefined();
    expect(
      getTutorialStrandedBattleStepId(steps, battleIndex, user, "/combat"),
    ).toBeUndefined();
    const hospitalized = { ...user, status: "HOSPITALIZED" };
    expect(
      getTutorialStrandedBattleStepId(steps, battleIndex, hospitalized, "/hospital"),
    ).toBeUndefined();
  });

  it("treats a stale battle status without a battle as over", () => {
    const user = { ...awake([accepted, { id: O.arena }]), status: "BATTLE" };
    expect(getTutorialStrandedBattleStepId(steps, battleIndex, user, "/profile")).toBe(
      "combat-enter-arena",
    );
  });

  it("waits for user and quest data", () => {
    expect(
      getTutorialStrandedBattleStepId(steps, battleIndex, undefined, "/profile"),
    ).toBeUndefined();
    const loading = { status: "AWAKE", battleId: null, userQuests: null };
    expect(
      getTutorialStrandedBattleStepId(steps, battleIndex, loading, "/profile"),
    ).toBeUndefined();
  });

  it("only applies to lessons that live on the battle page", () => {
    const user = awake([accepted, { id: O.arena }]);
    // The walk to the pup fights on the travel map; being away from /combat is normal there.
    const pupIndex = 6;
    expect(
      getTutorialStrandedBattleStepId(steps, pupIndex, user, "/travel"),
    ).toBeUndefined();
    expect(getTutorialStrandedBattleStepId(steps, 0, user, "/village")).toBeUndefined();
  });
});
