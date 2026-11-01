"use client";

import { getQueryKey } from "@trpc/react-query";
import type React from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getRenamedLoadouts } from "@/deltas/loadout";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import LoadoutSelector from "@/layout/LoadoutSelector";
import { showMutationToast } from "@/libs/toast";
import { fedItemLoadouts } from "@/utils/paypal";
import { useRequiredUserData } from "@/utils/UserContext";

const loadoutsKey = getQueryKey(api.item.getItemLoadouts, undefined, "query");

interface ItemLoadoutSelectorProps {
  size?: "small" | "large";
  label?: string;
  variant?: "sheet" | "dropdown";
  compact?: boolean;
  onSelectOverride?: (loadoutId: string, displayName: string) => void;
  selectedOverrideId?: string | null;
}

const ItemLoadoutSelector: React.FC<ItemLoadoutSelectorProps> = (props) => {
  // State
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();

  // tRPC utility
  const utils = api.useUtils();

  // How many loadouts?
  const maxLoadouts = userData ? fedItemLoadouts(userData) : 0;

  // Get loadouts
  const queryResult = api.item.getItemLoadouts.useQuery(undefined, {
    enabled: maxLoadouts > 1,
  });
  const loadoutsCache =
    useQueryCacheUpdate<RouterOutputs["item"]["getItemLoadouts"]>(loadoutsKey);

  // Mutations
  const mutationResult = api.item.selectItemLoadout.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          updateUser(data.userPatch, { revision }),
          utils.item.getUserItems.invalidate(),
          utils.item.getUserItemsWithVariants.invalidate(),
        ]);
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
        getQuery: () => queryResult,
        selectMutation: () => mutationResult,
        renameMutation: () => renameResult,
        maxLoadoutsFn: fedItemLoadouts,
        getSelectedId: (userData) => userData.itemLoadout,
      }}
    />
  );
};

export default ItemLoadoutSelector;
