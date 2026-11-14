"use client";

import { getQueryKey } from "@trpc/react-query";
import { useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getCosmeticConsumedInventory, getCosmeticSlots } from "@/deltas/cosmetic";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserInfo } from "@/utils/UserContext";

/** Bind wardrobe writes to captured inventory, wardrobe and profile revisions. */
export const useCosmetics = () => {
  const wardrobe = api.cosmetic.get.useQuery();
  const [error, setError] = useState<string | null>(null);
  const utils = api.useUtils();
  const cache = useQueryCacheUpdate<RouterOutputs["cosmetic"]["get"]>(
    getQueryKey(api.cosmetic.get, undefined, "query"),
  );
  const inventory = useInventoryCacheUpdate();
  const { prepareUserUpdate, updateUser } = useRequiredUserInfo();
  const make = api.cosmetic.make.useMutation({
    onMutate: () => {
      setError(null);
      return inventory.prepareInventoryUpdate();
    },
    onSuccess: async (data, input, snapshot) => {
      showMutationToast(data);
      if (!data.success) {
        setError(data.message);
        await Promise.all([
          inventory.invalidateInventory(),
          utils.cosmetic.get.invalidate(),
        ]);
        return;
      }
      if ("quantity" in data)
        await inventory.updateInventory(
          (rows) =>
            getCosmeticConsumedInventory(
              rows,
              input.userItemId,
              input.expectedQuantity,
              data.quantity,
            ),
          snapshot,
        );
      await utils.cosmetic.get.invalidate();
    },
    onError: async (error) => {
      setError(error.message);
      await Promise.all([
        inventory.invalidateInventory(),
        utils.cosmetic.get.invalidate(),
      ]);
    },
  });
  const select = api.cosmetic.select.useMutation({
    onMutate: () => {
      setError(null);
      return {
        wardrobe: cache.prepareUpdate(),
        user: prepareUserUpdate(),
        data: wardrobe.data,
      };
    },
    onSuccess: async (data, input, snapshot) => {
      if (!data.success) {
        setError(data.message);
        return;
      }
      const slots =
        snapshot.data &&
        getCosmeticSlots(snapshot.data.slots, snapshot.data.owned, {
          ...input,
          variantId: input.variantId ?? null,
        });
      await Promise.all([
        cache.updateCache(
          (old) => (slots ? { ...old, slots } : undefined),
          snapshot.wardrobe,
        ),
        updateUser(slots ? { cosmeticSlots: slots } : undefined, {
          revision: snapshot.user,
        }),
      ]);
    },
    onError: async (error) => {
      setError(error.message);
      await Promise.all([utils.cosmetic.get.invalidate(), updateUser(undefined)]);
    },
  });
  const refreshWardrobe = () => utils.cosmetic.get.invalidate();
  return { wardrobe, make, select, error, refreshWardrobe };
};
