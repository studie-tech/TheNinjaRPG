import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getConsumedRaidBuffs, getInventoryQuantities } from "@/deltas/item";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

/** Reconcile consumed stacks and effect views after the caller's profile update has settled. */
export const useItemConsumptionCacheUpdate = () => {
  const utils = api.useUtils();
  const inventory = useInventoryCacheUpdate();
  const buffs = useQueryCacheUpdate<RouterOutputs["raids"]["getUserRaidBuffs"]>(
    getQueryKey(api.raids.getUserRaidBuffs, undefined, "query"),
  );
  /** Capture both inventory views and the buff view before consuming an item. */
  const prepareConsumptionUpdate = () => ({
    inventory: inventory.prepareInventoryUpdate(),
    buffs: buffs.prepareUpdate(),
  });
  /** Withheld metadata, profile recovery and transport uncertainty retain authoritative reads. */
  const updateConsumption = async (
    result: RouterOutputs["item"]["consume"] | undefined,
    snapshot: ReturnType<typeof prepareConsumptionUpdate>,
    profileApplied: boolean,
  ) => {
    const canProject = result?.success && profileApplied;
    await Promise.all([
      inventory.updateInventory(
        canProject
          ? (rows) => getInventoryQuantities(rows, result.inventoryChanges)
          : undefined,
        snapshot.inventory,
      ),
      ...(canProject && result.bloodlineRollsChanged === false
        ? []
        : [utils.bloodline.getItemRolls.invalidate()]),
      ...(canProject && result.raidBuffsChanged === false
        ? []
        : [
            buffs.updateCache(
              canProject
                ? (current) => getConsumedRaidBuffs(current, result)
                : undefined,
              snapshot.buffs,
            ),
          ]),
      ...(result?.petRewards?.length ? [utils.pets.getPet.invalidate()] : []),
    ]);
  };
  return { prepareConsumptionUpdate, updateConsumption };
};
