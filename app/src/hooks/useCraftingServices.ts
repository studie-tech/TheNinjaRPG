import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
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
  const client = useQueryClient();
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
  const attempted = useRef<{
    client: QueryClient;
    terminal: string;
    revision: number;
  }>(undefined);
  const { dataUpdatedAt, isFetching } = query;
  useEffect(() => {
    if (!terminal || isFetching) return;
    let reconciliation = serviceReconciliations.get(client);
    if (!reconciliation) {
      reconciliation = { inFlight: new Set() };
      serviceReconciliations.set(client, reconciliation);
    }
    if (reconciliation.succeeded === terminal) return;
    const revision =
      client.getQueryState(
        getQueryKey(api.occupation.getServiceRequests, undefined, "query"),
      )?.dataUpdateCount ?? 0;
    // A failed attempt retries on the next receipt update or mount, never a callback rerender.
    if (
      attempted.current?.client === client &&
      attempted.current.terminal === terminal &&
      attempted.current.revision === revision
    )
      return;
    attempted.current = { client, terminal, revision };
    if (reconciliation.inFlight.has(terminal)) return;
    reconciliation.inFlight.add(terminal);
    void (async () => {
      // Profile settlement can start queued crafts and create inventory.
      const refreshed = await refreshUser();
      await Promise.all([
        invalidateInventory(),
        utils.profile.getSidebarTimers.invalidate(),
        utils.comments.getUserConversations.invalidate(),
      ]);
      if (refreshed) reconciliation.succeeded = terminal;
    })().finally(() => {
      reconciliation.inFlight.delete(terminal);
    });
  }, [
    client,
    terminal,
    dataUpdatedAt,
    isFetching,
    invalidateInventory,
    refreshUser,
    utils,
  ]);
  return query;
};

// Receipt cache data alone cannot establish that profile settlement succeeded. Keep
// that watermark across observers, scoped to the authenticated client's lifetime.
const serviceReconciliations = new WeakMap<
  QueryClient,
  { succeeded?: string; inFlight: Set<string> }
>();
