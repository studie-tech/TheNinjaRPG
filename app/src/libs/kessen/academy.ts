/**
 * The Kessen Academy: Lemu's lesson series. This module is the public face of the
 * lessons in `academyLessons.ts`: their metadata and unlock order, the match each one
 * starts from, Lemu's scripted replies and the coach step the table renders, derived
 * purely from the player's view and the table's draft.
 */
import {
  KESSEN_ACADEMY_GRADUATION_PACK_ID,
  KESSEN_ACADEMY_LESSON_RYO,
  type KessenTier,
} from "@/drizzle/constants";
import {
  type AcademyAdvice,
  type AcademyLessonDefinition,
  KESSEN_ACADEMY_LESSON_KEYS,
  KESSEN_ACADEMY_LESSONS,
  type KessenAcademyLessonKey,
} from "./academyLessons";
import { academyPositionProblem, buildAcademyPosition } from "./academyPosition";
import { isInfiltrator } from "./board";
import { actingSeats, applyAction, targetOptionsForView, viewFor } from "./engine";
import type { KessenKeyword } from "./text";
import { ROW_LABELS } from "./text";
import type { KessenAction, KessenCard, MatchState, MatchView, Row } from "./types";

export { KESSEN_ACADEMY_LESSON_KEYS, type KessenAcademyLessonKey };

/** NPC whose table hosts every Academy lesson. */
export const KESSEN_ACADEMY_NPC = "lemu" as const;
/** The lesson that unlocks the starter deck, the Circuit and duels. */
export const KESSEN_ACADEMY_FIRST_LESSON: KessenAcademyLessonKey = "first-blood";
/** Tier stored on lesson match rows; lessons pay only their Academy reward. */
export const KESSEN_ACADEMY_TIER: KessenTier = "GENIN";

/** A lesson as the Card Hall lists it. */
export interface KessenAcademyLessonInfo {
  key: KessenAcademyLessonKey;
  /** 1-based position in the series. */
  order: number;
  title: string;
  idea: string;
  summary: string;
  intro: string;
  winLine: string;
  lossLine: string;
  keywords: KessenKeyword[];
  /** Ryo the first completion pays. */
  rewardRyo: number;
}

export const KESSEN_ACADEMY: readonly KessenAcademyLessonInfo[] =
  KESSEN_ACADEMY_LESSONS.map((lesson, index) => ({
    key: lesson.key,
    order: index + 1,
    title: lesson.title,
    idea: lesson.idea,
    summary: lesson.summary,
    intro: lesson.intro,
    winLine: lesson.winLine,
    lossLine: lesson.lossLine,
    keywords: [...lesson.keywords],
    rewardRyo: KESSEN_ACADEMY_LESSON_RYO,
  }));

export const isAcademyLessonKey = (key: unknown): key is KessenAcademyLessonKey =>
  typeof key === "string" &&
  (KESSEN_ACADEMY_LESSON_KEYS as readonly string[]).includes(key);

const definition = (key: KessenAcademyLessonKey): AcademyLessonDefinition =>
  KESSEN_ACADEMY_LESSONS.find(
    (lesson) => lesson.key === key,
  ) as AcademyLessonDefinition;

/**
 * Lesson keys completed in `KessenProgress.academy` (lesson key to the completing
 * match), in series order; unknown keys are ignored.
 */
export const academyLessonsCompleted = (
  academy: Readonly<Record<string, string>> | null | undefined,
): KessenAcademyLessonKey[] =>
  KESSEN_ACADEMY_LESSON_KEYS.filter((key) => academy?.[key] !== undefined);

/** Whether the first lesson, which unlocks the rest of Kessen, is complete. */
export const finishedFirstLesson = (
  academy: Readonly<Record<string, string>> | null | undefined,
) => academy?.[KESSEN_ACADEMY_FIRST_LESSON] !== undefined;

/** One lesson's standing for the player, as the Card Hall shows it. */
export interface KessenAcademyEntry extends KessenAcademyLessonInfo {
  completed: boolean;
  /** Why the lesson cannot be started yet; null when it can. */
  lockReason: string | null;
}

/** The Academy as the Card Hall shows it, from the player's completed lessons. */
export interface KessenAcademyProgress {
  lessons: KessenAcademyEntry[];
  completed: number;
  total: number;
  /** The recommended lesson: the first one not completed; null once all are. */
  next: KessenAcademyLessonKey | null;
  /** The whole series is complete and its pack was granted. */
  graduated: boolean;
  /** The pack the series grants once, on its last first completion. */
  graduationPackId: string;
}

export const academyProgress = (
  academy: Readonly<Record<string, string>> | null | undefined,
  graduatedMatchId: string | null | undefined,
): KessenAcademyProgress => {
  const completed = academyLessonsCompleted(academy);
  return {
    lessons: KESSEN_ACADEMY.map((lesson) => ({
      ...lesson,
      keywords: [...lesson.keywords],
      completed: completed.includes(lesson.key),
      lockReason: academyLessonLockReason(lesson.key, completed),
    })),
    completed: completed.length,
    total: KESSEN_ACADEMY_LESSON_KEYS.length,
    next: nextAcademyLesson(completed),
    graduated: !!graduatedMatchId,
    graduationPackId: KESSEN_ACADEMY_GRADUATION_PACK_ID,
  };
};

/**
 * Why a lesson cannot be started; null when it can. Lessons open in order, and a
 * completed lesson can always be replayed.
 */
export const academyLessonLockReason = (
  key: KessenAcademyLessonKey,
  completed: readonly string[],
): string | null => {
  const index = KESSEN_ACADEMY_LESSON_KEYS.indexOf(key);
  const previous = KESSEN_ACADEMY_LESSON_KEYS[index - 1];
  if (previous === undefined || completed.includes(previous)) return null;
  return `Finish "${definition(previous).title}" first.`;
};

/** The first lesson not completed yet, in series order; null once all are done. */
export const nextAcademyLesson = (completed: readonly string[]) =>
  KESSEN_ACADEMY_LESSON_KEYS.find((key) => !completed.includes(key)) ?? null;

/**
 * The lesson to recommend before a Circuit match: the first open, unfinished lesson
 * that teaches one of the opponent's keywords; null when none is.
 */
export const academyLessonFor = (
  keywords: readonly string[],
  completed: readonly string[],
): KessenAcademyLessonKey | null =>
  KESSEN_ACADEMY.find(
    (lesson) =>
      !completed.includes(lesson.key) &&
      !academyLessonLockReason(lesson.key, completed) &&
      lesson.keywords.some((keyword) => keywords.includes(keyword)),
  )?.key ?? null;

/** Whether completing `key` now completes the whole series. */
export const completesAcademy = (
  key: KessenAcademyLessonKey,
  completed: readonly string[],
) =>
  KESSEN_ACADEMY_LESSON_KEYS.every(
    (entry) => entry === key || completed.includes(entry),
  );

/**
 * The lesson's starting state over `catalog` (the live catalog snapshot), validated by
 * the engine's invariants; an error when a card is missing or the position is broken.
 * Lemu has not acted yet: the caller runs its replies like any NPC turn.
 */
export const academyLessonState = (
  key: KessenAcademyLessonKey,
  catalog: readonly KessenCard[],
): { state: MatchState } | { error: string } => {
  let state: MatchState;
  try {
    state = buildAcademyPosition(definition(key).position, catalog, `academy:${key}`);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown lesson card" };
  }
  const problem = academyPositionProblem(state);
  return problem ? { error: problem } : { state };
};

/**
 * The starting state of a lesson for a new match: the validated position, provided the
 * taught line still wins over `catalog`. A staff edit to a card the lesson uses can
 * break the line; the lesson then stays closed instead of teaching a position that no
 * longer works.
 */
export const academyLessonStart = (
  key: KessenAcademyLessonKey,
  catalog: readonly KessenCard[],
): { state: MatchState } | { error: string } => {
  const line = academyTaughtLine(key, catalog);
  if ("error" in line) return line;
  return { state: line.start };
};

/** Lemu's scripted action in a lesson, from its own view. */
export const academyNpcAction = (key: KessenAcademyLessonKey, view: MatchView) =>
  definition(key).lemu(view);

/** The coach's advice for the player's view, before the table's draft is applied. */
export const academyAdvice = (key: KessenAcademyLessonKey, view: MatchView) =>
  view.phase === "play" && view.turn === view.me && !view.result
    ? definition(key).advise(view)
    : null;

/**
 * Plays a lesson's taught line from its starting state: the coach's advice on every
 * turn of the player, Lemu's script on every other. `start` is the starting state,
 * `state` the won end and `actions` the player's moves.
 */
export const academyTaughtLine = (
  key: KessenAcademyLessonKey,
  catalog: readonly KessenCard[],
):
  | { start: MatchState; state: MatchState; actions: KessenAction[] }
  | { error: string } => {
  const opening = academyLessonState(key, catalog);
  if ("error" in opening) return opening;
  let state = opening.state;
  const actions: KessenAction[] = [];
  for (let n = 0; n < MAX_LESSON_ACTIONS && state.phase !== "over"; n++) {
    const seat = actingSeats(state)[0];
    if (seat === undefined) break;
    let action: KessenAction;
    if (state.phase === "mulligan") action = { t: "mull", cards: [] };
    else if (seat === 1) action = academyNpcAction(key, viewFor(state, 1));
    else {
      const advice = academyAdvice(key, viewFor(state, 0));
      if (advice?.kind !== "move") return { error: "The coach has no move" };
      action = advice.action;
      actions.push(action);
    }
    const applied = applyAction(state, seat, action);
    if (!applied.ok) return { error: applied.reason };
    state = applied.state;
  }
  if (state.result?.winner !== 0) return { error: "The taught line does not win" };
  return { start: opening.state, state, actions };
};

const MAX_LESSON_ACTIONS = 200;

/** The lesson's closing card: the idea, and why a lost lesson was lost. */
export interface AcademyDebrief {
  won: boolean;
  title: string;
  text: string;
  /** The lesson's idea in one sentence. */
  idea: string;
}

/**
 * The closing card of a finished lesson from the player's final view. A lost lesson
 * names the pass that lost it when the player passed with cards left; otherwise it
 * repeats the lesson's own explanation.
 */
export const academyDebrief = (
  key: KessenAcademyLessonKey,
  view: MatchView,
): AcademyDebrief | null => {
  if (!view.result) return null;
  const lesson = definition(key);
  if (view.result.winner === view.me) {
    return {
      won: true,
      title: "Lesson complete",
      text: lesson.winLine,
      idea: lesson.idea,
    };
  }
  const last = view.history[view.history.length - 1];
  const left = view.seats[view.me].handCount;
  const them = view.me === 0 ? 1 : 0;
  if (last && last.winner !== view.me && left > 0) {
    return {
      won: false,
      title: "A pass too soon",
      text: `You passed Round ${last.round} with ${left} ${left === 1 ? "card" : "cards"} in hand, and Lemu won it ${last.totals[them]} to ${last.totals[view.me]}. A pass ends your part of the round for good. ${lesson.lossLine}`,
      idea: lesson.idea,
    };
  }
  return {
    won: false,
    title: "Not this time",
    text: lesson.lossLine,
    idea: lesson.idea,
  };
};

/**
 * A warning for a pass the coach did not ask for, so the table can confirm it first;
 * null when passing is the advice (or the coach has none).
 */
export const academyPassWarning = (key: KessenAcademyLessonKey, view: MatchView) => {
  const advice = academyAdvice(key, view);
  if (advice?.kind !== "move" || advice.action.t === "pass") return null;
  return `Passing ends your part of this round for good. Lemu would play on here (“${advice.title}”)${advice.why ? `: ${advice.why}` : "."}`;
};

// ---------------------------------------------------------------------------
// Coach steps

/**
 * Controls a coach step can ring, as `data-lesson-target` on the table: the hand strip,
 * one hand card (key: its instance), a row or its total (key: `academyRowKey`), a side's
 * total (key: "me" or "them"), the centre band, the hand-size badge, Pass, the Leader
 * button, the opponent's bar, a unit tile on either side (key: its instance) and the
 * button that confirms a drafted play.
 */
export type AcademyTargetName =
  | "hand"
  | "hand-card"
  | "row"
  | "row-total"
  | "side-total"
  | "center"
  | "badge"
  | "pass"
  | "leader"
  | "opponent"
  | "unit"
  | "confirm";

export interface AcademyTarget {
  target: AcademyTargetName;
  key?: string;
}

/** `data-lesson-key` of a row or its total: the side from the player's seat, then the row. */
export const academyRowKey = (side: "me" | "them", row: Row) => `${side}-${row}`;

/** What the table is drafting: the selected hand card and the partial action. */
export interface AcademyUiState {
  /** Whether the player may act now (their turn, nothing playing back or pending). */
  myTurn: boolean;
  /** The selected hand card's instance, or null. */
  card: string | null;
  /** The drafted play or leader action with the choices made so far, or null. */
  action: Extract<KessenAction, { t: "play" | "leader" }> | null;
  /** The player closed the last mistake card and plays on: guide the recovery move. */
  playOn?: boolean;
}

export interface AcademyCoachStep extends AcademyTarget {
  /** `guide` asks for the next tap; `mistake` explains why the last move was worse. */
  tone: "guide" | "mistake";
  title: string;
  /** The call to action, or what went wrong. */
  text: string;
  /** The reason behind it. */
  why?: string;
  /** Pulse the hand-size badge. */
  badge?: boolean;
  /** Offer "Try again" (restart the lesson). */
  retry: boolean;
  /** The move the step leads to; null when the lesson can only be restarted. */
  action: KessenAction | null;
}

/**
 * The coach step for a lesson table: the control to ring next and Lemu's words, from
 * the player's view and the table's draft. Null when the player cannot act (Lemu's turn,
 * playback, the round or match screens) or the coach has nothing to add.
 */
export const academyCoach = (
  key: KessenAcademyLessonKey,
  view: MatchView,
  ui: AcademyUiState,
): AcademyCoachStep | null => {
  if (!ui.myTurn) return null;
  const advice = academyAdvice(key, view);
  if (!advice) return null;
  if (advice.kind === "mistake") {
    if (ui.playOn && advice.action) {
      return {
        ...guideStep(view, ui, {
          kind: "move",
          action: advice.action,
          title: "Play on",
          text: "",
          why: advice.why,
        }),
        retry: true,
      };
    }
    return {
      target: "center",
      tone: "mistake",
      title: advice.title,
      text: advice.text,
      why: advice.why,
      retry: true,
      action: advice.action,
    };
  }
  return guideStep(view, ui, advice);
};

/** The sub-step of a move: pick the card, its row, each target, then confirm. */
const guideStep = (
  view: MatchView,
  ui: AcademyUiState,
  advice: Extract<AcademyAdvice, { kind: "move" }>,
): AcademyCoachStep => {
  const base = {
    tone: "guide" as const,
    title: advice.title,
    why: advice.why,
    badge: advice.badge,
    retry: false,
  };
  const intro = advice.text;
  const { action } = advice;
  if (action.t === "pass" || action.t === "mull") {
    return { ...base, target: "pass", text: intro || "Tap Pass.", action };
  }
  if (action.t === "leader") {
    if (ui.action?.t !== "leader") {
      return { ...base, target: "leader", text: intro || "Tap your leader.", action };
    }
    return targetStep(view, ui.action, action, base, "leader");
  }
  // A copy of the advised card is as good as the advised instance.
  const cardId = view.inst[action.card];
  const chosen =
    ui.card !== null && ui.card !== action.card && view.inst[ui.card] === cardId
      ? { ...action, card: ui.card }
      : action;
  const name = view.cards[cardId ?? ""]?.name ?? "the card";
  if (ui.card !== chosen.card) {
    return {
      ...base,
      target: "hand-card",
      key: chosen.card,
      text: ui.card ? `Not that one: tap ${name}.` : intro || `Tap ${name}.`,
      action: chosen,
    };
  }
  const card = view.cards[cardId ?? ""];
  const drafted = ui.action?.t === "play" ? ui.action : null;
  if (chosen.row !== undefined && drafted?.row !== chosen.row) {
    const side = card && isInfiltrator(card) ? "them" : "me";
    return {
      ...base,
      target: "row",
      key: academyRowKey(side, chosen.row),
      text:
        side === "them"
          ? `Tap Lemu's ${ROW_LABELS[chosen.row]} row.`
          : `Tap your ${ROW_LABELS[chosen.row]} row.`,
      action: chosen,
    };
  }
  return targetStep(
    view,
    drafted ?? { t: "play", card: chosen.card },
    chosen,
    base,
    "card",
  );
};

/** The next target of a drafted action, or its confirmation once every choice is made. */
const targetStep = (
  view: MatchView,
  drafted: Extract<KessenAction, { t: "play" | "leader" }>,
  wanted: Extract<KessenAction, { t: "play" | "leader" }>,
  base: Omit<AcademyCoachStep, "target" | "key" | "text" | "action">,
  restart: "leader" | "card",
): AcademyCoachStep => {
  const made = drafted.targets ?? [];
  const expected = wanted.targets ?? [];
  const onTrack = made.every((target, index) => expected[index] === target);
  if (!onTrack) {
    return restart === "leader"
      ? {
          ...base,
          target: "leader",
          text: "That target is not the one. Tap your leader to start over.",
          action: wanted,
        }
      : {
          ...base,
          target: "hand-card",
          key: wanted.t === "play" ? wanted.card : undefined,
          text: "That target is not the one. Tap the card again to start over.",
          action: wanted,
        };
  }
  const next = expected[made.length];
  if (next === undefined) {
    const unit = wanted.t === "play" && wanted.row !== undefined;
    return unit
      ? {
          ...base,
          target: "row",
          key: academyRowKey("me", wanted.row as Row),
          text: "Tap the row again to play it.",
          action: wanted,
        }
      : { ...base, target: "confirm", text: "Confirm the play.", action: wanted };
  }
  if (isRowName(next)) {
    const status = targetOptionsForView(view, view.me, drafted);
    const enemy = status.status === "need" && status.request.kind === "enemyRow";
    return {
      ...base,
      target: "row",
      key: academyRowKey(enemy ? "them" : "me", next),
      text: enemy
        ? `Tap Lemu's ${ROW_LABELS[next]} row.`
        : `Tap your ${ROW_LABELS[next]} row.`,
      action: wanted,
    };
  }
  const unitName = view.cards[view.inst[next] ?? ""]?.name ?? "the unit";
  return {
    ...base,
    target: "unit",
    key: next,
    text: `Tap ${unitName}.`,
    action: wanted,
  };
};

const isRowName = (target: string): target is Row =>
  target === "CLOSE" || target === "RANGED" || target === "JUTSU";
