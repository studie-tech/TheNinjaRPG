import { isTutorialActive } from "@/libs/tutorial";
import { TUTORIAL_STEPS } from "@/libs/tutorialSteps";

/**
 * How much of the Activity dock's Quests tab a lesson marks: the tab, the prompt as a
 * callout and the outlined quest the first time; the tab alone; or nothing. The tab
 * states what to do there at every level, with the step's own prompt when it has one.
 */
export type QuestsTabMarks =
  | { marks: "all"; prompt: string }
  | { marks: "tab" | "none"; prompt?: string };

/**
 * A lesson that asks for an answer or a reward on the Activity dock's Quests tab: the
 * quest it concerns, how much the tab marks and what the tab says to do there. The
 * lesson unmounts while that tab is open, so the tab leads with the quest and returns to
 * the lesson once the quest moves on.
 */
export type QuestsTabLesson = {
  questId: string;
  marks: QuestsTabMarks["marks"];
  prompt: string;
};

/**
 * The saved step's Quests-tab lesson. It is read from the profile rather than from the
 * mounted lesson, so the tab knows it while the lesson is unmounted.
 */
export const getQuestsTabLesson = (
  user?: { tutorialOn?: boolean | null; tutorialStep?: number | null } | null,
): QuestsTabLesson | null => {
  if (!isTutorialActive(user)) return null;
  const step = TUTORIAL_STEPS[user?.tutorialStep ?? 0];
  if (!step?.questsTab || typeof step.relatedValue !== "string") return null;
  return {
    questId: step.relatedValue,
    marks: step.questsTab.marks,
    prompt:
      step.questsTab.prompt ??
      (step.advanceOn === "questDialog" ? "Answer here." : "Claim your reward here."),
  };
};
