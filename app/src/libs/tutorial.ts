import {
  MAP_WAKE_ISLAND_SECTOR,
  TUTORIAL_ARENA_DUMMY_ID,
  TUTORIAL_GENIN_EXAM_QUEST_ID,
  TUTORIAL_STARTER_QUEST_ID,
  TUTORIAL_STEPS_COUNT,
} from "@/drizzle/constants";
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

/**
 * Game actions a tutorial step can wait for. Pages report the action through
 * `completeTutorialAction`, and the step whose `advanceOn` matches moves on, so
 * no page has to know which step it belongs to.
 */
export const TutorialTriggers = [
  "questDialog",
  "questReward",
  "questObjective",
  "arenaStart",
  "assignStats",
  "levelUp",
  "trainStats",
  "trainJutsu",
  "buyItem",
  "buyRamen",
  "travelArrive",
  "petAdopt",
] as const;
export type TutorialTrigger = (typeof TutorialTriggers)[number];

/** Step that asks the player to learn Sonic Slash at the training grounds. */
export const TUTORIAL_JUTSU_PICK_STEP_ID = "tools-train-jutsu";

/** Step that asks the player to buy the starter shuriken. */
export const TUTORIAL_ITEM_BUY_STEP_ID = "tools-buy-shuriken";

/** Step that sends the player across the globe to the pup's sector. */
export const TUTORIAL_CAPTURE_TRAVEL_STEP_ID = "mission-travel-to-pup";

/**
 * Step that has the player walk up to the pup. The sector opens zoomed in on
 * the marker, since global travel lands a tutorial player a few tiles away.
 */
export const TUTORIAL_CAPTURE_STEP_ID = "mission-find-pup";

/** Step that sends the player to Wake Island to return the pup. */
export const TUTORIAL_WAKE_TRAVEL_STEP_ID = "bond-travel-wake";

/**
 * The pup's sector. Mirrors the `defeat_opponents` objective of the live
 * "Getting Started" quest; the sector lives in quest content, so it is not
 * derivable here and must be re-checked if that objective moves.
 */
export const TUTORIAL_CAPTURE_SECTOR = 227;

/** Wake Island, home of the Bondkeeper Sanctuary and the Genin exam. */
export const TUTORIAL_WAKE_SECTOR = MAP_WAKE_ISLAND_SECTOR;

const horizon = WORLD_LANDMARKS.find((landmark) => landmark.name === "Horizon");
if (!horizon) throw new Error("WORLD_LANDMARKS must include Horizon");
/** Horizon's world sector. */
export const TUTORIAL_HOME_SECTOR = horizon.sector;

/**
 * Objectives of the "Getting Started" quest, in the order its chain visits
 * them. Tutorial steps name the objective they work towards, and this order
 * tells which objectives a player has already passed (including ones an older
 * version of the chain let them skip).
 */
export const STARTER_QUEST_OBJECTIVES = {
  accept: "eHayd",
  arena: "tArna",
  jutsu: "tJtsu",
  brief: "tBrf1",
  pup: "_nY7o",
  sanctuary: "tSnct",
  debrief: "tuQde",
  genin: "tGnin",
  win: "fsyYJ",
} as const;
export type StarterQuestObjectiveId =
  (typeof STARTER_QUEST_OBJECTIVES)[keyof typeof STARTER_QUEST_OBJECTIVES];
const STARTER_QUEST_ORDER: readonly string[] = Object.values(STARTER_QUEST_OBJECTIVES);

/**
 * Objectives of the "Road to Genin" quest that the exam chapter walks through.
 * The village choice branches five ways, so joining and reporting home are
 * groups: whichever village the player picked, its objective stands for the step.
 */
export const GENIN_QUEST_OBJECTIVES = {
  level: "lG3__",
  exam: "mKVnH",
  tour: "tFTYj",
  choose: "mgzw_",
  join: ["x1IVl", "WmDyh", "xAiqy", "8Eksk", "VAYLT"],
  report: ["pBq1F", "k3Joa", "lhFP_", "dHuAY", "IhGF0"],
  win: "_l-eW",
} as const;
const GENIN_QUEST_IDS: ReadonlySet<string> = new Set(
  Object.values(GENIN_QUEST_OBJECTIVES).flat(),
);

/** A step's objective: one id, or a group where any one of them counts. */
export type TutorialObjectiveRef = string | readonly string[];
const toObjectiveIds = (ref: TutorialObjectiveRef): readonly string[] =>
  typeof ref === "string" ? [ref] : ref;

/** Pathname of a tutorial step, without the hash or query used to pick a tab. */
export const getTutorialStepPath = (page?: string | null) =>
  page?.split(/[#?]/)[0] ?? "";

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

/**
 * Whether a battle is one the tutorial teaches by hand: the arena dummy and
 * the starter quest's fights while the tutorial runs. These always start under
 * manual control, whatever the player's stored auto-combat default says.
 */
export const isTutorialGuidedBattle = (
  user: { tutorialOn?: boolean | null; tutorialStep?: number | null },
  battle: { opponentIds?: readonly string[]; questId?: string | null },
) =>
  isTutorialActive(user) &&
  (battle.questId === TUTORIAL_STARTER_QUEST_ID ||
    !!battle.opponentIds?.includes(TUTORIAL_ARENA_DUMMY_ID));

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
    advanceOn?: TutorialTrigger;
    relatedValue?: string | number;
    elementIds?: string[];
  } | null,
) => {
  const fromButton = getTutorialTakeQuestId(step);
  if (fromButton) return fromButton;
  if (step?.advanceOn === "questDialog" || step?.advanceOn === "questReward") {
    return typeof step.relatedValue === "string" ? step.relatedValue : undefined;
  }
  return undefined;
};

const MIN_HIGHLIGHT_PX = 4;

/** True when a DOM rect is large enough to draw a tutorial highlight. */
export const isUsableHighlightRect = (rect: { width: number; height: number }) =>
  rect.width > MIN_HIGHLIGHT_PX && rect.height > MIN_HIGHLIGHT_PX;

/** Reposition compact controls and maps that fit above the assistant; leave oversized maps scrollable. */
export const canPositionTutorialHighlight = (
  targetHeight: number,
  viewportHeight: number,
  assistantTop?: number,
) =>
  targetHeight < viewportHeight * 0.55 ||
  targetHeight + 80 < (assistantTop ?? viewportHeight);

export type TutorialScreenBox = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export type TutorialPortraitSide = "right" | "left";

/**
 * Which end of the Activity dock Lemu stands at, given the strip above the dock
 * she is drawn in. She prefers the right end, steps to the left end when the
 * highlight or the hand pointing at it is under her, and leaves (null) rather
 * than hide what the player has to press.
 */
export const getTutorialPortraitSide = ({
  frame,
  portraitWidth,
  inset,
  avoid,
}: {
  frame: TutorialScreenBox;
  portraitWidth: number;
  /** Gap between her and the end of the dock. */
  inset: number;
  avoid: TutorialScreenBox | null;
}): TutorialPortraitSide | null => {
  if (!avoid) return "right";
  // The hand pointer bounces just above or below the highlight.
  const blocked = {
    top: avoid.top - 72,
    bottom: avoid.top + avoid.height + 80,
    left: avoid.left - 16,
    right: avoid.left + avoid.width + 16,
  };
  const candidates: [TutorialPortraitSide, number][] = [
    ["right", frame.left + frame.width - inset - portraitWidth],
    ["left", frame.left + inset],
  ];
  const clear = candidates.find(
    ([, left]) =>
      left + portraitWidth <= blocked.left ||
      left >= blocked.right ||
      frame.top + frame.height <= blocked.top ||
      frame.top >= blocked.bottom,
  );
  return clear?.[0] ?? null;
};

/** Chapter progress shown in the assistant header. */
export const getTutorialChapterProgress = (
  steps: readonly { chapter: string }[],
  stepIndex: number,
) => {
  const chapter = steps[stepIndex]?.chapter;
  if (!chapter) return undefined;
  const chapterSteps = steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.chapter === chapter);
  const position = chapterSteps.findIndex(({ index }) => index === stepIndex);
  return { chapter, position: position + 1, total: chapterSteps.length };
};

type StarterQuestTutorialUser = {
  rank?: string;
  questData?:
    | {
        id: string;
        goals: {
          id: string;
          done?: boolean;
          collected?: boolean;
          selectedNextObjectiveId?: string;
        }[];
      }[]
    | null;
  userQuests?:
    | {
        questId: string;
        completed?: number | null;
        endAt?: Date | string | null;
      }[]
    | null;
};

/**
 * Where a player stands in the starter quest: finished, or the index (in
 * `STARTER_QUEST_ORDER`) of the objective their chain is currently on. The
 * chain is walked through the tracker's own selected edges rather than the
 * quest content, so a player who started under an older chain is placed by
 * the path they actually took. Undefined while the quest data is still loading.
 */
export const getStarterQuestProgress = (user?: StarterQuestTutorialUser | null) => {
  if (!user?.userQuests) return undefined;
  const active = user.userQuests.find(
    (entry) =>
      entry.questId === TUTORIAL_STARTER_QUEST_ID && !entry.endAt && !entry.completed,
  );
  if (!active)
    return { finished: true as const, activeIndex: STARTER_QUEST_ORDER.length };
  const tracker = user.questData?.find(
    (entry) => entry.id === TUTORIAL_STARTER_QUEST_ID,
  );
  if (!tracker) return undefined;
  let currentId: string | undefined = STARTER_QUEST_ORDER[0];
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const goal = tracker.goals.find((entry) => entry.id === currentId);
    if (!goal?.done) break;
    currentId =
      goal.selectedNextObjectiveId ??
      STARTER_QUEST_ORDER[STARTER_QUEST_ORDER.indexOf(currentId) + 1];
  }
  const activeIndex = currentId ? STARTER_QUEST_ORDER.indexOf(currentId) : -1;
  return {
    finished: false as const,
    activeIndex: activeIndex === -1 ? STARTER_QUEST_ORDER.length : activeIndex,
    goals: tracker.goals,
  };
};

/**
 * Whether the starter-quest objective a step works towards is behind the
 * player. Reward steps additionally wait for the reward to be claimed, unless
 * the chain has moved on without it (a bypassed objective has nothing to claim).
 */
export const isStarterObjectiveSatisfied = (
  objectiveId: string,
  progress: NonNullable<ReturnType<typeof getStarterQuestProgress>>,
  requireCollected = false,
) => {
  if (progress.finished) return true;
  const goal = progress.goals.find((entry) => entry.id === objectiveId);
  if (goal?.done) return !requireCollected || !!goal.collected;
  const index = STARTER_QUEST_ORDER.indexOf(objectiveId);
  return index !== -1 && progress.activeIndex > index;
};

/**
 * Whether the Road to Genin objective a step works towards is behind the
 * player. The quest grants the Genin rank, so a player who is no longer a
 * student and no longer has it active has finished it.
 */
export const isGeninObjectiveSatisfied = (
  objectiveId: TutorialObjectiveRef,
  user: StarterQuestTutorialUser,
  requireCollected = false,
) => {
  const isActive = user.userQuests?.some(
    (entry) =>
      entry.questId === TUTORIAL_GENIN_EXAM_QUEST_ID &&
      !entry.endAt &&
      !entry.completed,
  );
  if (!isActive) return !!user.rank && user.rank !== "STUDENT";
  const ids = toObjectiveIds(objectiveId);
  // Winning marks itself done; the step is about claiming the quest, which ends it.
  if (ids.includes(GENIN_QUEST_OBJECTIVES.win)) return false;
  const tracker = user.questData?.find(
    (entry) => entry.id === TUTORIAL_GENIN_EXAM_QUEST_ID,
  );
  return !!tracker?.goals.some(
    (goal) =>
      ids.includes(goal.id) && goal.done && (!requireCollected || goal.collected),
  );
};

/**
 * Whether a running tutorial has nothing left to teach: the player graduated
 * while its panel was out of view, so no step ever saw them do it.
 */
export const hasOutgrownTutorial = (
  user?:
    | (StarterQuestTutorialUser & {
        tutorialOn?: boolean | null;
        tutorialStep?: number | null;
      })
    | null,
) =>
  isTutorialActive(user) &&
  !!user?.userQuests &&
  isGeninObjectiveSatisfied(GENIN_QUEST_OBJECTIVES.win, user);

/**
 * Index of the step a player should be moved to because their quest is
 * already past what the current step asks for, or undefined to stay put.
 *
 * Steps that name an `objectiveId` only make sense while that objective is
 * still ahead: a player who already beat the pup (or finished the quest under
 * an older tutorial) would otherwise be pointed at a marker that no longer
 * exists. The skip runs through every consecutive satisfied step, so it lands
 * on the first lesson that still has something to do.
 *
 * A player still on the opening lessons has done none of them, so the lessons
 * in front of an objective that is behind them are skipped as well: someone who
 * played on with the panel hidden is not sent back to accept the trials and
 * fight the dummy again. Everyone else keeps those lessons, since they can teach
 * something the quest doesn't check.
 */
export const getTutorialCatchUpStepIndex = (
  steps: readonly {
    objectiveId?: TutorialObjectiveRef;
    advanceOn?: TutorialTrigger;
  }[],
  stepIndex: number,
  user?: StarterQuestTutorialUser | null,
) => {
  if (!user?.userQuests) return undefined;
  const starter = getStarterQuestProgress(user);
  const isSatisfied = (
    objectiveId: TutorialObjectiveRef,
    requireCollected: boolean,
  ) => {
    const isGeninStep = toObjectiveIds(objectiveId).some((id) =>
      GENIN_QUEST_IDS.has(id),
    );
    return isGeninStep
      ? isGeninObjectiveSatisfied(objectiveId, user, requireCollected)
      : !!starter &&
          toObjectiveIds(objectiveId).some((id) =>
            isStarterObjectiveSatisfied(id, starter, requireCollected),
          );
  };
  const isOnOpeningLessons = !steps
    .slice(0, stepIndex)
    .some((step) => step.objectiveId);
  let index = stepIndex;
  while (index < steps.length) {
    const objectiveId = steps[index]?.objectiveId;
    if (!objectiveId) {
      if (!isOnOpeningLessons) break;
      const next = steps.findIndex(
        (step, position) => position > index && step.objectiveId,
      );
      const nextObjectiveId = steps[next]?.objectiveId;
      if (!nextObjectiveId || !isSatisfied(nextObjectiveId, false)) break;
      index = next;
      continue;
    }
    if (!isSatisfied(objectiveId, steps[index]?.advanceOn === "questReward")) break;
    index += 1;
  }
  return index !== stepIndex ? index : undefined;
};

/**
 * Index of the step a player should be sent back to because the starter quest
 * is still waiting on the objective the current step pays out, or undefined to
 * stay put. The quest cannot go on without that objective, so a claim step
 * reached by skipping it has nothing to offer and must not be skipped as well.
 */
export const getTutorialRewindStepIndex = (
  steps: readonly {
    id: string;
    objectiveId?: TutorialObjectiveRef;
    objectiveStepId?: string;
  }[],
  stepIndex: number,
  user?: StarterQuestTutorialUser | null,
) => {
  const { objectiveId, objectiveStepId } = steps[stepIndex] ?? {};
  if (!objectiveId || !objectiveStepId) return undefined;
  const starter = getStarterQuestProgress(user);
  if (!starter || starter.finished) return undefined;
  const activeId = STARTER_QUEST_ORDER[starter.activeIndex];
  if (!activeId || !toObjectiveIds(objectiveId).includes(activeId)) return undefined;
  const index = steps.findIndex((step) => step.id === objectiveStepId);
  return index === -1 ? undefined : index;
};

/**
 * Step a player should be moved to because the fight the current step teaches
 * is no longer running, or undefined to stay put.
 *
 * The combat lessons live on `/combat` and only move on when the battle page
 * sees the result. A player whose fight ended while they were elsewhere (a
 * closed tab, a timed-out turn) is never sent back to `/combat`, since there is
 * no battle to show, and would sit on a lesson no page can display. They go on
 * to the win step when the objective the fight pays out is already done, and
 * back to the lesson that starts the fight otherwise.
 */
export const getTutorialStrandedBattleStepId = (
  steps: readonly {
    id: string;
    page: string;
    objectiveId?: TutorialObjectiveRef;
    onCombatWin?: string;
    onCombatLoss?: string;
  }[],
  stepIndex: number,
  user:
    | (StarterQuestTutorialUser & { status?: string; battleId?: string | null })
    | null
    | undefined,
  pathname: string,
) => {
  const step = steps[stepIndex];
  if (!step?.onCombatLoss || getTutorialStepPath(step.page) !== "/combat") return;
  // The battle page settles its own outcome, including a fight that just ended.
  if (pathname === "/combat") return;
  if (!user?.status || !user.userQuests) return;
  if (user.status === "BATTLE" && user.battleId) return;
  // The hospital lesson takes over until the player is discharged.
  if (user.status === "HOSPITALIZED") return;
  const winStep = steps.find((candidate) => candidate.id === step.onCombatWin);
  const progress = getStarterQuestProgress(user);
  const won =
    !!winStep?.objectiveId &&
    !!progress &&
    toObjectiveIds(winStep.objectiveId).some((id) =>
      isStarterObjectiveSatisfied(id, progress),
    );
  return won ? step.onCombatWin : step.onCombatLoss;
};

/** One action a player could take this turn, as the combat lesson sees it. */
export type TutorialCombatOption = {
  id: string;
  name: string;
  type: "basic" | "jutsu" | "item";
  range: number;
  /** Enough action points left and not on cooldown. */
  isUsable: boolean;
};

/** What the combat lesson asks the player to do next. */
export type TutorialCombatGuidance =
  | { kind: "wait" }
  | {
      kind: "select";
      actionId: string;
      actionName: string;
      reason: "attack" | "move" | "end";
    }
  | {
      kind: "target";
      actionId: string;
      actionName: string;
      reason: "attack" | "move" | "end";
    };

/**
 * Next instruction of the hands-on combat lesson. Attacks are preferred
 * strongest-first when the enemy is in their range (so a player who learned
 * Sonic Slash or bought shuriken is shown when to use them), otherwise the
 * player is walked closer, and when nothing else is affordable they end their
 * turn. Once the right action is selected the instruction moves to the field.
 */
export const getTutorialCombatGuidance = (info: {
  isPlayersTurn: boolean;
  distanceToEnemy: number | null;
  selectedActionId?: string;
  options: readonly TutorialCombatOption[];
}): TutorialCombatGuidance => {
  const { isPlayersTurn, distanceToEnemy, selectedActionId, options } = info;
  if (!isPlayersTurn || distanceToEnemy === null) return { kind: "wait" };
  const byId = (id: string) => options.find((option) => option.id === id);
  const attacks = options
    .filter((option) => option.id !== "move" && option.id !== "wait")
    .filter((option) => option.id !== "meditate")
    .filter((option) => option.isUsable && option.range >= distanceToEnemy)
    .sort((a, b) => typeRank(a.type) - typeRank(b.type));
  const selected = selectedActionId ? byId(selectedActionId) : undefined;
  const choose = (
    option: TutorialCombatOption,
    reason: "attack" | "move" | "end",
  ): TutorialCombatGuidance =>
    selected?.id === option.id
      ? { kind: "target", actionId: option.id, actionName: option.name, reason }
      : { kind: "select", actionId: option.id, actionName: option.name, reason };
  // Respect a usable attack the player picked themselves, if it reaches.
  if (selected && attacks.some((option) => option.id === selected.id)) {
    return choose(selected, "attack");
  }
  const attack = attacks[0];
  if (attack) return choose(attack, "attack");
  const move = byId("move");
  if (distanceToEnemy > 1 && move?.isUsable) return choose(move, "move");
  const end = byId("wait");
  if (end) return choose(end, "end");
  return { kind: "wait" };
};

/** Jutsu first, then thrown tools, then the basic attack. */
const typeRank = (type: TutorialCombatOption["type"]) =>
  type === "jutsu" ? 0 : type === "item" ? 1 : 2;
