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
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useUserData();
  const { prepareInventoryUpdate, updateInventory, invalidateInventory } =
    useInventoryCacheUpdate();
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
  /** Refresh the quote's owned inputs before allowing a rejected request to retry. */
  const refreshServiceOffer = async (crafterId: string, fortify: boolean) => {
    await Promise.all([
      utils.occupation.getServicePrices.invalidate({ crafterId }, undefined, {
        throwOnError: true,
      }),
      invalidateInventory({ throwOnError: true }),
      fortify
        ? utils.item.getFortifyEligibility.invalidate(undefined, undefined, {
            throwOnError: true,
          })
        : undefined,
    ]);
  };
  return { prepareServiceUpdate, updateService, refreshServiceOffer };
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
  const { refreshUser } = useUserData();
  const { reconcileServiceRequests } = useCraftingServiceReconciliation(refreshUser);
  const { data, dataUpdatedAt, isFetching } = query;
  useEffect(() => {
    if (!data || isFetching) return;
    void reconcileServiceRequests(data);
  }, [data, dataUpdatedAt, isFetching, reconcileServiceRequests]);
  return query;
};

/** Share confirmed settlement phases between service events and receipt polling. */
export const useCraftingServiceReconciliation = (
  refreshUser?: () => Promise<unknown>,
) => {
  const client = useQueryClient();
  const utils = api.useUtils();
  const { invalidateInventory } = useInventoryCacheUpdate();
  const reconciliation = getServiceReconciliation(client);
  const mountedGeneration = useRef(reconciliation.generation);
  const attempted = useRef<{
    client: QueryClient;
    signature: string;
    revision: number;
  }>(undefined);
  const reconcileServiceRequests = (
    data: RouterOutputs["occupation"]["getServiceRequests"],
  ): Promise<boolean> => {
    // An old open receipt can settle outside the bounded display history.
    const visible = new Set(data.map((row) => row.id));
    if ([...reconciliation.open].some((id) => !visible.has(id)))
      reconciliation.generation++;
    reconciliation.open = new Set(
      data
        .filter((row) => row.status === "PENDING" || row.status === "ACTIVE")
        .map((row) => row.id),
    );
    const terminal = data
      .filter((row) => row.status === "COMPLETED" || row.status === "REFUNDED")
      .map((row) => `${row.id}:${row.status}`)
      .sort()
      .join("|");
    const userId = client.getQueryData<RouterOutputs["profile"]["getUser"]>(
      getQueryKey(api.profile.getUser, undefined, "query"),
    )?.userData?.userId;
    const active = data
      .filter((row) => row.status === "ACTIVE" && row.crafterId === userId)
      .map((row) => row.id)
      .sort()
      .join("|");
    if (!terminal && !active && !reconciliation.generation)
      return Promise.resolve(false);
    const signature = `${terminal}|${active}|${reconciliation.generation}`;
    if (reconciliation.succeeded === signature) return Promise.resolve(true);
    const revision =
      client.getQueryState(
        getQueryKey(api.occupation.getServiceRequests, undefined, "query"),
      )?.dataUpdateCount ?? 0;
    const inFlight = reconciliation.inFlight.get(signature);
    if (inFlight) {
      attempted.current = { client, signature, revision };
      return inFlight;
    }
    // A mounted observer can first see an event's receipt after its work failed.
    // Only a new receipt revision or an observer mounted after that generation retries it.
    if (
      reconciliation.work?.signature === signature &&
      reconciliation.work.revision === revision &&
      mountedGeneration.current < reconciliation.generation
    ) {
      attempted.current = { client, signature, revision };
      return Promise.resolve(reconciliation.work.profile);
    }
    // A failed attempt retries on the next receipt update or mount, never a callback rerender.
    if (
      attempted.current?.client === client &&
      attempted.current.signature === signature &&
      attempted.current.revision === revision
    )
      return Promise.resolve(false);
    attempted.current = { client, signature, revision };
    const work =
      reconciliation.work?.signature === signature
        ? reconciliation.work
        : {
            signature,
            revision,
            profile: false,
            // The service inbox event's owner reconciles its notification and read acknowledgement.
            completed: new Set<string>(
              reconciliation.inFlight.has("event") ? ["conversations"] : [],
            ),
          };
    work.revision = revision;
    reconciliation.work = work;
    const pending = (async () => {
      // Profile settlement can start queued crafts and create inventory. Successful
      // phases survive a dependent failure, so a later poll retries only unfinished work.
      if (!work.profile) {
        if ((await refreshUser?.()) !== true) return false;
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
      return work.profile;
    })()
      .catch(() => {
        // Query error/loading UI owns failed reads; the next receipt poll retries them.
        return false;
      })
      .finally(() => {
        reconciliation.inFlight.delete(signature);
      });
    reconciliation.inFlight.set(signature, pending);
    return pending;
  };
  const refreshServiceViews = async () => {
    // A receipt read can settle a craft itself. Read it before confirming profile
    // settlement, and let mounted polling observers share the resulting phases.
    reconciliation.generation++;
    const pending = (async () => {
      await utils.occupation.getServiceRequests.invalidate();
      return reconcileServiceRequests(
        client.getQueryData<RouterOutputs["occupation"]["getServiceRequests"]>(
          getQueryKey(api.occupation.getServiceRequests, undefined, "query"),
        ) ?? [],
      );
    })();
    reconciliation.inFlight.set("event", pending);
    return pending.finally(() => {
      if (reconciliation.inFlight.get("event") === pending)
        reconciliation.inFlight.delete("event");
    });
  };
  return { reconcileServiceRequests, refreshServiceViews };
};

// Receipt cache data alone cannot establish that profile settlement succeeded. Keep
// that watermark across observers, scoped to the authenticated client's lifetime.
const serviceReconciliations = new WeakMap<
  QueryClient,
  {
    open: Set<string>;
    generation: number;
    succeeded?: string;
    inFlight: Map<string, Promise<boolean>>;
    work?: {
      signature: string;
      revision: number;
      profile: boolean;
      completed: Set<string>;
    };
  }
>();

const getServiceReconciliation = (client: QueryClient) => {
  let reconciliation = serviceReconciliations.get(client);
  if (!reconciliation) {
    reconciliation = { open: new Set(), generation: 0, inFlight: new Map() };
    serviceReconciliations.set(client, reconciliation);
  }
  return reconciliation;
};
