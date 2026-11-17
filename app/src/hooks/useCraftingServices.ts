import { getQueryKey } from "@trpc/react-query";
import { useEffect, useRef } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { useUserData } from "@/utils/UserContext";

/** Reconcile receipt-driven inventory, profile progression and timers after service mutations. */
export const useCraftingServiceCache = () => {
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useUserData();
  const { prepareInventoryUpdate, updateInventory } = useInventoryCacheUpdate();
  const requests = useQueryCacheUpdate<
    RouterOutputs["occupation"]["getServiceRequests"]
  >(getQueryKey(api.occupation.getServiceRequests, undefined, "query"));
  const prepareServiceUpdate = () => ({
    user: prepareUserUpdate(),
    inventory: prepareInventoryUpdate(),
    requests: requests.prepareUpdate(),
  });
  const updateService = async (
    result: { success: boolean },
    snapshot: ReturnType<typeof prepareServiceUpdate>,
  ) => {
    if (!result.success) return;
    // Server settlement may deliver other due receipts and apply quest consequences;
    // their resulting rows are intentionally withheld for authoritative reconciliation.
    await Promise.all([
      updateUser(undefined, { revision: snapshot.user }),
      updateInventory(undefined, snapshot.inventory),
      requests.updateCache(undefined, snapshot.requests),
      utils.profile.getSidebarTimers.invalidate(),
      utils.occupation.getCraftingQueue.invalidate(),
    ]);
  };
  return { prepareServiceUpdate, updateService };
};

/** Bind price edits to the captured crafter key even when a profile selection changes. */
export const useCraftingServicePriceCache = (crafterId: string) => {
  const prices = useQueryCacheUpdate<RouterOutputs["occupation"]["getServicePrices"]>(
    getQueryKey(api.occupation.getServicePrices, { crafterId }, "query"),
  );
  return prices;
};

/** Reconcile deliveries observed by polling, including completion performed by another reader. */
export const useServiceRequests = () => {
  const query = api.occupation.getServiceRequests.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const utils = api.useUtils();
  const { refreshUser } = useUserData();
  const { invalidateInventory } = useInventoryCacheUpdate();
  const observed = useRef("");
  const terminal = (query.data ?? [])
    .filter((row) => row.status === "COMPLETED" || row.status === "REFUNDED")
    .map((row) => `${row.id}:${row.status}`)
    .sort()
    .join("|");
  useEffect(() => {
    if (!terminal || observed.current === terminal) return;
    observed.current = terminal;
    void Promise.all([
      invalidateInventory(),
      refreshUser(),
      utils.profile.getSidebarTimers.invalidate(),
      utils.comments.getUserConversations.invalidate(),
    ]);
  }, [terminal, invalidateInventory, refreshUser, utils]);
  return query;
};
