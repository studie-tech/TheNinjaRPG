/**
 * Per-chapter funnel of the story that follows the Academy Trials: how many players
 * started and finished each chapter. A player counts once per chapter: started by any
 * history row of its first quest, finished once a row of its closing quest (its last
 * follow-up, or the chapter quest itself) completed.
 */
export const buildStoryChapterFunnel = (
  chapters: readonly StoryFunnelChapter[],
  rows: readonly StoryFunnelRow[],
): StoryChapterFunnelEntry[] => {
  return chapters.map((chapter) => {
    const closingQuestId = chapter.followUpQuestIds?.at(-1) ?? chapter.questId;
    const startRows = rows.filter((row) => row.questId === chapter.questId);
    const closingRows = rows.filter((row) => row.questId === closingQuestId);
    const playersOf = (entries: readonly StoryFunnelRow[]) =>
      new Set(entries.map((row) => row.userId)).size;
    return {
      chapter: chapter.chapter,
      title: chapter.title,
      level: chapter.level,
      optional: "optional" in chapter && !!chapter.optional,
      started: playersOf(startRows),
      finished: playersOf(closingRows.filter((row) => row.completed === 1)),
    };
  });
};

/** A story chapter as the funnel reports it. */
export type StoryFunnelChapter = {
  chapter: number;
  questId: string;
  title: string;
  level: number;
  optional?: boolean;
  /** Quests that continue the chapter in order; the last one closes it. */
  followUpQuestIds?: readonly string[];
};

/** One player's attempt at a chapter's quest, finished when `completed` is 1. */
export type StoryFunnelRow = { userId: string; questId: string; completed: number };

/** Players who started and finished one chapter. */
export type StoryChapterFunnelEntry = {
  chapter: number;
  title: string;
  level: number;
  optional: boolean;
  started: number;
  finished: number;
};
