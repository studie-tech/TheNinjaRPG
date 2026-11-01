import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import type { UserItem } from "@/drizzle/schema";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

type InventoryUpdate = <T extends UserItem>(rows: T[]) => T[] | undefined;

const inventoryKey = getQueryKey(api.item.getUserItems, undefined, "query");
const variantsKey = getQueryKey(api.item.getUserItemsWithVariants, undefined, "query");

/** Reconcile the shared inventory views together, preserving each view's extra row data. */
export const useInventoryCacheUpdate = () => {
  const utils = api.useUtils();
  const inventory =
    useQueryCacheUpdate<RouterOutputs["item"]["getUserItems"]>(inventoryKey);
  const variants =
    useQueryCacheUpdate<RouterOutputs["item"]["getUserItemsWithVariants"]>(variantsKey);
  const prepareInventoryUpdate = () => ({
    inventory: inventory.prepareUpdate(),
    variants: variants.prepareUpdate(),
  });
  const updateInventory = async (
    update: InventoryUpdate | undefined,
    snapshot: ReturnType<typeof prepareInventoryUpdate>,
  ) => {
    await Promise.all([
      inventory.updateCache(update, snapshot.inventory),
      variants.updateCache(update, snapshot.variants),
    ]);
  };
  const invalidateInventory = async () => {
    await Promise.all([
      utils.item.getUserItems.invalidate(),
      utils.item.getUserItemsWithVariants.invalidate(),
    ]);
  };
  return { prepareInventoryUpdate, updateInventory, invalidateInventory };
};
