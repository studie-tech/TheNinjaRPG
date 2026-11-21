import {
  RECRUITMENT_STALLED_AFTER_DAYS,
  USER_CAPS,
  type UserRank,
} from "@/drizzle/constants";
import type { QuestContentType } from "@/validators/objectives";

/**
 * The Genin path runs from graduating the tutorial to the Chunin rank: one step per level
 * up to the Chunin exam's required level, one per exam objective, then the rank itself.
 * Exam objectives are consecutive, so the number done is how far a player got.
 */
export const buildGeninPath = (quests: GeninPathQuest[], tutorialQuestId: string) => {
  const tutorial = quests.find((q) => q.id === tutorialQuestId);
  const levelGoal = tutorial?.content.objectives.find((o) => o.task === "user_level");
  const graduationLevel = levelGoal && "value" in levelGoal ? levelGoal.value : 1;
  const exam =
    quests
      .filter((q) => q.id !== tutorialQuestId && !q.hidden)
      .sort((a, b) => a.requiredLevel - b.requiredLevel)[0] ?? null;
  const examLevel = Math.max(
    graduationLevel,
    exam?.requiredLevel ?? USER_CAPS.GENIN.LVL_CAP,
  );

  const steps: GeninPathStep[] = [];
  for (let level = graduationLevel; level < examLevel; level++) {
    steps.push({
      label: `Lv ${level}`,
      description:
        level === graduationLevel
          ? `Graduated to Genin at level ${level}`
          : `Reached level ${level}`,
    });
  }
  steps.push({
    label: `Lv ${examLevel}+`,
    description: exam
      ? `Reached level ${examLevel}, eligible for ${exam.name}`
      : `Reached the Genin level cap (${examLevel})`,
  });
  const examObjectives = exam?.content.objectives ?? [];
  examObjectives.forEach((objective, i) => {
    const detail = plainText(objective.description ?? "");
    steps.push({
      label: `Exam ${i + 1}`,
      description: `${exam?.name} objective ${i + 1} (${objective.task})${detail ? `: ${detail}` : ""}`,
    });
  });
  steps.push({ label: "Chunin", description: "Promoted to Chunin or higher" });

  const examStepCount = examObjectives.length;
  const levelStepCount = examLevel - graduationLevel;

  /** Index of the furthest step `player` has reached. */
  const stepOf = (player: GeninPathPlayer) => {
    if (PROMOTED_RANKS.includes(player.rank)) return steps.length - 1;
    if (player.level < examLevel) {
      return Math.max(0, player.level - graduationLevel);
    }
    return levelStepCount + Math.min(player.examGoalsDone, examStepCount);
  };

  return { steps, stepOf };
};

/**
 * Whether a player has stopped playing: their latest known activity is older than
 * `RECRUITMENT_STALLED_AFTER_DAYS`. Players without `lastActiveAt` fall back to the
 * last quest they started themselves, then to their signup date.
 */
export const isStalledPlayer = (
  activity: (Date | string | null | undefined)[],
  now: Date,
) => {
  const latest = Math.max(
    ...activity.map((value) => (value ? new Date(value).getTime() : 0)),
  );
  return now.getTime() - latest > RECRUITMENT_STALLED_AFTER_DAYS * 24 * 60 * 60 * 1000;
};

/** Ranks at or past the end of the Genin path. */
const PROMOTED_RANKS: UserRank[] = ["CHUNIN", "JONIN", "ELITE JONIN", "ELDER"];

/** Quest description text without markup, trimmed for a tooltip line. */
const plainText = (html: string) => {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
};

/** A quest bounding the path: the tutorial's graduation quest or a quest awarding Chunin. */
export type GeninPathQuest = {
  id: string;
  name: string;
  requiredLevel: number;
  hidden: boolean;
  content: Pick<QuestContentType, "objectives">;
};

/** The player fields that place someone on the path. */
export type GeninPathPlayer = { level: number; rank: UserRank; examGoalsDone: number };

/** One bar of the Genin path funnel. */
export type GeninPathStep = { label: string; description: string };
