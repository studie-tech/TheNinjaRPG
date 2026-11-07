"use client";

import { getQueryKey } from "@trpc/react-query";
import React from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getEquippedInventory } from "@/deltas/item";
import { getRenamedLoadouts } from "@/deltas/loadout";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import LoadoutSelector, {
  type LoadoutSelectorDisplayProps,
} from "@/layout/LoadoutSelector";
import { showMutationToast } from "@/libs/toast";
import { fedItemLoadouts } from "@/utils/paypal";
import { useUserDataSelector } from "@/utils/UserContext";

/** Select or rename an item loadout and reconcile its profile, equipment and inventory caches. */
const ItemLoadoutSelector: React.FC<LoadoutSelectorDisplayProps> = (props) => {
  // State
  const {
    data: availableSlots,
    prepareUserUpdate,
    updateUser,
  } = useUserDataSelector(fedItemLoadouts);

  const { prepareInventoryUpdate, updateInventory } = useInventoryCacheUpdate();

  // How many loadouts?
  const maxLoadouts = availableSlots ?? 0;

  // Get loadouts
  const queryResult = api.item.getItemLoadouts.useQuery(undefined, {
    enabled: maxLoadouts > 1,
  });
  const loadoutsKey = getQueryKey(api.item.getItemLoadouts, undefined, "query");
  const loadoutsCache =
    useQueryCacheUpdate<RouterOutputs["item"]["getItemLoadouts"]>(loadoutsKey);

  // Mutations
  const mutationResult = api.item.selectItemLoadout.useMutation({
    onMutate: () => ({
      revision: prepareUserUpdate(),
      inventory: prepareInventoryUpdate(),
    }),
    onSuccess: async (data, _variables, context) => {
      showMutationToast(data);
      if (data.success) {
        const profileApplied = await updateUser(data, { revision: context.revision });
        await updateInventory(
          profileApplied
            ? (rows) => getEquippedInventory(rows, data.equipmentChanges)
            : undefined,
          context.inventory,
        );
      }
    },
  });

  const renameResult = api.item.renameLoadout.useMutation({
    onMutate: loadoutsCache.prepareUpdate,
    onSuccess: async (data, input, snapshot) => {
      showMutationToast(data);
      if (data.success) {
        await loadoutsCache.updateCache(
          (current) => getRenamedLoadouts(current, input),
          snapshot,
        );
      }
    },
  });

  return (
    <LoadoutSelector
      {...props}
      config={{
        query: queryResult,
        selectMutation: mutationResult,
        renameMutation: renameResult,
        maxLoadoutsFn: fedItemLoadouts,
        getSelectedId: (userData) => userData.itemLoadout,
      }}
    />
  );
};

export default React.memo(ItemLoadoutSelector);
