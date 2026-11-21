"use client";

import { useState } from "react";
import { api, type RouterInputs } from "@/app/_trpc/client";
import { getInventoryQuantities } from "@/deltas/item";
import { useAdministrationBuildingCacheUpdate } from "@/hooks/useAdministrationBuildingCacheUpdate";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useRequiredUserInfo } from "@/utils/UserContext";

/** Bind a daily submission to the inventory and profile revisions captured at confirmation. */
export const useSupplyRequest = () => {
  const { invalidateStock } = useAdministrationBuildingCacheUpdate();
  const { prepareUserUpdate, updateUser } = useRequiredUserInfo();
  const inventory = useInventoryCacheUpdate();
  const [result, setResult] = useState<{ success: boolean; message: string }>();
  const request = api.occupation.getSupplyRequest.useQuery(undefined, {
    refetchOnMount: "always",
  });
  const submission = api.occupation.submitSupplyRequest.useMutation({
    onMutate: () => {
      setResult(undefined);
      return {
        user: prepareUserUpdate(),
        inventory: inventory.prepareInventoryUpdate(),
      };
    },
    onSuccess: async (data, _input, snapshot) => {
      setResult(data);
      if (data.success) {
        await Promise.all([
          updateUser(data, { revision: snapshot.user }),
          inventory.updateInventory(
            (rows) => getInventoryQuantities(rows, data.inventoryChanges),
            snapshot.inventory,
          ),
        ]);
      }
      await invalidateStock();
    },
    onError: async (error) => {
      setResult({ success: false, message: error.message });
      // A lost response may follow a committed payment; recover all affected views.
      await Promise.all([
        updateUser(undefined),
        inventory.invalidateInventory(),
        invalidateStock(),
      ]);
    },
  });
  return {
    request,
    result,
    isSubmitting: submission.isPending,
    submit: (input: RouterInputs["occupation"]["submitSupplyRequest"]) =>
      submission.mutate(input),
  };
};
