import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getQuestRewardDashboardUpdate } from "@/deltas/quests";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

/** Reconcile quest reward views without suppressing recovery or eligibility-changing reads. */
export const useQuestRewardCacheUpdate = () => {
  const utils = api.useUtils();
  const dashboard = useQueryCacheUpdate<RouterOutputs["profile"]["getDashboard"]>(
    getQueryKey(api.profile.getDashboard, undefined, "query"),
  );
  /** Capture discovery's revision before the reward claim starts. */
  const prepareQuestRewardUpdate = dashboard.prepareUpdate;
  /** A profile refetch can trigger further quest effects, so only accepted local updates may project. */
  const updateQuestRewards = async (
    result: RouterOutputs["quests"]["checkRewards"],
    snapshot: ReturnType<typeof prepareQuestRewardUpdate>,
    profileApplied: boolean,
  ) => {
    const update =
      result.success && profileApplied ? result.questCacheUpdate : undefined;
    await Promise.all([
      dashboard.updateCache(
        update
          ? (current) => getQuestRewardDashboardUpdate(current, update)
          : undefined,
        snapshot,
      ),
      ...(update?.discoveryUnchanged
        ? []
        : [
            utils.quests.missionHall.invalidate(),
            utils.quests.specificQuests.invalidate(),
            utils.quests.getQuestHistory.invalidate(),
            utils.quests.allianceBuilding.invalidate(),
          ]),
    ]);
  };
  return { prepareQuestRewardUpdate, updateQuestRewards };
};
