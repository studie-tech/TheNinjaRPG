import { WORLD_LANDMARKS } from "@/libs/sector-map/landmarks";

/** Step that asks the player to start training a jutsu (Sonic Slash). */
export const TUTORIAL_JUTSU_PICK_STEP_ID = "eSBZJXRN_MCSYM90z3d5f";

/** Step that asks the player to buy the starter shuriken. */
export const TUTORIAL_ITEM_BUY_STEP_ID = "KvGkDox06od5iiFaGAzkM";

/** Starter-quest puppy fight; matches the live Getting Started objective. */
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
