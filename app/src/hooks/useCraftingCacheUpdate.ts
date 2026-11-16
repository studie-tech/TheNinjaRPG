import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import {
  getCraftedInventory,
  getCraftedVariantInventory,
  getCraftingTimers,
  getQueuedCrafts,
} from "@/deltas/occupation";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

/**
 * Reconcile the inventory, crafting queue and sidebar timers with a confirmed craft or
 * cooking batch. A withheld projection or a changed snapshot reads that view again.
 */
export const useCraftingCacheUpdate = () => {
  const { prepareInventoryUpdate, updateInventoryViews } = useInventoryCacheUpdate();
  const queue = useQueryCacheUpdate<RouterOutputs["occupation"]["getCraftingQueue"]>(
    getQueryKey(api.occupation.getCraftingQueue, undefined, "query"),
  );
  const timers = useQueryCacheUpdate<RouterOutputs["profile"]["getSidebarTimers"]>(
    getQueryKey(api.profile.getSidebarTimers, undefined, "query"),
  );
  /** Capture every view's revision before sending the craft. */
  const prepareCraftUpdate = () => ({
    inventory: prepareInventoryUpdate(),
    queue: queue.prepareUpdate(),
    timers: timers.prepareUpdate(),
  });
  const updateCraft = async (
    result: RouterOutputs["occupation"]["craftItem"],
    snapshot: ReturnType<typeof prepareCraftUpdate>,
  ) => {
    const update = result.success ? result.craftUpdate : undefined;
    await Promise.all([
      updateInventoryViews(
        {
          inventory: (rows) => getCraftedInventory(rows, update),
          variants: (rows) => getCraftedVariantInventory(rows, update),
        },
        snapshot.inventory,
      ),
      queue.updateCache((current) => getQueuedCrafts(current, update), snapshot.queue),
      timers.updateCache(
        (current) => getCraftingTimers(current, update),
        snapshot.timers,
      ),
    ]);
  };
  return { prepareCraftUpdate, updateCraft };
};
