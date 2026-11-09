"use client";

import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getHomeStorageMovedInventory } from "@/deltas/item";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { showMutationToast } from "@/libs/toast";

type HomeStorageMoveResult = RouterOutputs["home"]["moveUserItems"];

/**
 * Store stacks in home storage or take them out, one or many per request, and reconcile both
 * inventory views. Confirmed stacks switch sides in the cache; a refused move, a move whose
 * stacks changed meanwhile, or a failed request reads the inventory again.
 */
export const useHomeStorageMove = ({
  onMoved,
}: {
  onMoved?: (result: HomeStorageMoveResult) => void;
} = {}) => {
  const { prepareInventoryUpdate, updateInventory, invalidateInventory } =
    useInventoryCacheUpdate();

  const { mutate, isPending } = api.home.moveUserItems.useMutation({
    onMutate: prepareInventoryUpdate,
    onSuccess: async (data, input, snapshot) => {
      showMutationToast(data);
      onMoved?.(data);
      // Refused stacks may have changed elsewhere, even when other stacks moved.
      if (!data.success || data.refused.length > 0) {
        await invalidateInventory();
        return;
      }
      const moved = data.movedUserItemIds;
      await (moved
        ? updateInventory(
            (rows) => getHomeStorageMovedInventory(rows, moved, input.toHome),
            snapshot,
          )
        : invalidateInventory());
    },
    onError: async (error) => {
      showMutationToast({
        success: false,
        message: error.message,
        variant: "destructive",
      });
      await invalidateInventory();
    },
  });

  return {
    moveItems: (userItemIds: string[], toHome: boolean) =>
      mutate({ userItemIds, toHome }),
    isMoving: isPending,
  };
};
