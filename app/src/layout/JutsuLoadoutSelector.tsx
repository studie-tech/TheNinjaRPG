"use client";

import type React from "react";
import { api } from "@/app/_trpc/client";
import LoadoutSelector from "@/layout/LoadoutSelector";
import { showMutationToast } from "@/libs/toast";
import { fedJutsuLoadouts } from "@/utils/paypal";
import { useRequiredUserData } from "@/utils/UserContext";

interface JutsuLoadoutSelectorProps {
  size?: "small" | "large";
  label?: string;
  onSelectOverride?: (loadoutId: string) => void;
  selectedOverrideId?: string | null;
}

const JutsuLoadoutSelector: React.FC<JutsuLoadoutSelectorProps> = (props) => {
  // State
  const { data: userData } = useRequiredUserData();

  // tRPC utility
  const utils = api.useUtils();

  // How many loadouts?
  const maxLoadouts = userData ? fedJutsuLoadouts(userData) : 0;

  // Get loadouts
  const queryResult = api.jutsu.getLoadouts.useQuery(undefined, {
    enabled: maxLoadouts > 1,
  });

  // Mutations
  const mutationResult = api.jutsu.selectJutsuLoadout.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await utils.profile.getUser.invalidate();
        await utils.item.getUserItems.invalidate();
        await utils.jutsu.getUserJutsus.invalidate();
      }
    },
  });

  return (
    <LoadoutSelector
      {...props}
      config={{
        getQuery: () => queryResult,
        selectMutation: () => mutationResult,
        maxLoadoutsFn: fedJutsuLoadouts,
        getSelectedId: (userData) => userData.jutsuLoadout,
      }}
    />
  );
};

export default JutsuLoadoutSelector;
