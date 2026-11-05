"use client";

import { getQueryKey } from "@trpc/react-query";
import React from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getRenamedLoadouts } from "@/deltas/loadout";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import LoadoutSelector, {
  type LoadoutSelectorDisplayProps,
} from "@/layout/LoadoutSelector";
import { showMutationToast } from "@/libs/toast";
import { fedJutsuLoadouts } from "@/utils/paypal";
import { useUserDataSelector } from "@/utils/UserContext";

const JutsuLoadoutSelector: React.FC<LoadoutSelectorDisplayProps> = (props) => {
  // State
  const {
    data: availableSlots,
    prepareUserUpdate,
    updateUser,
  } = useUserDataSelector(fedJutsuLoadouts);

  // tRPC utility
  const utils = api.useUtils();

  // How many loadouts?
  const maxLoadouts = availableSlots ?? 0;

  // Get loadouts
  const queryResult = api.jutsu.getLoadouts.useQuery(undefined, {
    enabled: maxLoadouts > 1,
  });
  const loadoutsKey = getQueryKey(api.jutsu.getLoadouts, undefined, "query");
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
        query: queryResult,
        selectMutation: mutationResult,
        renameMutation: renameResult,
        maxLoadoutsFn: fedJutsuLoadouts,
        getSelectedId: (userData) => userData.jutsuLoadout,
      }}
    />
  );
};

export default React.memo(JutsuLoadoutSelector);
