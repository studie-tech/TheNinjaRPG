import { useRetryQuestBattle } from "@/hooks/quest";
import { useCheckRewards } from "@/layout/Logbook";
import { canRetryQuestBattle } from "@/libs/objectives";
import { useUserDataSelector } from "@/utils/UserContext";

/**
 * The fight of a quest's battle objective, for a control outside the quest log: `start`
 * gives the dialog answer that leads into it, or fights a lost one again. Undefined while
 * neither is the player's to do.
 */
export const useQuestFight = (info: {
  questId: string;
  /** Dialog objective whose answer opens the fight; left out, only a lost one is fought again. */
  dialogId?: string;
  battleId: string | undefined;
}) => {
  const { questId, dialogId, battleId } = info;
  const { data: user } = useUserDataSelector((current) => ({
    status: current.status,
    questData: current.questData,
  }));
  const { checkRewards, isCheckingRewards } = useCheckRewards();
  const { retryBattle, isRetrying } = useRetryQuestBattle();
  const goals = user?.questData?.find((tracker) => tracker.id === questId)?.goals;
  const goal = (id: string | undefined) => goals?.find((entry) => entry.id === id);
  const isAnswer = goal(dialogId)?.done === false;
  const isRetry = canRetryQuestBattle(goal(battleId));
  if (user?.status !== "AWAKE" || (!isAnswer && !isRetry)) return undefined;
  const isPending = isCheckingRewards || isRetrying;
  return {
    isPending,
    start: () => {
      if (isPending) return;
      if (isAnswer) checkRewards({ questId, nextObjectiveId: battleId });
      else retryBattle({ questId });
    },
  };
};
