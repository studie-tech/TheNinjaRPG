import { WORLD_LANDMARKS } from "@/libs/sector-map/landmarks";

/** Step that asks the player to start training a jutsu (Sonic Slash). */
export const TUTORIAL_JUTSU_PICK_STEP_ID = "eSBZJXRN_MCSYM90z3d5f";

/** Step that asks the player to buy the starter shuriken. */
export const TUTORIAL_ITEM_BUY_STEP_ID = "KvGkDox06od5iiFaGAzkM";

/**
 * Starter-quest puppy fight. Mirrors the `defeat_opponents` objective of the
 * live "Getting Started" quest; the sector lives in quest content, so it is not
 * derivable here and must be re-checked if that objective moves.
 */
export const TUTORIAL_CAPTURE_SECTOR = 293;

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

export const isTutorialJutsuPickStep = (step?: { id?: string } | null) =>
  step?.id === TUTORIAL_JUTSU_PICK_STEP_ID;

export const isTutorialItemBuyStep = (step?: { id?: string } | null) =>
  step?.id === TUTORIAL_ITEM_BUY_STEP_ID;

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
