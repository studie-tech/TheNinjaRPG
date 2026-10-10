"use client";

import type React from "react";
import { api } from "@/app/_trpc/client";
import LoadoutSelector from "@/layout/LoadoutSelector";
import { showMutationToast } from "@/libs/toast";
import { fedItemLoadouts } from "@/utils/paypal";
import { useRequiredUserData } from "@/utils/UserContext";

interface ItemLoadoutSelectorProps {
  size?: "small" | "large";
  label?: string;
  variant?: "sheet" | "dropdown";
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
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.item.getItemLoadouts.invalidate();
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
