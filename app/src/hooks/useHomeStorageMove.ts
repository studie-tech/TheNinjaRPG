"use client";

import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getHomeStorageMergedInventory } from "@/deltas/item";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { showMutationToast } from "@/libs/toast";

type HomeStorageMoveResult = RouterOutputs["home"]["moveUserItems"];
type HomeStorageToggleResult = RouterOutputs["home"]["toggleStoreItem"];

/**
 * Store stacks in home storage or take them out, one or many per request, and reconcile both
 * inventory views. Confirmed stacks switch sides in the cache and join the stacks the server
 * merged them into; a refused move, a move whose stacks changed meanwhile, or a failed
 * request reads the inventory again.
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
            (rows) =>
              getHomeStorageMergedInventory(
                rows,
                moved,
                input.toHome,
                data.inventoryChanges,
              ),
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

/**
 * Store one stack at home or take it out, whichever side it is on, and reconcile both
 * inventory views as a bulk move does. A rejection leaves the caches alone so the player can
 * read the feedback and retry; a move that did not finish joining stacks reads them again.
 */
export const useHomeStorageToggle = ({
  onToggled,
}: {
  onToggled?: (result: HomeStorageToggleResult) => void;
} = {}) => {
  const { prepareInventoryUpdate, updateInventory, invalidateInventory } =
    useInventoryCacheUpdate();

  const { mutate, isPending } = api.home.toggleStoreItem.useMutation({
    onMutate: prepareInventoryUpdate,
    onSuccess: async (data, _input, snapshot) => {
      showMutationToast(data);
      onToggled?.(data);
      if (!data.success) return;
      const { movedUserItemIds: moved, storedAtHome } = data;
      await (moved && storedAtHome !== undefined
        ? updateInventory(
            (rows) =>
              getHomeStorageMergedInventory(
                rows,
                moved,
                storedAtHome,
                data.inventoryChanges,
              ),
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
    toggleStoreItem: (userItemId: string) => mutate({ userItemId }),
    isToggling: isPending,
  };
};
