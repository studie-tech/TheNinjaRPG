import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getInventoryQuantities } from "@/deltas/item";
import {
  getQuestStartDiscoveryUpdate,
  getQuestStartUpcomingUpdate,
  getReopenedQuestIds,
} from "@/deltas/quests";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { prepareQueryUpdate, updateQueryCache } from "@/utils/queryCache";
import { periodStart } from "@/utils/time";

/** Reconcile quest discovery and both inventory views after profile settlement. */
export const useQuestStartCacheUpdate = () => {
  const client = useQueryClient();
  const inventory = useInventoryCacheUpdate();
  /** Capture both inventory views, every loaded discovery listing and the completed quests. */
  const prepareQuestStartUpdate = () => ({
    periodStartAt: periodStart("daily", new Date()).getTime(),
    inventory: inventory.prepareInventoryUpdate(),
    discovery: captureDiscovery(client),
    completedQuests: readProfile(client)?.completedQuests ?? [],
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
    // A new quest period can open candidates absent from the captured listings.
    const isCurrentPeriod =
      snapshot.periodStartAt === periodStart("daily", new Date()).getTime();
    const reopened = user
      ? getReopenedQuestIds(snapshot.completedQuests, user.completedQuests)
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
          .map(({ queryKey, queryHash }) => {
            const captured = snapshot.discovery.get(queryHash);
            const settled = captured?.current && isCurrentPeriod ? user : undefined;
            const options = { revision: captured?.revision };
            return upcoming
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
          }),
      ),
    ]);
  };
  return { prepareQuestStartUpdate, updateQuestStart };
};

/** Listings filtered by the player's quest availability, across all of their inputs. */
const discoveryListings = () => [
  { key: getQueryKey(api.quests.missionHall, undefined, "query"), upcoming: false },
  { key: getQueryKey(api.quests.specificQuests, undefined, "query"), upcoming: false },
  { key: getQueryKey(api.quests.upcomingQuests, undefined, "query"), upcoming: true },
];

/** The cached profile; after updateUser resolves it holds the settled start. */
const readProfile = (client: QueryClient) =>
  client.getQueryData<RouterOutputs["profile"]["getUser"]>(profileKey())?.userData ??
  undefined;

const profileKey = () => getQueryKey(api.profile.getUser, undefined, "query");

/**
 * Capture each settled discovery listing. A listing is current when it was read after the
 * profile last changed and within today's quest period, so it reflects every eligibility
 * input the profile knows.
 */
const captureDiscovery = (client: QueryClient) => {
  const profileUpdatedAt = client.getQueryState(profileKey())?.dataUpdatedAt ?? 0;
  const today = periodStart("daily", new Date()).getTime();
  const captured = new Map<
    string,
    { revision: number | undefined; current: boolean }
  >();
  for (const { key } of discoveryListings())
    for (const query of client.getQueryCache().findAll({ queryKey: key })) {
      const readAt = query.state.dataUpdatedAt;
      captured.set(query.queryHash, {
        revision: prepareQueryUpdate(client, query.queryKey),
        current:
          profileUpdatedAt > 0 &&
          readAt > profileUpdatedAt &&
          periodStart("daily", new Date(readAt)).getTime() === today,
      });
    }
  return captured;
};

type DiscoveryRow =
  | RouterOutputs["quests"]["missionHall"][number]
  | RouterOutputs["quests"]["specificQuests"][number];
