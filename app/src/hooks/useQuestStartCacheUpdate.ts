import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getInventoryQuantities } from "@/deltas/item";
import { getStartedQuestDiscovery } from "@/deltas/quests";
import { useInventoryCacheUpdate } from "@/hooks/useInventoryCacheUpdate";
import { prepareQueryUpdate, updateQueryCache } from "@/utils/queryCache";

/** Bind quest starts to every loaded discovery input and both inventory views. */
export const useQuestStartCacheUpdate = () => {
  const utils = api.useUtils();
  const client = useQueryClient();
  const inventory = useInventoryCacheUpdate();
  /** Capture exact keys so a changed quest type, village or level cannot redirect the assignment. */
  const prepareQuestStartUpdate = () => ({
    inventory: inventory.prepareInventoryUpdate(),
    user: utils.profile.getUser.getData()?.userData ?? undefined,
    discovery: [api.quests.missionHall, api.quests.specificQuests].flatMap(
      (procedure) =>
        client
          .getQueryCache()
          .findAll({ queryKey: getQueryKey(procedure, undefined, "query") })
          .map((query) => ({
            key: query.queryKey,
            revision: prepareQueryUpdate(client, query.queryKey),
            queriedAt: query.state.dataUpdatedAt,
          })),
    ),
  });
  /** Reuse confirmed assignments only after profile settlement; uncertain results retain every read. */
  const updateQuestStart = async (
    result:
      | RouterOutputs["quests"]["startQuest"]
      | RouterOutputs["quests"]["startRandom"]
      | undefined,
    snapshot: ReturnType<typeof prepareQuestStartUpdate>,
    profileApplied: boolean,
  ) => {
    const update =
      result?.success && profileApplied ? result.questStartUpdate : undefined;
    const user = utils.profile.getUser.getData()?.userData;
    await Promise.all([
      inventory.updateInventory(
        update
          ? (rows) => getInventoryQuantities(rows, result?.inventoryChanges)
          : undefined,
        snapshot.inventory,
      ),
      ...snapshot.discovery.map(({ key, revision, queriedAt }) =>
        updateQueryCache<RouterOutputs["quests"]["missionHall"]>(
          client,
          key,
          update
            ? (rows) =>
                getStartedQuestDiscovery(
                  rows,
                  user ?? undefined,
                  update,
                  result?.inventoryChanges,
                  (
                    key[1] as
                      | { input?: { level?: number; villageId?: string } }
                      | undefined
                  )?.input ?? {},
                  { user: snapshot.user, queriedAt },
                  new Date(),
                )
            : undefined,
          { revision },
        ),
      ),
    ]);
  };
  return { prepareQuestStartUpdate, updateQuestStart };
};
