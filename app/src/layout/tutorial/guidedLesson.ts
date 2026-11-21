import { atom } from "jotai";
import type { ReactNode } from "react";

/**
 * A guided lesson outside the main tutorial, shown by the same tutorial assistant: the
 * Activity dock's tutorial tab with Lemu, the step's title, progress and call to action,
 * and the spotlight on the control to press. A scene that teaches through the assistant
 * (an Academy lesson table, say) registers its current step here while it is on screen
 * and clears it when it leaves; the assistant derives nothing from server progress for
 * it. While one is registered it takes precedence over the main tutorial's step, whose
 * saved progress stays untouched and returns when the lesson clears.
 */
export const guidedLessonAtom = atom<GuidedLesson | null>(null);

/** A registered guided lesson and the step it shows now. */
export interface GuidedLesson {
  /** Stable for the whole lesson, so the dock keeps its open state across steps. */
  id: string;
  step: GuidedLessonStep;
}

/** One step of a guided lesson, in the assistant's own terms. */
export interface GuidedLessonStep {
  /** Identity of the step; a new id places its target afresh. */
  id: string;
  /** "Lesson 2 of 6 · Enough Is Enough", above the title. */
  eyebrow?: string;
  title: string;
  progress?: { position: number; total: number };
  /** What Lemu says, above the call to action. */
  lead?: ReactNode;
  /** The call to action, in the amber callout. */
  action?: string;
  /** CSS selector of the control to ring; the first visible, non-inert match is used. */
  target?: string;
  /** Answers to the step, kept in view under the text. */
  footer?: ReactNode;
  /** The page waits for an answer in the footer: it dims behind the dock and takes no taps. */
  blocking?: boolean;
}
