import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { TUTORIAL_STARTER_QUEST_ID, TUTORIAL_STEPS_COUNT } from "@/drizzle/constants";
import { WORLD_LANDMARKS } from "@/libs/sector-map/landmarks";
import {
  canPositionTutorialHighlight,
  getStarterQuestCatchUpStepId,
  getTutorialBattleReturnPage,
  getTutorialHighlightedQuestId,
  getTutorialStepPath,
  getTutorialTakeQuestId,
  isTutorialItemBuyStep,
  isTutorialJutsuPickStep,
  isTutorialPageMatch,
  isTutorialActive,
  isUsableHighlightRect,
  TUTORIAL_CAPTURE_STEP_ID,
  TUTORIAL_CAPTURE_TRAVEL_STEP_ID,
  TUTORIAL_HOME_SECTOR,
  TUTORIAL_ITEM_BUY_STEP_ID,
  TUTORIAL_JUTSU_PICK_STEP_ID,
  TUTORIAL_RETURN_HOME_STEP_ID,
  TUTORIAL_STARTER_DEBRIEF_STEP_ID,
  TUTORIAL_VILLAGE_TOUR_STEP_ID,
} from "@/libs/tutorial";

/**
 * TUTORIAL_STEPS lives in a client module that pulls in tRPC, jotai and
 * next/navigation, so it cannot be imported here. Read the source instead and
 * slice it to the array, so `id:` keys elsewhere in the file cannot leak in.
 */
const readTutorialStepsSource = () => {
  const tutorialPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../src/hooks/tutorial.tsx",
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

const elementIdBlocks = () =>
  [...readTutorialStepsSource().matchAll(/elementIds:\s*\[([\s\S]*?)\]/g)].map(
    (match) => match[1] ?? "",
  );

describe("getTutorialStepPath", () => {
  it("strips in-page hashes", () => {
    expect(getTutorialStepPath("/townhall#Kage")).toBe("/townhall");
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
    expect(getTutorialBattleReturnPage(steps, active, "Won", "/profile")).toBe("/village");
  });

  it("uses the confirmed lesson when progress has already advanced", () => {
    expect(getTutorialBattleReturnPage(steps, { ...active, tutorialStep: 1 }, "Won", "/profile")).toBe("/village");
  });

  it("keeps the puppy victory on travel and a hospitalized player on healing", () => {
    expect(getTutorialBattleReturnPage(steps, { ...active, tutorialStep: 3 }, "Won", "/profile")).toBe("/travel");
    expect(getTutorialBattleReturnPage(steps, { ...active, status: "HOSPITALIZED" }, "Lost", "/profile")).toBe("/hospital");
  });

  it("preserves the chosen destination after the tutorial is disabled or finished", () => {
    expect(getTutorialBattleReturnPage(steps, { ...active, tutorialOn: false }, "Won", "/profile")).toBe("/profile");
    expect(getTutorialBattleReturnPage(steps, { ...active, tutorialStep: TUTORIAL_STEPS_COUNT }, "Won", "/profile")).toBe("/profile");
  });

  it("does not send an unresolved battle return back to combat", () => {
    expect(getTutorialBattleReturnPage(steps, active, undefined, "/profile")).toBe("/profile");
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
  it("tracks the current Horizon landmark, not the remapped 296 sector", () => {
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
  it("prefers the take-quest button id, then related academy quests", () => {
    expect(
      getTutorialHighlightedQuestId({
        title: "Genin Exam",
        relatedValue: "fallback",
        elementIds: ["tutorial-take-quest-exam-1"],
      }),
    ).toBe("exam-1");
    expect(
      getTutorialHighlightedQuestId({
        title: "Genin Exam",
        relatedValue: "exam-2",
      }),
    ).toBe("exam-2");
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

describe("TUTORIAL_STEPS", () => {
  it("highlights the world-travel confirm button before the globe and the Global tab", () => {
    const globalBlocks = elementIdBlocks().filter((block) =>
      block.includes("tutorial-global-map"),
    );
    expect(globalBlocks.length).toBeGreaterThan(0);
    for (const block of globalBlocks) {
      // Once the travel modal opens its proceed button must win the highlight;
      // the always-mounted globe would otherwise keep it for the whole step.
      expect(block.indexOf("tutorial-global-travel-proceed")).toBeLessThan(
        block.indexOf("tutorial-global-map"),
      );
      expect(block.indexOf("tutorial-global-map")).toBeLessThan(
        block.indexOf("tutorial-Global"),
      );
    }
  });

  it("uses unique ids so findIndex cannot jump to an earlier step", () => {
    const ids = stepIds();
    expect(ids.length).toBe(TUTORIAL_STEPS_COUNT);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it("keeps the pinned-step constants pointing at real steps", () => {
    const ids = stepIds();
    expect(ids).toContain(TUTORIAL_JUTSU_PICK_STEP_ID);
    expect(ids).toContain(TUTORIAL_ITEM_BUY_STEP_ID);
  });

  it("keeps the starter-quest mission steps in order", () => {
    const ids = stepIds();
    const mission = [
      TUTORIAL_CAPTURE_TRAVEL_STEP_ID,
      TUTORIAL_CAPTURE_STEP_ID,
      TUTORIAL_RETURN_HOME_STEP_ID,
      TUTORIAL_STARTER_DEBRIEF_STEP_ID,
      TUTORIAL_VILLAGE_TOUR_STEP_ID,
    ].map((id) => ids.indexOf(id));
    expect(mission[0]).toBeGreaterThan(-1);
    mission.forEach((index, i) => {
      if (i > 0) expect(index).toBe((mission[i - 1] ?? 0) + 1);
    });
  });

  it("gives every single-action step a Next button so it cannot dead-end", () => {
    // Enter/ArrowRight only advance when a step declares showNextButton or
    // proceedOnHighlightClick, so a step whose only other exit is one specific
    // game action needs an explicit escape hatch.
    const source = readTutorialStepsSource();
    for (const stepId of [
      TUTORIAL_JUTSU_PICK_STEP_ID,
      TUTORIAL_ITEM_BUY_STEP_ID,
      // Genin Exam - the final step, only otherwise exited by taking the quest
      "qgfxpmmQ2mYayeN2iMuX6",
    ]) {
      const start = source.indexOf(`id: "${stepId}"`);
      expect(start).toBeGreaterThan(-1);
      const block = source.slice(start, source.indexOf("\n  },", start));
      expect(block).toContain("showNextButton: true");
    }
  });
});

describe("getStarterQuestCatchUpStepId", () => {
  // Mirrors the live "Getting Started" quest: opening dialog, puppy fight,
  // closing dialog, win.
  const objectives = [
    { id: "eHayd", task: "dialog" },
    { id: "_nY7o", task: "defeat_opponents" },
    { id: "tuQde", task: "dialog" },
    { id: "fsyYJ", task: "win_quest" },
  ];
  const activeQuest = {
    questId: TUTORIAL_STARTER_QUEST_ID,
    completed: 0,
    endAt: null,
    quest: { content: { objectives } },
  };
  const tracker = (puppyDone: boolean) => ({
    id: TUTORIAL_STARTER_QUEST_ID,
    goals: [
      { id: "eHayd", done: true },
      { id: "_nY7o", done: puppyDone },
      { id: "tuQde", done: false },
      { id: "fsyYJ", done: false },
    ],
  });
  const capture = { id: TUTORIAL_CAPTURE_STEP_ID };

  it("stays put while the puppy is still to be fought", () => {
    const user = { sector: 227, userQuests: [activeQuest], questData: [tracker(false)] };
    expect(getStarterQuestCatchUpStepId(capture, user)).toBeUndefined();
    expect(
      getStarterQuestCatchUpStepId({ id: TUTORIAL_CAPTURE_TRAVEL_STEP_ID }, user),
    ).toBeUndefined();
  });

  it("skips the mission once the starter quest is finished", () => {
    // A completed attempt is not loaded into userQuests, and its tracker is gone.
    const user = { sector: 301, userQuests: [], questData: [] };
    for (const id of [
      TUTORIAL_CAPTURE_TRAVEL_STEP_ID,
      TUTORIAL_CAPTURE_STEP_ID,
      TUTORIAL_RETURN_HOME_STEP_ID,
    ]) {
      expect(getStarterQuestCatchUpStepId({ id }, user)).toBe(
        TUTORIAL_VILLAGE_TOUR_STEP_ID,
      );
    }
  });

  it("sends a player who already beat the puppy on to the trip home", () => {
    const user = { sector: 227, userQuests: [activeQuest], questData: [tracker(true)] };
    expect(getStarterQuestCatchUpStepId(capture, user)).toBe(
      TUTORIAL_RETURN_HOME_STEP_ID,
    );
  });

  it("goes straight to the academy when that player is already home", () => {
    const user = {
      sector: TUTORIAL_HOME_SECTOR,
      userQuests: [activeQuest],
      questData: [tracker(true)],
    };
    expect(getStarterQuestCatchUpStepId(capture, user)).toBe(
      TUTORIAL_STARTER_DEBRIEF_STEP_ID,
    );
  });

  it("leaves the trip home and debrief alone while the quest is running", () => {
    const user = { sector: 227, userQuests: [activeQuest], questData: [tracker(true)] };
    expect(
      getStarterQuestCatchUpStepId({ id: TUTORIAL_RETURN_HOME_STEP_ID }, user),
    ).toBeUndefined();
    // The debrief dialog completes the quest and advances the step itself.
    expect(
      getStarterQuestCatchUpStepId(
        { id: TUTORIAL_STARTER_DEBRIEF_STEP_ID },
        { sector: 301, userQuests: [], questData: [] },
      ),
    ).toBeUndefined();
  });

  it("waits for the tracker and ignores steps outside the mission", () => {
    expect(
      getStarterQuestCatchUpStepId(capture, {
        sector: 227,
        userQuests: [activeQuest],
        questData: [],
      }),
    ).toBeUndefined();
    expect(getStarterQuestCatchUpStepId(capture, { sector: 227 })).toBeUndefined();
    expect(
      getStarterQuestCatchUpStepId(
        { id: TUTORIAL_ITEM_BUY_STEP_ID },
        { sector: 301, userQuests: [], questData: [] },
      ),
    ).toBeUndefined();
  });
});
