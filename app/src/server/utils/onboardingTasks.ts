import {
  BLACKSTEEL_CHAPTERS,
  BLACKSTEEL_LEAD_QUEST_IDS,
  ONBOARDING_DAILY_QUEST_IDS,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import {
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  hasOpenTask,
} from "@/libs/quest";
import {
  getPublicQuestUser,
  mockAchievementHistoryEntries,
} from "@/libs/quest/projection";
import { findUserDataForFetchQuestUser } from "@/queries/train";
import { fetchUpdatedUser, type UserWithRelations } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { fetchAchievementCatalogue } from "@/server/utils/caches/achievementCatalogue";
import { handleQuestConsequences } from "@/server/utils/questConsequences";
import type { OnboardingEventTask } from "@/validators/objectives";

/**
 * State tasks that a request also satisfies: asking a Jonin to be your sensei or asking to
 * join a clan is the step the story teaches, since the answer is someone else's to give.
 */
export type OnboardingRequestTask = "get_sensei" | "join_clan";

/**
 * Count one story-onboarding action (a bank deposit, a claimed streak, a cooked meal…)
 * towards the active quest objectives that ask for it.
 *
 * The action's own write has already committed, so this is best effort: it loads the
 * player's quests only when a stored story tracker still has an unfinished goal, and
 * a lost snapshot race is retried once and otherwise dropped. A missed count costs the
 * player one repeat of a cheap action, never a reward, so it does not justify locking.
 * Pass `questData` when the caller already holds the row, to skip the load entirely for
 * players without open story goals; a caller holding the player's quests checks `hasOpenTask`
 * itself instead. Resolves to the public trackers once progress was written,
 * for the caller's profile patch, and to undefined when nothing changed.
 */
export const recordOnboardingTask = async (props: {
  client: DrizzleClient;
  userId: string;
  task: OnboardingEventTask | OnboardingRequestTask;
  questData?: UserData["questData"];
}) => {
  const { client, userId, task } = props;
  if (props.questData !== undefined && !hasOpenStoryGoal(props.questData)) return;
  // A failure must not turn the already-committed action into an error; the count is
  // dropped like a lost race.
  try {
    return await recordOpenTask(client, userId, task);
  } catch {
    return undefined;
  }
};

/** Load the player's quests and count the task once, retrying one lost snapshot race. */
const recordOpenTask = async (
  client: DrizzleClient,
  userId: string,
  task: OnboardingEventTask | OnboardingRequestTask,
) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const user = await fetchTaskUser(client, userId);
    if (!user || !hasOpenTask(user, task)) return;
    const { trackers, consequences, notifications } = getNewTrackers(user, [
      { task, increment: 1 },
    ]);
    user.questData = filterQuestTrackersForDbPersist(trackers, user, true);
    const recorded = await handleQuestConsequences(
      client,
      user,
      consequences,
      notifications,
      { alwaysClaimUserState: true },
    );
    if (recorded.claimed) {
      user.questData = trackers;
      return getPublicQuestUser(user).questData;
    }
  }
  return undefined;
};

/**
 * The player's quest context without a profile refresh: the sparse quest read the user
 * queue settles with, plus the cached achievements a profile read tracks in memory, so the
 * returned trackers cover the same quests. Quest team members take the full profile read,
 * since recording consequences publishes team progress from its party relation.
 */
const fetchTaskUser = async (client: DrizzleClient, userId: string) => {
  const [row, achievements] = await Promise.all([
    findUserDataForFetchQuestUser(client, userId, undefined, undefined),
    fetchAchievementCatalogue(client),
  ]);
  if (!row) return undefined;
  if (row.questPartyId) return (await fetchUpdatedUser({ client, userId })).user;
  // Tracker evaluation reads quests, village and items, all loaded above.
  const user = row as unknown as NonNullable<UserWithRelations>;
  user.userQuests = user.userQuests.filter((entry) => entry.quest);
  user.userQuests.push(...mockAchievementHistoryEntries(achievements, user));
  return user;
};

/**
 * Quests that ask for onboarding actions: the Blacksteel chapters, their Leads and the
 * onboarding dailies. A quest given an onboarding task must be listed here, or the
 * actions never count towards it.
 */
const STORY_QUEST_IDS: ReadonlySet<string> = new Set([
  ...BLACKSTEEL_CHAPTERS.map((chapter) => chapter.questId),
  ...BLACKSTEEL_LEAD_QUEST_IDS,
  ...ONBOARDING_DAILY_QUEST_IDS,
]);

/**
 * Whether a quest asking for onboarding actions still has an open goal. Actions gate on
 * this cheap check of the row they already hold, so players on other quests never load
 * quest data.
 */
const hasOpenStoryGoal = (questData: UserData["questData"]) =>
  !!questData?.some(
    (tracker) =>
      STORY_QUEST_IDS.has(tracker.id) && tracker.goals.some((goal) => !goal.done),
  );
