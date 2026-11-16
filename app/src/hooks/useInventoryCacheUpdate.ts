import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import type { UserItem } from "@/drizzle/schema";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import type { QueryCacheUpdate } from "@/utils/queryCache";

/** Preserve each view's row extensions; undefined requests authoritative reconciliation. */
type InventoryUpdate = <T extends UserItem>(rows: T[]) => T[] | undefined;

/** Reconcile the shared inventory views together, preserving each view's extra row data. */
export const useInventoryCacheUpdate = () => {
  const utils = api.useUtils();
  const inventoryKey = getQueryKey(api.item.getUserItems, undefined, "query");
  const variantsKey = getQueryKey(
    api.item.getUserItemsWithVariants,
    undefined,
    "query",
  );
  const inventory =
    useQueryCacheUpdate<RouterOutputs["item"]["getUserItems"]>(inventoryKey);
  const variants =
    useQueryCacheUpdate<RouterOutputs["item"]["getUserItemsWithVariants"]>(variantsKey);
  /** Capture both query revisions before sending the mutation. */
  const prepareInventoryUpdate = () => ({
    inventory: inventory.prepareUpdate(),
    variants: variants.prepareUpdate(),
  });
  /** Apply the confirmed change to each view, refetching missing or changed snapshots. */
  const updateInventory = async (
    update: InventoryUpdate | undefined,
    snapshot: ReturnType<typeof prepareInventoryUpdate>,
  ) => {
    await Promise.all([
      inventory.updateCache(update, snapshot.inventory),
      variants.updateCache(update, snapshot.variants),
    ]);
  };
  /** Apply view-specific projections, such as new stacks that only one view's relations describe. */
  const updateInventoryViews = async (
    updates: {
      inventory: QueryCacheUpdate<RouterOutputs["item"]["getUserItems"]> | undefined;
      variants:
        | QueryCacheUpdate<RouterOutputs["item"]["getUserItemsWithVariants"]>
        | undefined;
    },
    snapshot: ReturnType<typeof prepareInventoryUpdate>,
  ) => {
    await Promise.all([
      inventory.updateCache(updates.inventory, snapshot.inventory),
      variants.updateCache(updates.variants, snapshot.variants),
    ]);
  };
  /** Recover both views when a request may have failed after the server committed. */
  const invalidateInventory = async () => {
    await Promise.all([
      utils.item.getUserItems.invalidate(),
      utils.item.getUserItemsWithVariants.invalidate(),
    ]);
  };
  return {
    prepareInventoryUpdate,
    updateInventory,
    updateInventoryViews,
    invalidateInventory,
  };
};
