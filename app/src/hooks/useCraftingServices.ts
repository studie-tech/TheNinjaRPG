import { getQueryKey } from "@trpc/react-query";
import { useEffect, useRef } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import {
  getServiceRequesterPatch,
  getServiceSubmissionUnchanged,
  getServiceSubmittedInventory,
  getSubmittedServiceRequests,
} from "@/deltas/craftingServices";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { useUserData } from "@/utils/UserContext";

/** Reconcile receipt-driven inventory, profile progression and timers after service mutations. */
export const useCraftingServiceCache = () => {
  const { prepareUserUpdate, updateUser } = useUserData();
  const { prepareInventoryUpdate, updateInventory } = useInventoryCacheUpdate();
  const requests = useQueryCacheUpdate<
    RouterOutputs["occupation"]["getServiceRequests"]
  >(getQueryKey(api.occupation.getServiceRequests, undefined, "query"));
  const queue = useQueryCacheUpdate<RouterOutputs["occupation"]["getCraftingQueue"]>(
    getQueryKey(api.occupation.getCraftingQueue, undefined, "query"),
  );
  const timers = useQueryCacheUpdate<RouterOutputs["profile"]["getSidebarTimers"]>(
    getQueryKey(api.profile.getSidebarTimers, undefined, "query"),
  );
  const prepareServiceUpdate = () => ({
    user: prepareUserUpdate(),
    inventory: prepareInventoryUpdate(),
    requests: requests.prepareUpdate(),
    queue: queue.prepareUpdate(),
    timers: timers.prepareUpdate(),
  });
  const updateService = async (
    result:
      | RouterOutputs["occupation"]["submitServiceRequest"]
      | RouterOutputs["occupation"]["respondToServiceRequest"],
    snapshot: ReturnType<typeof prepareServiceUpdate>,
  ) => {
    if (!result.success) return;
    const update = "serviceUpdate" in result ? result.serviceUpdate : undefined;
    // Profile reconciliation can start queued crafts and create inventory. Dependent
    // reads must observe that settlement, and only an accepted profile projection
    // makes the response's dependent projections safe to apply.
    const userUpdated = await updateUser(
      (current) => getServiceRequesterPatch(current, update),
      { revision: snapshot.user, delta: update?.userDelta },
    );
    const dependentUpdate = userUpdated ? update : undefined;
    await Promise.all([
      updateInventory(
        (rows) => getServiceSubmittedInventory(rows, dependentUpdate),
        snapshot.inventory,
      ),
      requests.updateCache(
        (current) => getSubmittedServiceRequests(current, dependentUpdate),
        snapshot.requests,
      ),
      timers.updateCache(
        (current) => getServiceSubmissionUnchanged(current, dependentUpdate),
        snapshot.timers,
      ),
      queue.updateCache(
        (current) => getServiceSubmissionUnchanged(current, dependentUpdate),
        snapshot.queue,
      ),
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
  const terminal = (query.data ?? [])
    .filter((row) => row.status === "COMPLETED" || row.status === "REFUNDED")
    .map((row) => `${row.id}:${row.status}`)
    .sort()
    .join("|");
  const observed = useRef(terminal);
  useEffect(() => {
    if (!terminal || observed.current === terminal) return;
    observed.current = terminal;
    void (async () => {
      // Profile settlement can start queued crafts and create inventory.
      await refreshUser();
      await Promise.all([
        invalidateInventory(),
        utils.profile.getSidebarTimers.invalidate(),
        utils.comments.getUserConversations.invalidate(),
      ]);
    })();
  }, [terminal, invalidateInventory, refreshUser, utils]);
  return query;
};
