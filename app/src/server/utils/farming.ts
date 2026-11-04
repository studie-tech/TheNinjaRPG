import type { FarmCollectionLog, Item } from "@/drizzle/schema";
import {
  insertFarmCollectionLogForRecordFirstFarmHarvests,
  listFarmCollectionLogForGetFarmCollectionState,
  listItemForGetFarmCollectionState,
  listItemForGetFarmCollectionState2,
} from "@/queries/farming";
import type { DrizzleClient } from "@/server/db";

type FarmCollectionSeed = Pick<Item, "farmYieldItemId" | "farmMinLevel">;
type FarmCollectionItem = Pick<Item, "id" | "name" | "image">;
type FarmCollectionRow = Pick<FarmCollectionLog, "itemId" | "firstHarvestedAt">;

export type FarmCollectionState = {
  collected: number;
  total: number;
  items: {
    itemId: string;
    name: string;
    image: string;
    harvested: boolean;
    firstHarvestedAt: Date | null;
  }[];
};

/**
 * Builds the canonical crop catalog from eligible seeds and their visible yield items,
 * as filtered by the catalog queries. A crop appears once even when multiple seeds
 * yield it, ordered by its lowest configured farming level.
 */
export const buildFarmCollectionState = (
  seeds: readonly FarmCollectionSeed[],
  yieldItems: readonly FarmCollectionItem[],
  collectionRows: readonly FarmCollectionRow[],
): FarmCollectionState => {
  const minimumLevelByYieldId = new Map<string, number>();
  for (const seed of seeds) {
    if (!seed.farmYieldItemId) continue;
    const previous = minimumLevelByYieldId.get(seed.farmYieldItemId);
    if (previous === undefined || seed.farmMinLevel < previous) {
      minimumLevelByYieldId.set(seed.farmYieldItemId, seed.farmMinLevel);
    }
  }

  const firstHarvestByItemId = new Map(
    collectionRows.map((row) => [row.itemId, row.firstHarvestedAt]),
  );
  const items = yieldItems
    .filter((yieldItem) => minimumLevelByYieldId.has(yieldItem.id))
    .sort((a, b) => {
      const levelDifference =
        (minimumLevelByYieldId.get(a.id) ?? 0) - (minimumLevelByYieldId.get(b.id) ?? 0);
      return (
        levelDifference ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        a.id.localeCompare(b.id)
      );
    })
    .map((yieldItem) => {
      const firstHarvestedAt = firstHarvestByItemId.get(yieldItem.id) ?? null;
      return {
        itemId: yieldItem.id,
        name: yieldItem.name,
        image: yieldItem.image,
        harvested: firstHarvestedAt !== null,
        firstHarvestedAt,
      };
    });

  return {
    collected: items.filter((entry) => entry.harvested).length,
    total: items.length,
    items,
  };
};

/**
 * Fetches the current catalog joined to one user's immutable first-harvest rows.
 * @param inTransaction - Await queries in order on a shared PlanetScale transaction session.
 */
export const getFarmCollectionState = async (
  client: DrizzleClient,
  userId: string,
  inTransaction = false,
): Promise<FarmCollectionState> => {
  const seeds = await listItemForGetFarmCollectionState(client);
  const yieldItemIds = [
    ...new Set(
      seeds
        .map((seed) => seed.farmYieldItemId)
        .filter((itemId): itemId is string => itemId !== null),
    ),
  ];
  if (yieldItemIds.length === 0) {
    return { collected: 0, total: 0, items: [] };
  }

  const queries = [
    listItemForGetFarmCollectionState2(client, yieldItemIds),
    listFarmCollectionLogForGetFarmCollectionState(client, userId, yieldItemIds),
  ] as const;
  // Both builders stay lazy until awaited; a shared transaction session needs ordered queries.
  const [yieldItems, collectionRows] = inTransaction
    ? [await queries[0], await queries[1]]
    : await Promise.all(queries);

  return buildFarmCollectionState(seeds, yieldItems, collectionRows);
};

/**
 * Count crops harvested from the current catalog.
 * @param inTransaction - Pass the caller's transaction mode through to catalog loading.
 */
export const getFarmCollectionCount = async (
  client: DrizzleClient,
  userId: string,
  inTransaction = false,
) => (await getFarmCollectionState(client, userId, inTransaction)).collected;

/**
 * Records each yielded crop once. The duplicate-key branch deliberately updates only the
 * row id to itself, so firstHarvestedAt can never be overwritten by a later harvest.
 */
export const recordFirstFarmHarvests = async (
  client: DrizzleClient,
  userId: string,
  itemIds: readonly string[],
  firstHarvestedAt = new Date(),
) => {
  const distinctItemIds = [...new Set(itemIds)];
  if (distinctItemIds.length === 0) return;
  await insertFarmCollectionLogForRecordFirstFarmHarvests(
    client,
    distinctItemIds,
    userId,
    firstHarvestedAt,
  );
};
