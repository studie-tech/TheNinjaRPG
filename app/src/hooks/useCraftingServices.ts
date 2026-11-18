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
  const { refreshUser, data: userData } = useUserData();
  const { invalidateInventory } = useInventoryCacheUpdate();
  const terminal = (query.data ?? [])
    .filter((row) => row.status === "COMPLETED" || row.status === "REFUNDED")
    .map((row) => `${row.id}:${row.status}`)
    .sort()
    .join("|");
  const active = (query.data ?? [])
    .filter((row) => row.status === "ACTIVE" && row.crafterId === userData?.userId)
    .map((row) => row.id)
    .sort()
    .join("|");
  const attempted = useRef<{
    client: QueryClient;
    signature: string;
    revision: number;
  }>(undefined);
  const { data, dataUpdatedAt, isFetching } = query;
  useEffect(() => {
    if (!data || isFetching) return;
    let reconciliation = serviceReconciliations.get(client);
    if (!reconciliation) {
      reconciliation = { open: new Set(), generation: 0, inFlight: new Set() };
      serviceReconciliations.set(client, reconciliation);
    }
    // An old open receipt can settle outside the bounded display history.
    const visible = new Set(data.map((row) => row.id));
    if ([...reconciliation.open].some((id) => !visible.has(id)))
      reconciliation.generation++;
    reconciliation.open = new Set(
      data
        .filter((row) => row.status === "PENDING" || row.status === "ACTIVE")
        .map((row) => row.id),
    );
    if (!terminal && !active && !reconciliation.generation) return;
    const signature = `${terminal}|${active}|${reconciliation.generation}`;
    if (reconciliation.succeeded === signature) return;
    const revision =
      client.getQueryState(
        getQueryKey(api.occupation.getServiceRequests, undefined, "query"),
      )?.dataUpdateCount ?? 0;
    // A failed attempt retries on the next receipt update or mount, never a callback rerender.
    if (
      attempted.current?.client === client &&
      attempted.current.signature === signature &&
      attempted.current.revision === revision
    )
      return;
    attempted.current = { client, signature, revision };
    if (reconciliation.inFlight.has(signature)) return;
    reconciliation.inFlight.add(signature);
    const work =
      reconciliation.work?.signature === signature
        ? reconciliation.work
        : {
            signature,
            profile: false,
            completed: new Set<string>(),
          };
    reconciliation.work = work;
    void (async () => {
      // Profile settlement can start queued crafts and create inventory. Successful
      // phases survive a dependent failure, so a later poll retries only unfinished work.
      if (!work.profile) {
        if (!(await refreshUser())) return;
        work.profile = true;
      }
      const queue = work.completed.has("queue")
        ? Promise.resolve()
        : utils.occupation.getCraftingQueue
            .invalidate(undefined, undefined, { throwOnError: true })
            .then(() => {
              work.completed.add("queue");
            });
      const reads = [
        [
          "inventory",
          async () => {
            // Queue settlement may create output after the profile's captured time.
            await queue;
            await invalidateInventory({ throwOnError: true });
          },
        ],
        ["queue", () => queue],
        [
          "timers",
          () =>
            utils.profile.getSidebarTimers.invalidate(undefined, undefined, {
              throwOnError: true,
            }),
        ],
        [
          "conversations",
          () =>
            utils.comments.getUserConversations.invalidate(undefined, undefined, {
              throwOnError: true,
            }),
        ],
      ] as const;
      await Promise.allSettled(
        reads.map(async ([name, read]) => {
          if (work.completed.has(name)) return;
          await read();
          work.completed.add(name);
        }),
      );
      if (work.completed.size === reads.length && reconciliation.work === work)
        reconciliation.succeeded = signature;
    })()
      .catch(() => {
        // Query error/loading UI owns failed reads; the next receipt poll retries them.
      })
      .finally(() => {
        reconciliation.inFlight.delete(signature);
      });
  }, [
    client,
    data,
    terminal,
    active,
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
  {
    open: Set<string>;
    generation: number;
    succeeded?: string;
    inFlight: Set<string>;
    work?: { signature: string; profile: boolean; completed: Set<string> };
  }
>();
