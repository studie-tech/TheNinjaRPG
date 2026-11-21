import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { getFortifiedInventory, getFortifiedUserPatch } from "@/deltas/fortify";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useRequiredUserInfo } from "@/utils/UserContext";

/** Bind attempts to captured inventory/profile revisions and reconcile only confirmed writes. */
export const useFortify = (onMessage: (message: string) => void) => {
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useRequiredUserInfo();
  const { prepareInventoryUpdate, updateInventory, invalidateInventory } =
    useInventoryCacheUpdate();
  const mutation = api.item.fortify.useMutation({
    onMutate: () => ({
      user: prepareUserUpdate(),
      inventory: prepareInventoryUpdate(),
    }),
    onSuccess: async (result, _input, snapshot) => {
      onMessage(result.message);
      if (!result.success) {
        setNeedsRefresh(true);
        return;
      }
      const update = result.fortifyUpdate;
      const applied = await updateUser((user) => getFortifiedUserPatch(user, update), {
        revision: snapshot.user,
        delta: { money: -update.cost },
      });
      await updateInventory(
        applied ? (rows) => getFortifiedInventory(rows, update) : undefined,
        snapshot.inventory,
      );
    },
    onError: (error) => {
      onMessage(error.message);
      setNeedsRefresh(true);
    },
  });
  const refresh = async () => {
    setIsRefreshing(true);
    try {
      const [confirmed] = await Promise.all([
        updateUser(undefined),
        invalidateInventory({ throwOnError: true }),
        utils.item.getFortifyEligibility.invalidate(undefined, undefined, {
          throwOnError: true,
        }),
      ]);
      if (!confirmed) {
        onMessage("Could not confirm your balance. Please retry the refresh.");
      } else {
        setNeedsRefresh(false);
        onMessage(
          "Item and balance refreshed. Check the quote before another attempt.",
        );
      }
    } catch {
      onMessage("Could not refresh. Please retry.");
    }
    setIsRefreshing(false);
  };
  return { ...mutation, needsRefresh, isRefreshing, refresh };
};
