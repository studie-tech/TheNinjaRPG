import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { fetchUpdatedUser, type UserWithRelations } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { handleQuestConsequences } from "@/server/utils/questConsequences";
import type { QueryCondition } from "@/utils/typeutils";
import type { QuestChallengeTask } from "@/validators/objectives";
import type { QuestChallengeRequest } from "@/validators/questChallenge";

/**
 * Record a verified minigame challenge win on the quest objective it names. The objective
 * is recorded only while `runIsActive` holds, so a claim that loads the player after its
 * run settled cannot complete the objective again, such as on a repeatable quest accepted
 * anew in between. A second claim of the same run that races the first can still record a
 * quest accepted anew before the caller retires the run, which may follow further
 * consequence work such as a started battle. That costs one extra repeatable objective on
 * the same account, accepted so the objective is recorded first and a failed write stays
 * retryable. A player whose objective is already done (a retry after recording) or
 * no longer open is answered without a write. `completedFor` is the player once the
 * objective is done, with `battle` set when a following objective started a battle.
 */
export const recordQuestChallengeWin = async (props: {
  client: DrizzleClient;
  userId: string;
  challenge: QuestChallengeRequest;
  task: QuestChallengeTask;
  runIsActive: QueryCondition;
}): Promise<
  | { ok: false; message: string }
  | {
      ok: true;
      completedFor?: NonNullable<UserWithRelations>;
      battle?: Awaited<ReturnType<typeof handleQuestConsequences>>["battleUserUpdate"];
    }
> => {
  const { client, challenge } = props;
  const { user } = await fetchUpdatedUser({ client, userId: props.userId });
  if (!user) return { ok: false, message: "User not found." };
  const isDone = (questData: typeof user.questData) =>
    !!questData
      ?.find((tracker) => tracker.id === challenge.questId)
      ?.goals.some((goal) => goal.id === challenge.objectiveId && goal.done);
  if (isDone(user.questData)) return { ok: true, completedFor: user };
  const { trackers, consequences, notifications } = getNewTrackers(user, [
    { task: props.task, contentId: challenge.objectiveId, text: challenge.questId },
  ]);
  if (!isDone(trackers)) return { ok: true };
  user.questData = filterQuestTrackersForDbPersist(trackers, user);
  const recorded = await handleQuestConsequences(
    client,
    user,
    consequences,
    notifications,
    { alwaysClaimUserState: true, claimConditions: [props.runIsActive] },
  );
  if (!recorded.claimed)
    return {
      ok: false,
      message: "Your character changed while the win was recorded. Claim it again.",
    };
  user.questData = trackers;
  return { ok: true, completedFor: user, battle: recorded.battleUserUpdate };
};
