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
  /** Capture the dashboard revision before the reward claim starts. */
  const prepareQuestRewardUpdate = dashboard.prepareUpdate;
  /**
   * A profile refetch can trigger further quest effects; profileApplied must be updateUser's result.
   * Missing projections retain dashboard and quest-list refetches.
   */
  const updateQuestRewards = async (
    result: RouterOutputs["quests"]["checkRewards"],
    snapshot: ReturnType<typeof prepareQuestRewardUpdate>,
    profileApplied: boolean,
  ) => {
    const update =
      result.success && profileApplied ? result.questCacheUpdate : undefined;
    await Promise.all([
      // Profile projections can include ordinary item rewards; skip only known item-free claims.
      // A profile recovery can grant collection items, so refresh inventory only after it settles.
      ...(update &&
      result.rewards?.reward_items.length === 0 &&
      !result.rewards.reward_hunter_items &&
      !result.rewards.reward_gathering_items
        ? []
        : [
            utils.item.getUserItems.invalidate(),
            utils.item.getUserItemsWithVariants.invalidate(),
          ]),
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
