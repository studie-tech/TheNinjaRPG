import { useCheckRewards } from "@/layout/Logbook";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import {
  dialogChoiceContentId,
  getActiveObjective,
  getQuestClaim,
} from "@/libs/objectives";
import { toObjectiveIds } from "@/libs/tutorial";
import type { TutorialStepConfig } from "@/libs/tutorialSteps";
import { useUserDataSelector } from "@/utils/UserContext";

/** An answer the player can give in a scene. */
export type StoryAnswer = { text: string; choose: () => void };

/** What a scene offers: a reward to claim, or a conversation to answer. */
export type StoryOffer = {
  questId: string;
  isPending: boolean;
  claim?: { label: string; claim: () => void };
  dialog?: {
    id: string;
    description: string;
    answers: StoryAnswer[];
  };
};

/**
 * What a lesson's quest offers the player in a scene, outside the quest log: the answers of
 * the conversation it waits on, or the reward it earned. Undefined while there is nothing
 * to do.
 */
export const useStoryOffer = (
  step: TutorialStepConfig | undefined,
): StoryOffer | undefined => {
  const { data: user } = useUserDataSelector((current) => ({
    status: current.status,
    autoWakeUp: current.autoWakeUp,
    userQuests: current.userQuests,
    questData: current.questData,
  }));
  const { checkRewards, isCheckingRewards } = useCheckRewards();
  const userQuest = user?.userQuests?.find(
    (entry) => entry.questId === step?.relatedValue && !entry.endAt,
  );
  const tracker = user?.questData?.find((entry) => entry.id === userQuest?.questId);
  if (!step?.objectiveId || !userQuest || !tracker || !canAttemptAwakeAction(user))
    return undefined;
  const objectiveIds = toObjectiveIds(step.objectiveId);
  const { questId, quest } = userQuest;
  const base = { questId, isPending: isCheckingRewards };
  if (step.advanceOn === "questReward") {
    const claim = getQuestClaim(quest, tracker, objectiveIds[0]);
    return claim?.isReady
      ? {
          ...base,
          claim: { label: claim.label, claim: () => checkRewards({ questId }) },
        }
      : undefined;
  }
  const objective = getActiveObjective(quest, tracker);
  if (
    step.advanceOn !== "questDialog" ||
    objective?.task !== "dialog" ||
    objective.overworldPlacementId ||
    !objectiveIds.includes(objective.id)
  )
    return undefined;
  return {
    ...base,
    dialog: {
      id: objective.id,
      description: objective.description,
      answers: objective.nextObjectiveId.map(
        (entry): StoryAnswer => ({
          text: entry.text,
          choose: () =>
            checkRewards({
              questId,
              nextObjectiveId: dialogChoiceContentId(
                entry.nextObjectiveId,
                objective.id,
              ),
            }),
        }),
      ),
    },
  };
};
