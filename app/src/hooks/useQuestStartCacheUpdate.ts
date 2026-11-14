import type { Query, QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getInventoryQuantities } from "@/deltas/item";
import {
  getQuestStartDiscoveryUpdate,
  getQuestStartUpcomingUpdate,
  getReopenedQuestIds,
} from "@/deltas/quests";
import { MasteryNames } from "@/drizzle/constants";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { trpcPathFromKey } from "@/libs/queryTelemetry";
import { prepareQueryUpdate, updateQueryCache } from "@/utils/queryCache";
import { periodStart } from "@/utils/time";

/** Reconcile quest discovery and both inventory views after profile settlement. */
export const useQuestStartCacheUpdate = () => {
  const client = useQueryClient();
  const inventory = useInventoryCacheUpdate();
  /** Capture inventory, discovery listings and the profile eligibility baseline before starting. */
  const prepareQuestStartUpdate = () => ({
    periodStartAt: periodStart("daily", new Date()).getTime(),
    inventory: inventory.prepareInventoryUpdate(),
    discovery: captureDiscovery(client),
    user: readProfile(client),
  });
  /**
   * Patch the discovery listings that are current with the profile from the settled start.
   * Unconfirmed starts and listings that may predate an eligibility change refetch.
   */
  const updateQuestStart = async (
    result:
      | RouterOutputs["quests"]["startQuest"]
      | RouterOutputs["quests"]["startRandom"]
      | undefined,
    snapshot: ReturnType<typeof prepareQuestStartUpdate>,
    profileApplied: boolean,
  ) => {
    const confirmed = result?.success && profileApplied ? result : undefined;
    const user = confirmed ? readProfile(client) : undefined;
    const profileRevision = prepareQueryUpdate(client, profileKey());
    // A new quest period can open candidates absent from the captured listings.
    const isCurrentPeriod =
      snapshot.periodStartAt === periodStart("daily", new Date()).getTime();
    // Starting a quest can finish mastery training and unlock absent candidates.
    const hasSameMasteries = MasteryNames.every(
      (stat) => snapshot.user?.[stat] === user?.[stat],
    );
    const reopened = user
      ? getReopenedQuestIds(snapshot.user?.completedQuests ?? [], user.completedQuests)
      : [];
    await Promise.all([
      inventory.updateInventory(
        confirmed
          ? (rows) => getInventoryQuantities(rows, confirmed.inventoryChanges)
          : undefined,
        snapshot.inventory,
      ),
      ...discoveryListings().flatMap(({ key, upcoming }) =>
        client
          .getQueryCache()
          .findAll({ queryKey: key })
          .map((query) => {
            const { queryKey, queryHash } = query;
            const captured = snapshot.discovery.get(queryHash);
            const settled =
              captured?.current && isCurrentPeriod && hasSameMasteries
                ? user
                : undefined;
            const options = { revision: captured?.revision };
            const update = upcoming
              ? updateQueryCache<RouterOutputs["quests"]["upcomingQuests"]>(
                  client,
                  queryKey,
                  settled
                    ? (rows) => getQuestStartUpcomingUpdate(rows, reopened)
                    : undefined,
                  options,
                )
              : updateQueryCache<DiscoveryRow[]>(
                  client,
                  queryKey,
                  settled
                    ? (rows) =>
                        getQuestStartDiscoveryUpdate(
                          rows,
                          settled.userQuests,
                          reopened,
                          confirmed?.inventoryChanges,
                        )
                    : undefined,
                  options,
                );
            return update.then((applied) => {
              if (
                applied &&
                query.state.fetchStatus === "idle" &&
                query.state.dataUpdateCount === (captured?.revision ?? -1) + 1
              )
                discoveryReads.get(client)?.set(query, {
                  profileRevision,
                  periodStartAt: snapshot.periodStartAt,
                  listingRevision: query.state.dataUpdateCount,
                });
            });
          }),
      ),
    ]);
  };
  return { prepareQuestStartUpdate, updateQuestStart };
};

/** Listings filtered by the player's quest availability, across all of their inputs. */
const discoveryProcedures = [
  "missionHall",
  "specificQuests",
  "upcomingQuests",
] as const;
const discoveryListings = () =>
  discoveryProcedures.map((name) => ({
    key: getQueryKey(api.quests[name], undefined, "query"),
    upcoming: name === "upcomingQuests",
  }));

/** The cached profile; after updateUser resolves it holds the settled start. */
const readProfile = (client: QueryClient) =>
  client.getQueryData<RouterOutputs["profile"]["getUser"]>(profileKey())?.userData ??
  undefined;

const profileKey = () => getQueryKey(api.profile.getUser, undefined, "query");

const discoveryReads = new WeakMap<QueryClient, WeakMap<Query, DiscoveryRead>>();

/**
 * Record discovery's profile baseline at fetch start for this client's lifetime. A read
 * finishing after a profile change can still contain its earlier eligibility snapshot.
 */
export const trackQuestDiscoveryReads = (client: QueryClient) => {
  if (discoveryReads.has(client)) return;
  const reads = new WeakMap<Query, DiscoveryRead>();
  discoveryReads.set(client, reads);
  client.getQueryCache().subscribe((event) => {
    const path = trpcPathFromKey(event.query.queryKey);
    if (
      event.type !== "updated" ||
      !discoveryProcedures.some((name) => path === `quests.${name}`)
    )
      return;
    if (event.action.type === "fetch")
      reads.set(event.query, {
        profileRevision: prepareQueryUpdate(client, profileKey()),
        periodStartAt: periodStart("daily", new Date()).getTime(),
      });
    else if (
      event.action.type === "error" ||
      (event.action.type === "success" && event.action.manual)
    )
      reads.delete(event.query);
    else if (event.action.type === "success") {
      // Canceled reads can silently restore older rows; only a completed fetch has provenance.
      const read = reads.get(event.query);
      if (read)
        reads.set(event.query, {
          ...read,
          listingRevision: event.query.state.dataUpdateCount,
        });
    }
  });
};

/**
 * Capture listings read against the unchanged profile in today's quest period. Untracked
 * hydrated/manual data cannot establish its eligibility baseline and needs reconciliation.
 */
const captureDiscovery = (client: QueryClient) => {
  const profileRevision = prepareQueryUpdate(client, profileKey());
  const today = periodStart("daily", new Date()).getTime();
  const captured = new Map<
    string,
    { revision: number | undefined; current: boolean }
  >();
  for (const { key } of discoveryListings())
    for (const query of client.getQueryCache().findAll({ queryKey: key })) {
      const read = discoveryReads.get(client)?.get(query);
      captured.set(query.queryHash, {
        revision: prepareQueryUpdate(client, query.queryKey),
        current:
          profileRevision !== undefined &&
          read?.profileRevision === profileRevision &&
          read.listingRevision === query.state.dataUpdateCount &&
          read.periodStartAt === today,
      });
    }
  return captured;
};

type DiscoveryRow =
  | RouterOutputs["quests"]["missionHall"][number]
  | RouterOutputs["quests"]["specificQuests"][number];

type DiscoveryRead = {
  profileRevision: number | undefined;
  periodStartAt: number;
  listingRevision?: number;
};
