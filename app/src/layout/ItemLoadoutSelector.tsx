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
  onSelectOverride?: (loadoutId: string) => void;
  selectedOverrideId?: string | null;
}

const ItemLoadoutSelector: React.FC<ItemLoadoutSelectorProps> = (props) => {
  // State
  const { data: userData } = useRequiredUserData();

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
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
        await utils.item.getUserItems.invalidate();
      }
    },
  });

  return (
    <LoadoutSelector
      {...props}
      config={{
        loadoutType: "item",
        getQuery: () => queryResult,
        selectMutation: () => mutationResult,
        maxLoadoutsFn: fedItemLoadouts,
        getSelectedId: (userData) => userData.itemLoadout,
        invalidateQueries: async () => {
          await utils.profile.getUser.invalidate();
          await utils.item.getUserItems.invalidate();
        },
      }}
    />
  );
};

export default ItemLoadoutSelector;
