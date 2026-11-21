import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getConsumedRaidBuffs, getInventoryQuantities } from "@/deltas/item";
import { withPackReveal } from "@/deltas/kessenCollection";
import { useKessenHubCache } from "@/hooks/kessen/useKessenHubCache";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

/**
 * Reconcile consumed stacks and effect views after the caller's profile update has settled.
 * A Kessen card pack also patches the Card Hall's owned cards and pity counters.
 */
export const useItemConsumptionCacheUpdate = () => {
  const utils = api.useUtils();
  const inventory = useInventoryCacheUpdate();
  const buffs = useQueryCacheUpdate<RouterOutputs["raids"]["getUserRaidBuffs"]>(
    getQueryKey(api.raids.getUserRaidBuffs, undefined, "query"),
  );
  const kessenHub = useKessenHubCache();
  /** Capture both inventory views, the buff view and the Card Hall before consuming. */
  const prepareConsumptionUpdate = () => ({
    inventory: inventory.prepareInventoryUpdate(),
    buffs: buffs.prepareUpdate(),
    kessenHub: kessenHub.prepareHubUpdate(),
  });
  /** Withheld metadata, profile recovery and transport uncertainty retain authoritative reads. */
  const updateConsumption = async (
    result: RouterOutputs["item"]["consume"] | undefined,
    snapshot: ReturnType<typeof prepareConsumptionUpdate>,
    profileApplied: boolean,
  ) => {
    const canProject = result?.success && profileApplied;
    const packReveal = result?.success ? result.kessenReveal : undefined;
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
      // An unknown outcome may have opened a pack; other confirmed results leave the hall.
      ...(packReveal || !result
        ? [
            kessenHub.updateHub(
              packReveal ? (current) => withPackReveal(current, packReveal) : undefined,
              snapshot.kessenHub,
            ),
          ]
        : []),
    ]);
  };
  return { prepareConsumptionUpdate, updateConsumption };
};
