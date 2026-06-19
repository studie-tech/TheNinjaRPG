import { and, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { FarmCollectionLog, Item } from "@/drizzle/schema";
import { farmCollectionLog, farmPlot, item } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

type FarmCollectionSeed = Pick<
  Item,
  "isFarmSeed" | "hidden" | "farmYieldItemId" | "farmMinLevel" | "farmGrowTimeSeconds"
>;
type FarmCollectionItem = Pick<Item, "id" | "name" | "image" | "hidden">;
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
 * Builds the canonical crop catalog from item configuration. A crop appears once even
 * when multiple eligible seeds yield it, ordered by its lowest configured farming level.
 */
export const buildFarmCollectionState = (
  seeds: readonly FarmCollectionSeed[],
  yieldItems: readonly FarmCollectionItem[],
  collectionRows: readonly FarmCollectionRow[],
): FarmCollectionState => {
  const minimumLevelByYieldId = new Map<string, number>();
  for (const seed of seeds) {
    if (
      !seed.isFarmSeed ||
      seed.hidden ||
      !seed.farmYieldItemId ||
      seed.farmGrowTimeSeconds <= 0
    ) {
      continue;
    }
    const previous = minimumLevelByYieldId.get(seed.farmYieldItemId);
    if (previous === undefined || seed.farmMinLevel < previous) {
      minimumLevelByYieldId.set(seed.farmYieldItemId, seed.farmMinLevel);
    }
  }

  const firstHarvestByItemId = new Map(
    collectionRows.map((row) => [row.itemId, row.firstHarvestedAt]),
  );
  const items = yieldItems
    .filter((yieldItem) => !yieldItem.hidden && minimumLevelByYieldId.has(yieldItem.id))
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

/** Fetches the current catalog joined to one user's immutable first-harvest rows. */
export const getFarmCollectionState = async (
  client: DrizzleClient,
  userId: string,
): Promise<FarmCollectionState> => {
  const seeds = await client.query.item.findMany({
    where: and(
      eq(item.isFarmSeed, true),
      eq(item.hidden, false),
      isNotNull(item.farmYieldItemId),
      gt(item.farmGrowTimeSeconds, 0),
    ),
    columns: {
      isFarmSeed: true,
      hidden: true,
      farmYieldItemId: true,
      farmMinLevel: true,
      farmGrowTimeSeconds: true,
    },
  });
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

  const [yieldItems, collectionRows] = await Promise.all([
    client.query.item.findMany({
      where: and(inArray(item.id, yieldItemIds), eq(item.hidden, false)),
      columns: { id: true, name: true, image: true, hidden: true },
    }),
    client.query.farmCollectionLog.findMany({
      where: and(
        eq(farmCollectionLog.userId, userId),
        inArray(farmCollectionLog.itemId, yieldItemIds),
      ),
      columns: { itemId: true, firstHarvestedAt: true },
    }),
  ]);

  return buildFarmCollectionState(seeds, yieldItems, collectionRows);
};

export const getFarmCollectionCount = async (client: DrizzleClient, userId: string) =>
  (await getFarmCollectionState(client, userId)).collected;

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
  await client
    .insert(farmCollectionLog)
    .values(
      distinctItemIds.map((itemId) => ({
        id: nanoid(),
        userId,
        itemId,
        firstHarvestedAt,
      })),
    )
    .onDuplicateKeyUpdate({ set: { id: sql`${farmCollectionLog.id}` } });
};

export const reduceActiveFarmPlotTimers = (
  client: DrizzleClient,
  userId: string,
  reductionSeconds: number,
  now = new Date(),
) =>
  client
    .update(farmPlot)
    .set({
      finishAt: sql`GREATEST(${now}, TIMESTAMPADD(SECOND, -${reductionSeconds}, ${farmPlot.finishAt}))`,
      updatedAt: now,
    })
    .where(
      and(
        eq(farmPlot.userId, userId),
        isNotNull(farmPlot.seedItemId),
        isNotNull(farmPlot.finishAt),
        gt(farmPlot.finishAt, now),
      ),
    );
