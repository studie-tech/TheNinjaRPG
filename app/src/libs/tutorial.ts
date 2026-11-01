import { TUTORIAL_STARTER_QUEST_ID, TUTORIAL_STEPS_COUNT } from "@/drizzle/constants";
import { WORLD_LANDMARKS } from "@/libs/sector-map/landmarks";

/**
 * True while the tutorial still has a step left to show. A switched-off
 * tutorial has no current step, and a step index past the last step means the
 * player finished it. Kept here rather than in the tutorial hook so that code
 * outside the tutorial (e.g. auto-opening popups that must not cover it) can
 * ask the question without pulling in the whole step list.
 */
export const isTutorialActive = (
  user?: { tutorialOn?: boolean | null; tutorialStep?: number | null } | null,
) =>
  !!user &&
  user.tutorialOn !== false &&
  (user.tutorialStep ?? 0) < TUTORIAL_STEPS_COUNT;

/** Step that asks the player to start training a jutsu (Sonic Slash). */
export const TUTORIAL_JUTSU_PICK_STEP_ID = "eSBZJXRN_MCSYM90z3d5f";

/**
 * Step that sends the player after the starter quest's puppy. The step's text
 * promises a marker in the sector, which only exists once the quest's opening
 * dialog has been answered, so the tutorial answers it and opens the sector
 * zoomed out far enough to see where the marker actually is.
 */
export const TUTORIAL_CAPTURE_STEP_ID = "eRw6ObsRONhzY7AUMO3vm";

/** Step that sends the player across the globe to the puppy's sector. */
export const TUTORIAL_CAPTURE_TRAVEL_STEP_ID = "qPx_xVsMAZY0t05thYgZj";

/** Step after the puppy fight: travel back to Horizon. */
export const TUTORIAL_RETURN_HOME_STEP_ID = "UD2jVibug6Y0yKLYGzA_N";

/** Step that has the player answer the starter quest's closing dialog at the academy. */
export const TUTORIAL_STARTER_DEBRIEF_STEP_ID = "blL789mkRIKtjsWk";

/** First step after the starter quest: the village tour. */
export const TUTORIAL_VILLAGE_TOUR_STEP_ID = "fdalgdwlcigydvs";

/** Step that asks the player to buy the starter shuriken. */
export const TUTORIAL_ITEM_BUY_STEP_ID = "KvGkDox06od5iiFaGAzkM";

/**
 * Starter-quest puppy fight. Mirrors the `defeat_opponents` objective of the
 * live "Getting Started" quest; the sector lives in quest content, so it is not
 * derivable here and must be re-checked if that objective moves. Moved from
 * 293 to 227 by migration 0038, which carries the reasoning.
 */
export const TUTORIAL_CAPTURE_SECTOR = 227;

/** Horizon's current world sector — not the pre-remap 296 value. */
export const TUTORIAL_HOME_SECTOR =
  WORLD_LANDMARKS.find((landmark) => landmark.name === "Horizon")?.sector ?? 301;

/**
 * Pathname of a tutorial step, without the hash used for in-page tabs.
 */
export const getTutorialStepPath = (page?: string | null) => page?.split("#")[0] ?? "";

/**
 * True when the player is on the page the current tutorial step expects.
 * Exact path match only — `/profile/experience` must not match `/profile`.
 */
export const isTutorialPageMatch = (stepPage: string | undefined, pathname: string) => {
  const stepPath = getTutorialStepPath(stepPage);
  return stepPath !== "" && stepPath === pathname;
};

/** Return directly to the next lesson, including when its progress write is still settling. */
export const getTutorialBattleReturnPage = (
  steps: readonly {
    id: string;
    page: string;
    onCombatWin?: string;
    onCombatLoss?: string;
  }[],
  user:
    | { tutorialOn?: boolean | null; tutorialStep?: number | null; status?: string }
    | null
    | undefined,
  outcome: string | undefined,
  fallback: string,
) => {
  if (!isTutorialActive(user)) return fallback;
  if (user?.status === "HOSPITALIZED") return "/hospital";
  const step = steps[user?.tutorialStep ?? 0];
  if (!step) return fallback;
  const outcomeStepId =
    outcome === "Won" ? step.onCombatWin : outcome ? step.onCombatLoss : undefined;
  const next = steps.find((candidate) => candidate.id === outcomeStepId) ?? step;
  return getTutorialStepPath(next.page) === "/combat" ? fallback : next.page;
};

export const isTutorialJutsuPickStep = (step?: { id?: string } | null) =>
  step?.id === TUTORIAL_JUTSU_PICK_STEP_ID;

export const isTutorialItemBuyStep = (step?: { id?: string } | null) =>
  step?.id === TUTORIAL_ITEM_BUY_STEP_ID;

export const isTutorialCaptureStep = (step?: { id?: string } | null) =>
  step?.id === TUTORIAL_CAPTURE_STEP_ID;

/** Take-quest id from a step like `tutorial-take-quest-<questId>`. */
export const getTutorialTakeQuestId = (step?: { elementIds?: string[] } | null) =>
  step?.elementIds
    ?.find((id) => id.startsWith("tutorial-take-quest-"))
    ?.slice("tutorial-take-quest-".length);

/** Quest the academy picker should open for the current tutorial step. */
export const getTutorialHighlightedQuestId = (
  step?: {
    title?: string;
    relatedValue?: string | number;
    elementIds?: string[];
  } | null,
) => {
  const fromButton = getTutorialTakeQuestId(step);
  if (fromButton) return fromButton;
  if (step?.title === "Genin Exam" || step?.title === "Academy Dialog Option") {
    return typeof step.relatedValue === "string" ? step.relatedValue : undefined;
  }
  return undefined;
};

const MIN_HIGHLIGHT_PX = 4;

/** True when a DOM rect is large enough to draw a tutorial highlight. */
export const isUsableHighlightRect = (rect: { width: number; height: number }) =>
  rect.width > MIN_HIGHLIGHT_PX && rect.height > MIN_HIGHLIGHT_PX;

/** Reposition compact controls and maps that fit above Lemu; leave oversized maps scrollable. */
export const canPositionTutorialHighlight = (
  targetHeight: number,
  viewportHeight: number,
  assistantTop?: number,
) =>
  targetHeight < viewportHeight * 0.55 ||
  targetHeight + 80 < (assistantTop ?? viewportHeight);

type StarterQuestTutorialUser = {
  sector?: number | null;
  questData?: { id: string; goals: { id: string; done?: boolean }[] }[] | null;
  userQuests?:
    | {
        questId: string;
        completed?: number | null;
        endAt?: Date | string | null;
        quest?: { content: { objectives: { id: string; task: string }[] } } | null;
      }[]
    | null;
};

/** The starter quest attempt that is still running, if any. */
const getActiveStarterQuest = (user: StarterQuestTutorialUser) =>
  user.userQuests?.find(
    (entry) =>
      entry.questId === TUTORIAL_STARTER_QUEST_ID && !entry.endAt && !entry.completed,
  );

/**
 * The puppy objective of the starter quest: the `defeat_opponents` objective
 * the capture step sends the player after. Looked up by task, not id, so it
 * follows the quest content rather than a hard-coded objective id.
 */
export const getStarterQuestCaptureObjectiveId = (
  objectives?: { id: string; task: string }[] | null,
) => objectives?.find((objective) => objective.task === "defeat_opponents")?.id;

/**
 * Where the tutorial should jump to when the player reaches the puppy mission
 * having already done part of it, or undefined to stay put.
 *
 * The capture steps only make sense while the puppy is still out there: they
 * point at a marker that the active `defeat_opponents` objective draws. A
 * player who already beat the puppy, or finished the starter quest outright
 * (an account that came back after the tutorial grew new steps, or whose
 * stored step index shifted), would otherwise be stood in an empty sector with
 * nothing to fight and no way forward.
 *
 * - Quest no longer running: skip the whole mission to the village tour.
 * - Quest running, puppy already beaten: go to the trip home, or straight to
 *   the academy debrief when the player is already in Horizon (the travel step
 *   cannot advance for someone already in the destination sector).
 *
 * The debrief step itself is left alone: answering its dialog completes the
 * quest and the dialog handler advances the step, so acting on "quest gone"
 * there would race it and skip the village tour.
 */
export const getStarterQuestCatchUpStepId = (
  step?: { id?: string } | null,
  user?: StarterQuestTutorialUser | null,
) => {
  if (!step?.id || !user?.userQuests) return undefined;
  const isBeforeFight =
    step.id === TUTORIAL_CAPTURE_TRAVEL_STEP_ID || step.id === TUTORIAL_CAPTURE_STEP_ID;
  if (!isBeforeFight && step.id !== TUTORIAL_RETURN_HOME_STEP_ID) return undefined;
  const active = getActiveStarterQuest(user);
  if (!active) return TUTORIAL_VILLAGE_TOUR_STEP_ID;
  if (!isBeforeFight) return undefined;
  const tracker = user.questData?.find(
    (entry) => entry.id === TUTORIAL_STARTER_QUEST_ID,
  );
  const captureId = getStarterQuestCaptureObjectiveId(active.quest?.content.objectives);
  if (!tracker || !captureId) return undefined;
  const captured = tracker.goals.some((goal) => goal.id === captureId && goal.done);
  if (!captured) return undefined;
  return user.sector === TUTORIAL_HOME_SECTOR
    ? TUTORIAL_STARTER_DEBRIEF_STEP_ID
    : TUTORIAL_RETURN_HOME_STEP_ID;
};
