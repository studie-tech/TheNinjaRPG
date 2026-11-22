import { atom } from "jotai";

/**
 * A lesson that asks for an answer or a reward on the Activity dock's Quests tab: the
 * quest it concerns and what to do there. The lesson unmounts while that tab is open,
 * so the tab shows the prompt and returns to the lesson once the quest moves on.
 */
export type QuestsTabLesson = { questId: string; prompt: string };

export const questsTabLessonAtom = atom<QuestsTabLesson | null>(null);
