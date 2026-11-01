"use client";

import { getQueryKey } from "@trpc/react-query";
import React from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getRenamedLoadouts } from "@/deltas/loadout";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import LoadoutSelector from "@/layout/LoadoutSelector";
import { showMutationToast } from "@/libs/toast";
import { fedJutsuLoadouts } from "@/utils/paypal";
import { useUserDataSelector } from "@/utils/UserContext";

const loadoutsKey = getQueryKey(api.jutsu.getLoadouts, undefined, "query");

interface JutsuLoadoutSelectorProps {
  size?: "small" | "large";
  label?: string;
  variant?: "sheet" | "dropdown";
  compact?: boolean;
  onSelectOverride?: (loadoutId: string, displayName: string) => void;
  selectedOverrideId?: string | null;
}

const JutsuLoadoutSelector: React.FC<JutsuLoadoutSelectorProps> = (props) => {
  // State
  const { data: availableSlots, prepareUserUpdate, updateUser } = useUserDataSelector(fedJutsuLoadouts);

  // tRPC utility
  const utils = api.useUtils();

  // How many loadouts?
  const maxLoadouts = availableSlots ?? 0;

  // Get loadouts
  const queryResult = api.jutsu.getLoadouts.useQuery(undefined, {
    enabled: maxLoadouts > 1,
  });
  const loadoutsCache =
    useQueryCacheUpdate<RouterOutputs["jutsu"]["getLoadouts"]>(loadoutsKey);

  // Mutations
  const mutationResult = api.jutsu.selectJutsuLoadout.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          updateUser(data, { revision }),
          utils.item.getUserItems.invalidate(),
          utils.jutsu.getUserJutsus.invalidate(),
        ]);
      }
    },
  });

  const renameResult = api.jutsu.renameLoadout.useMutation({
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
        maxLoadoutsFn: fedJutsuLoadouts,
        getSelectedId: (userData) => userData.jutsuLoadout,
      }}
    />
  );
};

export default React.memo(JutsuLoadoutSelector);
