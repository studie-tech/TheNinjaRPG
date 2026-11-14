"use client";

import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getBulkSoldInventory } from "@/deltas/item";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserInfo } from "@/utils/UserContext";

type BulkSellResult = RouterOutputs["item"]["sellUserItems"];

/**
 * Sell or drop several backpack stacks in one request and reconcile the inventory and ryo.
 * Removed stacks leave the cached inventory and their ryo is credited; when any stack stayed
 * because it changed meanwhile, the inventory is read again instead. Unconfirmed sales
 * also require an authoritative profile read because their proceeds are unknown.
 */
export const useBulkSellItems = ({
  onSold,
  onSettled,
}: {
  onSold: (result: BulkSellResult) => void;
  onSettled: () => void;
}) => {
  const { prepareUserUpdate, updateUser } = useRequiredUserInfo();
  const { prepareInventoryUpdate, updateInventory, invalidateInventory } =
    useInventoryCacheUpdate();

  const { mutate, isPending } = api.item.sellUserItems.useMutation({
    onMutate: () => ({
      inventory: prepareInventoryUpdate(),
      userRevision: prepareUserUpdate(),
    }),
    onSuccess: async (data, _input, context) => {
      showMutationToast(data);
      onSold(data);
      const sold = data.soldUserItemIds;
      await Promise.all([
        data.refused.length > 0
          ? invalidateInventory()
          : updateInventory(
              (rows) => getBulkSoldInventory(rows, sold),
              context.inventory,
            ),
        data.userDelta === undefined
          ? updateUser(undefined)
          : sold.length > 0
            ? updateUser(data, { revision: context.userRevision })
            : undefined,
      ]);
    },
    onError: async (error) => {
      // Stacks may have been removed before the error; read inventory and ryo again.
      showMutationToast({
        success: false,
        message: error.message,
        variant: "destructive",
      });
      await Promise.all([invalidateInventory(), updateUser(undefined)]);
    },
    onSettled,
  });

  return {
    sellMany: (userItemIds: string[]) => mutate({ userItemIds }),
    isSelling: isPending,
  };
};
