import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getInventoryQuantities } from "@/deltas/item";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";

/** Reconcile quest discovery and both inventory views after profile settlement. */
export const useQuestStartCacheUpdate = () => {
  const utils = api.useUtils();
  const inventory = useInventoryCacheUpdate();
  /** Capture both inventory views before the quest start. */
  const prepareQuestStartUpdate = inventory.prepareInventoryUpdate;
  /** Refresh discovery because eligibility may have changed since its last query. */
  const updateQuestStart = async (
    result:
      | RouterOutputs["quests"]["startQuest"]
      | RouterOutputs["quests"]["startRandom"]
      | undefined,
    snapshot: ReturnType<typeof prepareQuestStartUpdate>,
    profileApplied: boolean,
  ) => {
    await Promise.all([
      inventory.updateInventory(
        result?.success && profileApplied
          ? (rows) => getInventoryQuantities(rows, result.inventoryChanges)
          : undefined,
        snapshot,
      ),
      utils.quests.missionHall.invalidate(),
      utils.quests.specificQuests.invalidate(),
    ]);
  };
  return { prepareQuestStartUpdate, updateQuestStart };
};
