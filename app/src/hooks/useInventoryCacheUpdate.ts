import { type InvalidateOptions, useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import type { UserItem } from "@/drizzle/schema";
import { useKessenCardMoves } from "@/hooks/kessen/useKessenHubCache";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import type { QueryCacheUpdate } from "@/utils/queryCache";

/** Preserve each view's row extensions; undefined requests authoritative reconciliation. */
type InventoryUpdate = <T extends UserItem>(rows: T[]) => T[] | undefined;

/**
 * Reconcile the shared inventory views together, preserving each view's extra row data.
 * Card stacks that leave or change also change the Card Hall's free copies, which
 * `reconcileCardMoves` reads again.
 */
export const useInventoryCacheUpdate = () => {
  const utils = api.useUtils();
  const client = useQueryClient();
  const { reconcileCardMoves } = useKessenCardMoves();
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
  /** Recover both views, optionally exposing active refetch failures to retrying controllers. */
  const invalidateInventory = async (options?: InvalidateOptions) => {
    await Promise.all([
      utils.item.getUserItems.invalidate(undefined, undefined, options),
      utils.item.getUserItemsWithVariants.invalidate(undefined, undefined, options),
    ]);
  };
  /** Item types of cached stacks, read when a mutation starts and before it removes them. */
  const cachedItemTypes = (userItemIds: readonly string[]) =>
    [
      ...(client.getQueryData<RouterOutputs["item"]["getUserItems"]>(inventoryKey) ??
        []),
      ...(client.getQueryData<RouterOutputs["item"]["getUserItemsWithVariants"]>(
        variantsKey,
      ) ?? []),
    ]
      .filter((row) => userItemIds.includes(row.id))
      .map((row) => row.item?.itemType);
  return {
    prepareInventoryUpdate,
    updateInventory,
    updateInventoryViews,
    invalidateInventory,
    cachedItemTypes,
    reconcileCardMoves,
  };
};
