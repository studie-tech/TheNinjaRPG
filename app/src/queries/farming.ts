/**
 * Database access for farming; authorization and transaction scopes stay in callers.
 */
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  farmCollectionLog,
  farmExtraction,
  farmPlot,
  item,
  userData,
  userItem,
} from "@/drizzle/schema";
import { EMPTY_PLOT } from "@/libs/farming";
import { actionReadinessSqlSet } from "@/queries/actionReadiness";
import { nextSnapshotSql } from "@/queries/concurrency";
import type { DrizzleClient } from "@/server/db";
import type { ActionReadinessWrite } from "@/server/utils/actionReadiness";
import { hasNoHuntingBattle } from "@/server/utils/concurrency";
import { getNextUserSnapshotAt } from "@/utils/time";

/** Load a seed and its yield definition; a missing seed leaves seedItem undefined and yieldItem null. */
export const fetchFarmSeedAndYield = async (
  client: DrizzleClient,
  seedItemId: string,
) => {
  const seedItem = await client.query.item.findFirst({
    where: eq(item.id, seedItemId),
    with: { farmYieldItem: true },
  });
  return { seedItem, yieldItem: seedItem?.farmYieldItem ?? null };
};

/** Load an owned plot with seed/yield definitions normalized to null; a missing plot returns null. */
export const fetchFarmPlotWithItems = async (
  client: DrizzleClient,
  userId: string,
  plotId: string,
) => {
  const plot = await client.query.farmPlot.findFirst({
    where: and(eq(farmPlot.id, plotId), eq(farmPlot.userId, userId)),
    with: { seedItem: { with: { farmYieldItem: true } } },
  });
  return plot
    ? {
        ...plot,
        seedItem: plot.seedItem ?? null,
        yieldItem: plot.seedItem?.farmYieldItem ?? null,
      }
    : null;
};

/** Load owned plots and normalize absent seed and yield definitions to null. */
export const fetchFarmPlotsWithItems = async (
  client: DrizzleClient,
  userId: string,
) => {
  const plots = await client.query.farmPlot.findMany({
    where: eq(farmPlot.userId, userId),
    with: { seedItem: { with: { farmYieldItem: true } } },
  });
  return plots.map((plot) => ({
    ...plot,
    seedItem: plot.seedItem ?? null,
    yieldItem: plot.seedItem?.farmYieldItem ?? null,
  }));
};

/** Load visible purchasable seeds and fertilizers in parallel, using each catalogue display order. */
export const fetchFarmShopItems = async (client: DrizzleClient) => {
  return await Promise.all([
    client.query.item.findMany({
      where: and(
        eq(item.isFarmSeed, true),
        eq(item.inShop, false),
        eq(item.hidden, false),
        gt(item.farmSellValue, 0),
      ),
      orderBy: [asc(item.farmMinLevel), asc(item.name)],
    }),
    client.query.item.findMany({
      where: and(
        eq(item.isFarmFertilizer, true),
        eq(item.hidden, false),
        gt(item.farmSellValue, 0),
      ),
      orderBy: asc(item.name),
    }),
  ]);
};

/** Load an account's extraction slots in slot order with their crop and seed definitions. */
export const fetchUserExtractions = async (client: DrizzleClient, userId: string) =>
  await client.query.farmExtraction.findMany({
    where: eq(farmExtraction.userId, userId),
    orderBy: (extraction, { asc }) => [asc(extraction.extractorSlot)],
    with: { cropItem: true, seedItem: true },
  });

/** Load an account's plots in slot order with their planted seed definitions. */
export const fetchFarmPlots = async (client: DrizzleClient, userId: string) => {
  return await client.query.farmPlot.findMany({
    where: eq(farmPlot.userId, userId),
    orderBy: (plot, { asc }) => [asc(plot.slotIndex)],
    with: { seedItem: true },
  });
};

/** Build the `farmPlot` lookup for `plantSeed`, using predicates on `id` and `userId`. */
export const findFarmPlotForPlantSeed = (
  client: Pick<DrizzleClient, "query">,
  input: { plotId: string },
  ctx: { userId: string },
) =>
  client.query.farmPlot.findFirst({
    where: and(eq(farmPlot.id, input.plotId), eq(farmPlot.userId, ctx.userId)),
  });

/** Build the `farmPlot` update planting empty plots, using predicates on `userId`, `id`, `seedItemId`. */
export const updateFarmPlotsForPlant = (
  client: Pick<DrizzleClient, "update">,
  seedItemId: string,
  now: Date,
  finishAt: Date,
  ctx: { userId: string },
  plotIds: string[],
) =>
  client
    .update(farmPlot)
    .set({
      seedItemId,
      plantedAt: now,
      finishAt,
      lastWateredAt: null,
      fertilizerApplied: false,
      updatedAt: now,
    })
    .where(
      and(
        eq(farmPlot.userId, ctx.userId),
        inArray(farmPlot.id, plotIds),
        isNull(farmPlot.seedItemId),
      ),
    );

/** Build the `farmPlot` update for watering, including predicates on `id`, `userId`, `seedItemId`. */
export const updateFarmPlotForWater = (
  client: Pick<DrizzleClient, "update">,
  newFinishAt: Date,
  now: Date,
  plot: { id: string; seedItemId: string; finishAt: Date; lastWateredAt: null | Date },
  ctx: { userId: string },
) =>
  client
    .update(farmPlot)
    .set({ finishAt: newFinishAt, lastWateredAt: now, updatedAt: now })
    .where(
      and(
        eq(farmPlot.id, plot.id),
        eq(farmPlot.userId, ctx.userId),
        // Pin the crop and the timer this reduction was derived from. Without them a
        // request that read an older finishAt can overwrite a newer one, and a plot
        // harvested in between (which resets lastWateredAt to null) still matches.
        eq(farmPlot.seedItemId, plot.seedItemId),
        eq(farmPlot.finishAt, plot.finishAt),
        plot.lastWateredAt
          ? eq(farmPlot.lastWateredAt, plot.lastWateredAt)
          : isNull(farmPlot.lastWateredAt),
        sql`EXISTS (SELECT 1 FROM ${userData} WHERE ${and(
          eq(userData.userId, ctx.userId),
          eq(userData.status, "AWAKE"),
        )})`,
      ),
    );

/** Water matching plot snapshots and commit their owner's recovery in the same claim. */
export const waterFarmPlotsWithRecovery = (
  client: Pick<DrizzleClient, "execute">,
  userId: string,
  plots: {
    id: string;
    seedItemId: string;
    finishAt: Date;
    lastWateredAt: Date | null;
    newFinishAt: Date;
  }[],
  now: Date,
  claimedAt: Date,
  readiness: ActionReadinessWrite,
) =>
  client.execute(sql`
  UPDATE ${userData}
  INNER JOIN ${farmPlot} ON ${eq(farmPlot.userId, userData.userId)}
  SET ${actionReadinessSqlSet(readiness, [])}
      ${userData.updatedAt} = ${claimedAt},
      ${farmPlot.finishAt} = CASE ${farmPlot.id}
        ${sql.join(
          plots.map((plot) => sql`WHEN ${plot.id} THEN ${plot.newFinishAt}`),
          sql` `,
        )}
        ELSE ${farmPlot.finishAt} END,
      ${farmPlot.lastWateredAt} = ${now},
      ${farmPlot.updatedAt} = ${now}
  WHERE ${and(
    eq(userData.userId, userId),
    readiness.where,
    or(
      ...plots.map((plot) =>
        and(
          eq(farmPlot.id, plot.id),
          eq(farmPlot.seedItemId, plot.seedItemId),
          eq(farmPlot.finishAt, plot.finishAt),
          plot.lastWateredAt
            ? eq(farmPlot.lastWateredAt, plot.lastWateredAt)
            : isNull(farmPlot.lastWateredAt),
        ),
      ),
    ),
  )}
`);

/** Build the `farmPlot` update for fertilizing, including predicates on `id`, `userId`, `seedItemId`. */
export const updateFarmPlotForFertilize = (
  client: Pick<DrizzleClient, "update">,
  newFinishAt: Date,
  now: Date,
  plot: { id: string; seedItemId: string; finishAt: Date },
  ctx: { userId: string },
) =>
  client
    .update(farmPlot)
    .set({ finishAt: newFinishAt, fertilizerApplied: true, updatedAt: now })
    .where(
      and(
        eq(farmPlot.id, plot.id),
        eq(farmPlot.userId, ctx.userId),
        eq(farmPlot.seedItemId, plot.seedItemId),
        eq(farmPlot.finishAt, plot.finishAt),
        eq(farmPlot.fertilizerApplied, false),
      ),
    );

/** Claim ready plots and their owner's eligibility/recovery together before granting produce. */
export const updateFarmPlotsForHarvest = (
  client: Pick<DrizzleClient, "execute" | "update">,
  now: Date,
  user: { userId: string; updatedAt: Date },
  plotIds: string[],
  readiness?: ActionReadinessWrite,
) => {
  // An awake claim only clears plots; preserving its account revision lets the
  // existing quest-progress CAS commit without a recovery-only retry.
  if (!readiness?.set.status) {
    return client
      .update(farmPlot)
      .set({ ...EMPTY_PLOT, updatedAt: now })
      .where(
        and(
          eq(farmPlot.userId, user.userId),
          inArray(farmPlot.id, plotIds),
          lte(farmPlot.finishAt, now),
          sql`EXISTS (SELECT 1 FROM ${userData} WHERE ${and(
            eq(userData.userId, user.userId),
            readiness?.where ?? eq(userData.status, "AWAKE"),
          )})`,
        ),
      );
  }
  const claimedAt = getNextUserSnapshotAt(user.updatedAt, now);
  return client.execute(sql`
    UPDATE ${userData}
    INNER JOIN ${farmPlot} ON ${eq(farmPlot.userId, userData.userId)}
    SET ${actionReadinessSqlSet(readiness, [])}
        ${userData.updatedAt} = ${claimedAt},
        ${farmPlot.seedItemId} = NULL,
        ${farmPlot.plantedAt} = NULL,
        ${farmPlot.finishAt} = NULL,
        ${farmPlot.lastWateredAt} = NULL,
        ${farmPlot.fertilizerApplied} = false,
        ${farmPlot.updatedAt} = ${now}
    WHERE ${and(
      eq(userData.userId, user.userId),
      readiness?.where ?? eq(userData.status, "AWAKE"),
      inArray(farmPlot.id, plotIds),
      lte(farmPlot.finishAt, now),
    )}
  `);
};

/** Build the `farmPlot` listing for `plantAllEmpty`, using predicates on `userId`. */
export const listFarmPlotForPlantAllEmpty = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.farmPlot.findMany({
    where: eq(farmPlot.userId, ctx.userId),
  });

/** Build the `farmPlot` listing for `waterAll`, using predicates on `userId`. */
export const listFarmPlotForWaterAll = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.farmPlot.findMany({
    where: eq(farmPlot.userId, ctx.userId),
    with: { seedItem: true },
  });

/**
 * Debit the owned crop stack and credit coins/recovery in one guarded joined statement.
 * Exhausted stacks use the inventory's zero-quantity tombstones, excluded from reads and grants.
 */
export const sellFarmCrop = (
  client: Pick<DrizzleClient, "execute">,
  totalValue: number,
  userId: string,
  cropStack: { id: string; quantity: number },
  quantity: number,
  readiness: ActionReadinessWrite,
) =>
  client.execute(sql`
  UPDATE ${userData}
  INNER JOIN ${userItem} ON ${eq(userItem.userId, userData.userId)}
  SET ${actionReadinessSqlSet(readiness, [])}
      ${userData.farmCurrency} = ${userData.farmCurrency} + ${totalValue},
      ${userData.updatedAt} = ${nextSnapshotSql(userData.updatedAt)},
      ${userItem.quantity} = ${cropStack.quantity - quantity},
      ${userItem.updatedAt} = ${new Date()}
  WHERE ${and(
    eq(userData.userId, userId),
    readiness.where,
    eq(userItem.id, cropStack.id),
    eq(userItem.quantity, cropStack.quantity),
    hasNoHuntingBattle(userId),
  )}
`);

/**
 * Build the `userData` update for `buyShopItem`, setting `farmCurrency` and
 * `farmPlotsPurchased`, using predicates on `userId`, `farmCurrency`,
 * `farmPlotsPurchased`.
 */
export const updateUserDataForBuyShopItem = (
  client: Pick<DrizzleClient, "update">,
  shopEntry: { cost: number },
  ctx: { userId: string },
  user: { farmPlotsPurchased: number },
  maxPurchased: number,
  readiness?: ActionReadinessWrite,
) =>
  client
    .update(userData)
    .set({
      ...readiness?.set,
      farmCurrency: sql`${userData.farmCurrency} - ${shopEntry.cost}`,
      farmPlotsPurchased: sql`${userData.farmPlotsPurchased} + 1`,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        readiness?.where,
        gte(userData.farmCurrency, shopEntry.cost),
        eq(userData.farmPlotsPurchased, user.farmPlotsPurchased),
        lt(userData.farmPlotsPurchased, maxPurchased),
      ),
    );

/** Build the `farmPlot` insert for `buyShopItem`, updating duplicate keys. */
export const insertFarmPlotForBuyShopItem = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  newTotal: number,
) =>
  client
    .insert(farmPlot)
    .values({
      id: nanoid(),
      userId: ctx.userId,
      slotIndex: newTotal - 1,
    })
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/**
 * Build the `userData` update for `buyShopItem`, setting `farmCurrency` and
 * `farmExtractorsOwned`, using predicates on `userId`, `farmCurrency`,
 * `farmExtractorsOwned`.
 */
export const updateUserDataForBuyShopItem2 = (
  client: Pick<DrizzleClient, "update">,
  shopEntry: { cost: number },
  ctx: { userId: string },
  user: { farmExtractorsOwned: number },
  maxExtractors: number,
  readiness?: ActionReadinessWrite,
) =>
  client
    .update(userData)
    .set({
      ...readiness?.set,
      farmCurrency: sql`${userData.farmCurrency} - ${shopEntry.cost}`,
      farmExtractorsOwned: sql`${userData.farmExtractorsOwned} + 1`,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        readiness?.where,
        gte(userData.farmCurrency, shopEntry.cost),
        eq(userData.farmExtractorsOwned, user.farmExtractorsOwned),
        lt(userData.farmExtractorsOwned, maxExtractors),
      ),
    );

/**
 * Build the `userData` update for `buyShopItem`, setting `farmCurrency`, using
 * predicates on `userId` and `farmCurrency`.
 */
export const updateUserDataForBuyShopItem3 = (
  client: Pick<DrizzleClient, "update">,
  totalCost: number,
  ctx: { userId: string },
  readiness?: ActionReadinessWrite,
) =>
  client
    .update(userData)
    .set({
      ...readiness?.set,
      farmCurrency: sql`${userData.farmCurrency} - ${totalCost}`,
    })
    .where(
      and(
        eq(userData.userId, ctx.userId),
        readiness?.where,
        gte(userData.farmCurrency, totalCost),
      ),
    );

/** Build the `farmExtraction` insert for `extractSeeds`, updating duplicate keys. */
export const insertFarmExtractionForExtractSeeds = (
  client: Pick<DrizzleClient, "insert">,
  extractionId: string,
  ctx: { userId: string },
  input: { extractorSlot: number; quantity: number },
  cropStack: { itemId: string },
  seedItem: { id: string },
  seedsToGrant: number,
  now: Date,
  finishAt: Date,
) =>
  client.insert(farmExtraction).values({
    id: extractionId,
    userId: ctx.userId,
    extractorSlot: input.extractorSlot,
    cropItemId: cropStack.itemId,
    seedItemId: seedItem.id,
    cropQuantity: input.quantity,
    seedQuantity: seedsToGrant,
    startedAt: now,
    finishAt,
  });

/** Build the `farmExtraction` deletion for `extractSeeds`, using predicates on `id` and `userId`. */
export const deleteFarmExtractionForExtractSeeds = (
  client: Pick<DrizzleClient, "delete">,
  extractionId: string,
  ctx: { userId: string },
) =>
  client
    .delete(farmExtraction)
    .where(
      and(eq(farmExtraction.id, extractionId), eq(farmExtraction.userId, ctx.userId)),
    );

/**
 * Clear planted fields only while owner, seed and plantedAt still match the bulk-plant
 * claim; leave newer plantings untouched.
 */
export const rollbackBulkPlant = async (
  client: DrizzleClient,
  userId: string,
  plotIds: string[],
  seedItemId: string,
  plantedAt: Date,
) => {
  await client
    .update(farmPlot)
    .set({ ...EMPTY_PLOT, updatedAt: new Date() })
    .where(
      and(
        eq(farmPlot.userId, userId),
        inArray(farmPlot.id, plotIds),
        eq(farmPlot.seedItemId, seedItemId),
        eq(farmPlot.plantedAt, plantedAt),
      ),
    );
};

/** Build the `farmPlot` update for `rollbackBulkFertilizer`, including predicates on `id`, `userId`, `fertilizerApplied`. */
export const updateFarmPlotForRollbackBulkFertilizer = (
  client: Pick<DrizzleClient, "update">,
  plot: { finishAt: Date; id: string },
  userId: string,
  updatedAt: Date,
) =>
  client
    .update(farmPlot)
    .set({
      finishAt: plot.finishAt,
      fertilizerApplied: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(farmPlot.id, plot.id),
        eq(farmPlot.userId, userId),
        eq(farmPlot.fertilizerApplied, true),
        eq(farmPlot.updatedAt, updatedAt),
      ),
    );

/** Build the `item` listing for `buildFarmState`, selecting row fields `id`, using predicates on `farmYieldItemId`. */
export const listItemForBuildFarmState = (client: Pick<DrizzleClient, "query">) =>
  client.query.item.findMany({
    where: isNotNull(item.farmYieldItemId),
    columns: { id: true },
    with: { farmYieldItem: true },
  });

/** Build the `farmPlot` update for `buildFarmState`, using predicates on `id`, `userId`, `seedItemId`. */
export const updateFarmPlotForBuildFarmState = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  plotId: string,
  userId: string,
  seedItemId: string,
) =>
  client
    .update(farmPlot)
    .set({ ...EMPTY_PLOT, updatedAt: now })
    .where(
      and(
        eq(farmPlot.id, plotId),
        eq(farmPlot.userId, userId),
        eq(farmPlot.seedItemId, seedItemId),
      ),
    );

/**
 * Build the `farmExtraction` update for `payOutExtractions`, setting `claimedAt` and
 * `updatedAt`, including predicates on `id`, `userId`, `finishAt`.
 */
export const updateFarmExtractionForPayOutExtractions = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  extraction: { id: string },
  userId: string,
  staleClaim: Date,
) =>
  client
    .update(farmExtraction)
    .set({ claimedAt: now, updatedAt: now })
    .where(
      and(
        eq(farmExtraction.id, extraction.id),
        eq(farmExtraction.userId, userId),
        lte(farmExtraction.finishAt, now),
        isNull(farmExtraction.settledAt),
        or(isNull(farmExtraction.claimedAt), lt(farmExtraction.claimedAt, staleClaim)),
      ),
    );

/** Build the `farmExtraction` update for `payOutExtractions`, setting `settledAt`, using predicates on `userId` and `id`. */
export const updateFarmExtractionForPayOutExtractions2 = (
  client: Pick<DrizzleClient, "update">,
  now: Date,
  userId: string,
  grantedIds: string[],
) =>
  client
    .update(farmExtraction)
    .set({ settledAt: now })
    .where(
      and(eq(farmExtraction.userId, userId), inArray(farmExtraction.id, grantedIds)),
    );

/** Build the `farmExtraction` update for `payOutExtractions`, setting `claimedAt`, using predicates on `userId` and `id`. */
export const updateFarmExtractionForPayOutExtractions3 = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  releasedIds: string[],
) =>
  client
    .update(farmExtraction)
    .set({ claimedAt: null })
    .where(
      and(eq(farmExtraction.userId, userId), inArray(farmExtraction.id, releasedIds)),
    );

/** Build the `farmExtraction` deletion for `payOutExtractions`, using predicates on `userId` and `id`. */
export const deleteFarmExtractionForPayOutExtractions = (
  client: Pick<DrizzleClient, "delete">,
  userId: string,
  doneIds: string[],
) =>
  client
    .delete(farmExtraction)
    .where(and(eq(farmExtraction.userId, userId), inArray(farmExtraction.id, doneIds)));

/** Build the `farmPlot` insert for `ensureFarmPlots`, updating duplicate keys. */
export const insertFarmPlotForEnsureFarmPlots = (
  client: Pick<DrizzleClient, "insert">,
  inserts: Pick<import("@/drizzle/schema").FarmPlot, "id" | "userId" | "slotIndex">[],
) =>
  client
    .insert(farmPlot)
    .values(inserts)
    .onDuplicateKeyUpdate({ set: { id: sql`id` } });

/**
 * Build the `userItem` update for `awardItemToUser`, setting `quantity` and
 * `updatedAt`, using predicates on `id` and `quantity`.
 */
export const updateUserItemForAwardItemToUser = (
  client: Pick<DrizzleClient, "update">,
  toAdd: number,
  existing: { id: string },
  quantityOnRecord: number,
  stackSize: number,
) =>
  client
    .update(userItem)
    .set({
      quantity: sql`${userItem.quantity} + ${toAdd}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userItem.id, existing.id),
        eq(userItem.quantity, quantityOnRecord),
        sql`${userItem.quantity} + ${toAdd} <= ${stackSize}`,
      ),
    );

/** Build the `userItem` lookup for `awardItemToUser`, selecting only `quantity`, using predicates on `id`. */
export const findUserItemForAwardItemToUser = (
  client: Pick<DrizzleClient, "query">,
  existing: { id: string },
) =>
  client.query.userItem.findFirst({
    where: eq(userItem.id, existing.id),
    columns: { quantity: true },
  });

/** Build the `userData` update for `awardFarmingProgress`, setting `farmingExperience`, using predicates on `userId`. */
export const updateUserDataForAwardFarmingProgress = (
  client: Pick<DrizzleClient, "update">,
  xpGain: number,
  user: { userId: string },
) =>
  client
    .update(userData)
    .set({
      farmingExperience: sql`${userData.farmingExperience} + ${xpGain}`,
    })
    .where(eq(userData.userId, user.userId));

/**
 * Build the `item` listing for `getFarmCollectionState`, including predicates on
 * `isFarmSeed`, `hidden`, `farmYieldItemId`.
 */
export const listItemForGetFarmCollectionState = (
  client: Pick<DrizzleClient, "query">,
) =>
  client.query.item.findMany({
    where: and(
      eq(item.isFarmSeed, true),
      eq(item.hidden, false),
      isNotNull(item.farmYieldItemId),
      gt(item.farmGrowTimeSeconds, 0),
    ),
    columns: { farmYieldItemId: true, farmMinLevel: true },
  });

/** Build the `item` listing for `getFarmCollectionState`, using predicates on `id` and `hidden`. */
export const listItemForGetFarmCollectionState2 = (
  client: Pick<DrizzleClient, "query">,
  yieldItemIds: string[],
) =>
  client.query.item.findMany({
    where: and(inArray(item.id, yieldItemIds), eq(item.hidden, false)),
    columns: { id: true, name: true, image: true },
  });

/**
 * Build the `farmCollectionLog` listing for `getFarmCollectionState`, selecting only
 * `itemId` and `firstHarvestedAt`, using predicates on `userId` and `itemId`.
 */
export const listFarmCollectionLogForGetFarmCollectionState = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
  yieldItemIds: string[],
) =>
  client.query.farmCollectionLog.findMany({
    where: and(
      eq(farmCollectionLog.userId, userId),
      inArray(farmCollectionLog.itemId, yieldItemIds),
    ),
    columns: { itemId: true, firstHarvestedAt: true },
  });

/** Build the `farmCollectionLog` insert for `recordFirstFarmHarvests`, updating duplicate keys. */
export const insertFarmCollectionLogForRecordFirstFarmHarvests = (
  client: Pick<DrizzleClient, "insert">,
  distinctItemIds: string[],
  userId: string,
  firstHarvestedAt: Date,
) =>
  client
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

/**
 * Build the active-plot timer reduction for one owner clamping finishAt to now and
 * leaving empty or expired plots unchanged.
 */
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
