"use client";

import { useStore } from "jotai";
import { RotateCcw } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  type GuidedLesson,
  type GuidedLessonMark,
  type GuidedLessonStep,
  guidedLessonAtom,
} from "@/layout/tutorial/guidedLesson";
import type { AcademyCoachStep } from "@/libs/kessen/academy";
import { escapeRegExp, lessonTargetSelector, markedNames } from "./lesson";

/**
 * Lemu's coach step over a lesson table, shown by the game's tutorial assistant: the
 * Activity dock's lesson panel says what to tap and why, and the tutorial spotlight
 * rings the control. Taps fall through the ring to the real control, and the next step
 * follows from the match state.
 */
export const LessonSpotlight = ({
  step,
  lesson,
  marks = [],
  onRetry,
  retrying = false,
  retryError = null,
}: {
  step: AcademyCoachStep;
  lesson: LessonHeading;
  /** The cards Lemu's words name, marked on the table (`lessonMarks`). */
  marks?: GuidedLessonMark[];
  onRetry?: () => void;
  retrying?: boolean;
  retryError?: string | null;
}) => {
  const target = lessonTargetSelector(step);
  // The ring already shows the target, so only the other cards Lemu names are marked.
  const shown = marks.filter((mark) => mark.selector !== target);
  const names = markedNames(shown);
  return (
    <LessonGuide
      lesson={lesson}
      step={{
        id: `${target}|${step.title}|${step.text}`,
        title: step.title,
        lead:
          step.why || names.length > 0 ? (
            <>
              {step.why ? (
                <p className={LEAD_CLASS}>{withCardNames(step.why, names)}</p>
              ) : null}
              <ReadCardsHint names={names} />
            </>
          ) : undefined,
        action: step.text,
        target,
        marks: shown,
        footer:
          step.retry && onRetry ? (
            <RetryRow
              onRetry={onRetry}
              retrying={retrying}
              error={retryError}
              variant="outline"
            />
          ) : undefined,
      }}
    />
  );
};

/**
 * A lesson step the player answers before the table goes on: Lemu's opening words, a
 * mistake with "Try again", or a pass he advises against. The tutorial assistant shows
 * it with `children` as its answers, and the page dims and takes no taps until one is
 * chosen.
 */
export const LessonNotice = ({
  lesson,
  title,
  tone = "guide",
  lead,
  why,
  marks = [],
  children,
}: {
  lesson: LessonHeading;
  title: string;
  tone?: "guide" | "mistake";
  /** What Lemu says first. */
  lead: string;
  /** The reason behind it, set apart. */
  why?: string;
  /** The cards Lemu's words name, marked on the table (`lessonMarks`). */
  marks?: GuidedLessonMark[];
  /** The answers, primary first. */
  children: ReactNode;
}) => {
  const names = markedNames(marks);
  return (
    <LessonGuide
      lesson={lesson}
      step={{
        id: `notice|${title}|${lead}`,
        title,
        blocking: true,
        marks,
        lead: (
          <>
            <p className={LEAD_CLASS}>{withCardNames(lead, names)}</p>
            {why ? (
              <p className={tone === "mistake" ? WHY_CLASS : ASIDE_CLASS}>
                {withCardNames(why, names)}
              </p>
            ) : null}
          </>
        ),
        footer: (
          <div className="flex flex-col gap-2 sm:flex-row-reverse">{children}</div>
        ),
      }}
    />
  );
};

/**
 * How to read the cards Lemu names, under a coach step's words while any are marked on
 * the table: hover or right-click with a mouse, press and hold on touch. Notices block
 * the table until answered, so they mark the cards without it.
 */
const ReadCardsHint = ({ names }: { names: readonly string[] }) => {
  if (names.length === 0) return null;
  const touch =
    typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  return (
    <p className={ASIDE_CLASS}>
      The cards Lemu names are <span className={NAME_CLASS}>marked</span> on the table.{" "}
      {touch
        ? "Press and hold one to read what it does."
        : "Hover one to read what it does, or right-click it for the whole card."}
    </p>
  );
};

/** `text` with every marked card name set in the marks' sky colour. */
const withCardNames = (text: string, names: readonly string[]): ReactNode => {
  if (names.length === 0) return text;
  const pattern = new RegExp(`(${names.map(escapeRegExp).join("|")})`, "gu");
  return text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the split's order is the text's
      <span key={index} className={NAME_CLASS}>
        {part}
      </span>
    ) : (
      part
    ),
  );
};

/** "Try again" (restart the lesson) with its pending state and refusal. */
export const RetryRow = ({
  onRetry,
  retrying,
  error,
  variant = "default",
  label = "Try again",
}: {
  onRetry: () => void;
  retrying: boolean;
  error: string | null;
  variant?: "default" | "outline";
  label?: string;
}) => (
  <div className="flex flex-col gap-1">
    <Button
      type="button"
      variant={variant}
      size="lg"
      className="w-full sm:w-auto"
      loading={retrying}
      onClick={onRetry}
    >
      <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
      {label}
    </Button>
    {error ? (
      <p role="alert" className="text-destructive text-sm">
        {error}
      </p>
    ) : null}
  </div>
);

/**
 * Registers a lesson step with the tutorial assistant (`guidedLessonAtom`) for as long
 * as it is mounted, under the lesson's heading. The table mounts one coach component
 * at a time, and only while the player can act, so when the last one unmounts the
 * lesson stays registered with a "watch the table" step while the table is in play
 * (it shows its Pass control) and clears once the result shows or the table closes.
 * The hidden anchor finds the table this component is mounted in.
 */
const LessonGuide = ({
  lesson,
  step,
}: {
  lesson: LessonHeading;
  step: GuidedLessonStep;
}) => {
  const store = useStore();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const { order, total } = lesson;
  const id = `kessen-academy-${order}`;
  const eyebrow = `Lesson ${order} of ${total} · ${lesson.title}`;
  // Re-registered on every render, so the answers' handlers stay current.
  useLayoutEffect(() => {
    cancelRelease();
    store.set(guidedLessonAtom, {
      id,
      step: { eyebrow, progress: { position: order, total }, ...step },
    });
  });
  useLayoutEffect(() => {
    const table = anchorRef.current?.parentElement ?? null;
    const idle: GuidedLesson = {
      id,
      step: {
        id: `${id}-idle`,
        eyebrow,
        progress: { position: order, total },
        title: "Watch the table",
        lead: (
          <p className={LEAD_CLASS}>
            Follow the table while it plays out the moves and the round's result. Your
            next step shows here as soon as it is your turn.
          </p>
        ),
      },
    };
    return () => scheduleRelease(store, idle, table);
  }, [store, id, eyebrow, order, total]);
  return <span ref={anchorRef} hidden data-lesson-guide="" />;
};

/**
 * After the last coach component unmounts: once the commit settles, show `idle` while
 * the table is in play and clear the lesson when it is not. A coach component mounting
 * in the same commit cancels this before anything changes.
 */
const scheduleRelease = (
  store: ReturnType<typeof useStore>,
  idle: GuidedLesson,
  table: HTMLElement | null,
) => {
  cancelRelease();
  let poll: ReturnType<typeof setInterval> | undefined;
  let cancelled = false;
  const handle = () => {
    cancelled = true;
    clearInterval(poll);
  };
  pendingRelease = handle;
  const inPlay = () =>
    !!table?.isConnected && !!table.querySelector('[data-lesson-target="pass"]');
  const end = () => {
    handle();
    if (pendingRelease === handle) pendingRelease = null;
    if (store.get(guidedLessonAtom)?.id === idle.id) store.set(guidedLessonAtom, null);
  };
  queueMicrotask(() => {
    if (cancelled) return;
    if (!inPlay()) return end();
    store.set(guidedLessonAtom, idle);
    poll = setInterval(() => {
      if (!inPlay()) end();
    }, RELEASE_POLL_MS);
  });
};

/** Stops a pending release, as a coach component takes over the lesson. */
const cancelRelease = () => {
  pendingRelease?.();
  pendingRelease = null;
};

/** The release waiting on the table, if any; one lesson table is open at a time. */
let pendingRelease: (() => void) | null = null;

/** How often a released lesson checks whether its table is still in play. */
const RELEASE_POLL_MS = 250;

const LEAD_CLASS = "text-base leading-relaxed";
/** What went wrong and what to do instead, set apart as in the tutorial's quotes. */
const WHY_CLASS =
  "border-amber-500 border-l-4 bg-muted/40 py-2 pr-3 pl-3 text-base leading-relaxed";
const ASIDE_CLASS = "text-muted-foreground text-sm leading-relaxed";
/** A card name in Lemu's words, in the colour of its mark on the table. */
const NAME_CLASS =
  "rounded-sm bg-sky-300/25 px-0.5 font-semibold text-sky-800 dark:text-sky-200";

/** The lesson a coach step belongs to. */
export interface LessonHeading {
  order: number;
  total: number;
  title: string;
}
