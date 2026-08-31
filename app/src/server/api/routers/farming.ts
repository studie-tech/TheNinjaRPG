import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  FARM_CROPS_PER_EXTRACTOR,
  FARM_MAX_CROP_SELL_QUANTITY,
  FARM_MAX_PLOTS,
  FARM_SHOP_ENTRIES,
  FARM_STARTING_PLOTS,
  FARM_WATER_EXPERIENCE,
  MAP_WAKE_ISLAND_SECTOR,
} from "@/drizzle/constants";
import {
  farmExtraction,
  farmPlot,
  type Item,
  item,
  questHistory,
  userData,
  userItem,
} from "@/drizzle/schema";
import { getTotalItemQuantity } from "@/libs/crafting";
import { getWorldCycleState } from "@/libs/dayNight";
import {
  applyFertilizerReduction,
  applyWaterReduction,
  getFarmGrowTimeSeconds,
  getFarmHarvestExperience,
  getFarmingLevel,
  getFarmingLevelProgress,
  getFarmPlantExperience,
  getFertilizerExperience,
  getMaxExtractors,
  getMaxPurchasablePlots,
  getSeedExtractionDurationSeconds,
  getTotalFarmPlots,
  isPlotReady,
  mapPlotToState,
} from "@/libs/farming";
import {
  getInventoryBucket,
  getInventoryBucketCapacity,
  getInventoryBucketFullMessage,
  type InventoryBucket,
} from "@/libs/item";
import {
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  type ObjectiveTrackerTaskInput,
} from "@/libs/quest";
import { fetchUserItems } from "@/server/api/routers/item";
import { fetchUser } from "@/server/api/routers/profile";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  claimUserSnapshot,
  refundUserItemQuantityAtomically,
  updateUserItemQuantityAtomically,
} from "@/server/utils/concurrency";
import {
  getFarmCollectionCount,
  getFarmCollectionState,
  recordFirstFarmHarvests,
} from "@/server/utils/farming";
import {
  type FarmShopEntryState,
  type FarmStateResponse,
  farmMutationResponseSchema,
  farmShopPurchaseInputSchema,
} from "@/validators/farming";
import type { AllObjectiveTask } from "@/validators/objectives";

export const farmingRouter = createTRPCRouter({
  getFarmState: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get farm state" } })
    .query(async ({ ctx }) => {
      return await buildFarmState(ctx.drizzle, ctx.userId);
    }),

  plantSeed: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Plant a seed on a farm plot" } })
    .input(z.object({ plotId: z.string(), seedItemId: z.string() }))
    .output(farmMutationResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, userItems, plot, seedItem, questState] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.farmPlot.findFirst({
          where: and(eq(farmPlot.id, input.plotId), eq(farmPlot.userId, ctx.userId)),
        }),
        ctx.drizzle.query.item.findFirst({ where: eq(item.id, input.seedItemId) }),
        fetchFarmingQuestState(ctx.drizzle, ctx.userId),
      ]);

      const guard = guardFarmingMutation(user);
      if (guard) return guard;
      if (!plot) return errorResponse("Plot not found");
      if (plot.seedItemId) return errorResponse("This plot already has a crop");
      if (!seedItem?.isFarmSeed) return errorResponse("This item is not a farm seed");
      if (!seedItem.farmYieldItemId)
        return errorResponse("Seed has no crop configured");
      if (seedItem.farmGrowTimeSeconds <= 0) {
        return errorResponse("Seed has invalid grow time");
      }

      const farmingLevel = getFarmingLevel(user.farmingExperience);
      if (farmingLevel < seedItem.farmMinLevel) {
        return errorResponse(`Requires farming level ${seedItem.farmMinLevel}`);
      }

      const seedQuantity = getTotalItemQuantity(userItems, input.seedItemId);
      if (seedQuantity < 1) return errorResponse("You do not have this seed");

      const seedStack = userItems.find(
        (ui) =>
          ui.itemId === input.seedItemId &&
          ui.quantity > 0 &&
          !ui.storedAtHome &&
          !ui.isInAuction &&
          (!ui.craftingFinishedAt || ui.craftingFinishedAt < new Date()),
      );
      if (!seedStack) return errorResponse("Seed not available in inventory");

      const claim = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        where: [eq(userData.status, "AWAKE")],
      });
      if (!claim.success) {
        return errorResponse("Could not plant — please try again");
      }

      const now = new Date();
      const growTimeSeconds = getFarmGrowTimeSeconds(
        seedItem.farmGrowTimeSeconds,
        user,
      );
      const finishAt = new Date(now.getTime() + growTimeSeconds * 1000);
      const xpGain = getFarmPlantExperience(seedItem);

      const plantResult = await ctx.drizzle
        .update(farmPlot)
        .set({
          seedItemId: input.seedItemId,
          plantedAt: now,
          finishAt,
          lastWateredAt: null,
          fertilizerApplied: false,
          updatedAt: now,
        })
        .where(
          and(
            eq(farmPlot.id, plot.id),
            eq(farmPlot.userId, ctx.userId),
            isNull(farmPlot.seedItemId),
          ),
        );
      if (plantResult.rowsAffected !== 1) {
        return errorResponse("Could not plant — please try again");
      }

      const consumed = await updateUserItemQuantityAtomically({
        client: ctx.drizzle,
        userId: ctx.userId,
        userItemId: seedStack.id,
        expectedQuantity: seedStack.quantity,
        nextQuantity: seedStack.quantity - 1,
      });
      if (!consumed) {
        await ctx.drizzle
          .update(farmPlot)
          .set({
            seedItemId: null,
            plantedAt: null,
            finishAt: null,
            lastWateredAt: null,
            fertilizerApplied: false,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(farmPlot.id, plot.id),
              eq(farmPlot.userId, ctx.userId),
              eq(farmPlot.seedItemId, input.seedItemId),
            ),
          );
        return errorResponse("Could not consume seed — please try again");
      }

      const progressAwarded = await awardFarmingProgress(
        ctx.drizzle,
        user,
        xpGain,
        questState,
        "seeds_planted",
      );
      if (!progressAwarded) {
        return errorResponse("Planted seed but failed to update farming progress");
      }

      return {
        success: true,
        message:
          xpGain > 0
            ? `Planted ${seedItem.name} (+${xpGain} farming XP)`
            : `Planted ${seedItem.name}`,
        updatedPlot: mapPlotToState(
          {
            ...plot,
            seedItemId: seedItem.id,
            plantedAt: now,
            finishAt,
            lastWateredAt: null,
            fertilizerApplied: false,
            seedItem,
            yieldItem: await ctx.drizzle.query.item.findFirst({
              where: eq(item.id, seedItem.farmYieldItemId),
            }),
          },
          now,
        ),
        farmingExperienceDelta: xpGain,
        inventoryDeltas: [{ itemId: seedItem.id, quantityDelta: -1 }],
      };
    }),

  waterPlot: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Water a growing farm plot" } })
    .input(z.object({ plotId: z.string() }))
    .output(farmMutationResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, plot, questState] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchFarmPlotWithItems(ctx.drizzle, ctx.userId, input.plotId),
        fetchFarmingQuestState(ctx.drizzle, ctx.userId),
      ]);

      const guard = guardFarmingMutation(user);
      if (guard) return guard;
      if (!plot) return errorResponse("Plot not found");
      if (!plot.seedItemId || !plot.finishAt)
        return errorResponse("Nothing growing here");
      if (isPlotReady(plot.finishAt)) return errorResponse("Crop is ready to harvest");

      const plotState = mapPlotToState(plot);
      if (!plotState.canWater)
        return errorResponse("You can water again at the start of the next day cycle");

      const now = new Date();
      const newFinishAt = applyWaterReduction(plot.finishAt, now);
      const waterResult = await ctx.drizzle
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
          ),
        );
      if (waterResult.rowsAffected !== 1) {
        return errorResponse("Could not water — please try again");
      }

      const progressAwarded = await awardFarmingProgress(
        ctx.drizzle,
        user,
        FARM_WATER_EXPERIENCE,
        questState,
        "plants_watered",
      );
      if (!progressAwarded) {
        return errorResponse("Watered crop but failed to update farming progress");
      }

      return {
        success: true,
        message: `Watered the crop (+${FARM_WATER_EXPERIENCE} farming XP)`,
        updatedPlot: mapPlotToState(
          { ...plot, finishAt: newFinishAt, lastWateredAt: now },
          now,
        ),
        farmingExperienceDelta: FARM_WATER_EXPERIENCE,
      };
    }),

  applyFertilizer: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Apply fertilizer to a farm plot" } })
    .input(z.object({ plotId: z.string(), userItemId: z.string() }))
    .output(farmMutationResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, userItems, plot, questState] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchFarmPlotWithItems(ctx.drizzle, ctx.userId, input.plotId),
        fetchFarmingQuestState(ctx.drizzle, ctx.userId),
      ]);

      const guard = guardFarmingMutation(user);
      if (guard) return guard;
      if (!plot) return errorResponse("Plot not found");
      if (!plot.seedItemId || !plot.finishAt)
        return errorResponse("Nothing growing here");
      if (plot.fertilizerApplied) return errorResponse("Fertilizer already applied");
      if (isPlotReady(plot.finishAt)) return errorResponse("Crop is ready to harvest");

      // Same availability rule as fertilizeAll: a stack that is stored at home, listed in an
      // auction or still being crafted is not in hand, so it cannot be spent on a plot.
      const availableAt = new Date();
      const fertilizerStack = userItems.find(
        (ui) =>
          ui.id === input.userItemId &&
          ui.quantity > 0 &&
          !ui.storedAtHome &&
          !ui.isInAuction &&
          (!ui.craftingFinishedAt || ui.craftingFinishedAt < availableAt),
      );
      if (!fertilizerStack) {
        return errorResponse("Fertilizer not found");
      }
      if (!fertilizerStack.item.isFarmFertilizer) {
        return errorResponse("This item is not fertilizer");
      }

      const claim = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
      });
      if (!claim.success)
        return errorResponse("Could not apply fertilizer — please try again");

      const now = new Date();
      const newFinishAt = applyFertilizerReduction(
        plot.finishAt,
        fertilizerStack.item.farmTimeReductionSeconds,
        now,
      );
      const xpGain = getFertilizerExperience(fertilizerStack.item);

      const fertilizeResult = await ctx.drizzle
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
      if (fertilizeResult.rowsAffected !== 1) {
        return errorResponse("Could not apply fertilizer — please try again");
      }

      const consumed = await updateUserItemQuantityAtomically({
        client: ctx.drizzle,
        userId: ctx.userId,
        userItemId: fertilizerStack.id,
        expectedQuantity: fertilizerStack.quantity,
        nextQuantity: fertilizerStack.quantity - 1,
      });
      if (!consumed) {
        await ctx.drizzle
          .update(farmPlot)
          .set({
            finishAt: plot.finishAt,
            fertilizerApplied: false,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(farmPlot.id, plot.id),
              eq(farmPlot.userId, ctx.userId),
              eq(farmPlot.seedItemId, plot.seedItemId),
              eq(farmPlot.fertilizerApplied, true),
            ),
          );
        return errorResponse("Could not consume fertilizer — please try again");
      }

      const progressAwarded = await awardFarmingProgress(
        ctx.drizzle,
        user,
        xpGain,
        questState,
        "plants_fertilized",
      );
      if (!progressAwarded) {
        return errorResponse(
          "Applied fertilizer but failed to update farming progress",
        );
      }

      return {
        success: true,
        message:
          xpGain > 0
            ? `Applied ${fertilizerStack.item.name} (+${xpGain} farming XP)`
            : `Applied ${fertilizerStack.item.name}`,
        updatedPlot: mapPlotToState(
          { ...plot, finishAt: newFinishAt, fertilizerApplied: true },
          now,
        ),
        farmingExperienceDelta: xpGain,
        inventoryDeltas: [{ itemId: fertilizerStack.itemId, quantityDelta: -1 }],
      };
    }),

  harvestPlot: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Harvest a ready farm plot" } })
    .input(z.object({ plotId: z.string() }))
    .output(farmMutationResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, userItems, plot, questState] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchFarmPlotWithItems(ctx.drizzle, ctx.userId, input.plotId),
        fetchFarmingQuestState(ctx.drizzle, ctx.userId),
      ]);

      const guard = guardFarmingMutation(user);
      if (guard) return guard;
      if (!plot?.seedItem || !plot.yieldItem || !plot.finishAt) {
        return errorResponse("Nothing to harvest");
      }
      if (!isPlotReady(plot.finishAt)) return errorResponse("Crop is not ready yet");

      const inventoryGuard = guardItemAwardInventoryCapacity(
        user,
        userItems,
        plot.yieldItem,
        1,
      );
      if (inventoryGuard) return inventoryGuard;

      const xpGain = getFarmHarvestExperience(plot.yieldItem);
      const now = new Date();

      const harvestResult = await ctx.drizzle
        .update(farmPlot)
        .set({
          seedItemId: null,
          plantedAt: null,
          finishAt: null,
          lastWateredAt: null,
          fertilizerApplied: false,
          updatedAt: now,
        })
        .where(
          and(
            eq(farmPlot.id, plot.id),
            eq(farmPlot.userId, ctx.userId),
            sql`${farmPlot.finishAt} <= ${now}`,
          ),
        );
      if (harvestResult.rowsAffected !== 1) {
        return errorResponse("Could not harvest — please try again");
      }

      const itemAwarded = await awardItemToUser(
        ctx.drizzle,
        ctx.userId,
        plot.yieldItem,
        1,
        userItems,
      );
      if (!itemAwarded) {
        return errorResponse("Harvested crop but failed to grant item");
      }

      await recordFirstFarmHarvests(ctx.drizzle, ctx.userId, [plot.yieldItem.id], now);
      const collectionCount = await getFarmCollectionCount(ctx.drizzle, ctx.userId);

      const progressAwarded = await awardFarmingProgress(
        ctx.drizzle,
        user,
        xpGain,
        questState,
        "plants_harvested",
        1,
        collectionCount,
      );
      if (!progressAwarded) {
        return errorResponse("Harvested crop but failed to update farming progress");
      }

      return {
        success: true,
        message:
          xpGain > 0
            ? `Harvested ${plot.yieldItem.name} (+${xpGain} farming XP)`
            : `Harvested ${plot.yieldItem.name}`,
        updatedPlot: mapPlotToState(
          {
            ...plot,
            seedItemId: null,
            plantedAt: null,
            finishAt: null,
            lastWateredAt: null,
            fertilizerApplied: false,
            seedItem: null,
            yieldItem: null,
          },
          now,
        ),
        farmingExperienceDelta: xpGain,
        inventoryDeltas: [{ itemId: plot.yieldItem.id, quantityDelta: 1 }],
      };
    }),

  plantAllEmpty: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Plant a seed in every empty farm plot" },
    })
    .input(z.object({ seedItemId: z.string() }))
    .output(farmMutationResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, userItems, seedItem, plots, questState] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.item.findFirst({ where: eq(item.id, input.seedItemId) }),
        ctx.drizzle.query.farmPlot.findMany({
          where: eq(farmPlot.userId, ctx.userId),
        }),
        fetchFarmingQuestState(ctx.drizzle, ctx.userId),
      ]);

      const guard = guardFarmingMutation(user);
      if (guard) return guard;
      if (!seedItem?.isFarmSeed) return errorResponse("This item is not a farm seed");
      if (!seedItem.farmYieldItemId)
        return errorResponse("Seed has no crop configured");
      if (seedItem.farmGrowTimeSeconds <= 0) {
        return errorResponse("Seed has invalid grow time");
      }
      const farmingLevel = getFarmingLevel(user.farmingExperience);
      if (farmingLevel < seedItem.farmMinLevel) {
        return errorResponse(`Requires farming level ${seedItem.farmMinLevel}`);
      }

      const totalPlots = getTotalFarmPlots(user.farmPlotsPurchased);
      const emptyPlots = plots.filter(
        (plot) => plot.slotIndex < totalPlots && !plot.seedItemId,
      );
      if (emptyPlots.length === 0) return errorResponse("There are no empty plots");

      const now = new Date();
      const seedStacks = getAvailableFarmItemStacks(userItems, input.seedItemId, now);
      const seedQuantity = seedStacks.reduce((sum, stack) => sum + stack.quantity, 0);
      if (seedQuantity < emptyPlots.length) {
        return errorResponse(
          `Not enough ${seedItem.name}: need ${emptyPlots.length}, have ${seedQuantity}`,
        );
      }

      const claim = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        where: [eq(userData.status, "AWAKE")],
      });
      if (!claim.success)
        return errorResponse("Could not plant all — please try again");

      const growTimeSeconds = getFarmGrowTimeSeconds(
        seedItem.farmGrowTimeSeconds,
        user,
      );
      const finishAt = new Date(now.getTime() + growTimeSeconds * 1000);
      const emptyPlotIds = emptyPlots.map((plot) => plot.id);
      const plantResult = await ctx.drizzle
        .update(farmPlot)
        .set({
          seedItemId: seedItem.id,
          plantedAt: now,
          finishAt,
          lastWateredAt: null,
          fertilizerApplied: false,
          updatedAt: now,
        })
        .where(
          and(
            eq(farmPlot.userId, ctx.userId),
            inArray(farmPlot.id, emptyPlotIds),
            isNull(farmPlot.seedItemId),
          ),
        );
      if (plantResult.rowsAffected !== emptyPlots.length) {
        await rollbackBulkPlant(
          ctx.drizzle,
          ctx.userId,
          emptyPlotIds,
          seedItem.id,
          now,
        );
        return errorResponse("Could not plant all — please try again");
      }

      const consumed = await consumeFarmItemQuantity(
        ctx.drizzle,
        ctx.userId,
        seedStacks,
        emptyPlots.length,
      );
      if (!consumed) {
        await rollbackBulkPlant(
          ctx.drizzle,
          ctx.userId,
          emptyPlotIds,
          seedItem.id,
          now,
        );
        return errorResponse("Could not consume seeds — please try again");
      }

      const xpGain = getFarmPlantExperience(seedItem) * emptyPlots.length;
      const progressAwarded = await awardFarmingProgress(
        ctx.drizzle,
        user,
        xpGain,
        questState,
        "seeds_planted",
        emptyPlots.length,
      );
      if (!progressAwarded) {
        return errorResponse("Planted seeds but failed to update farming progress");
      }

      return {
        success: true,
        message: `Planted ${emptyPlots.length} ${seedItem.name}${xpGain > 0 ? ` (+${xpGain} farming XP)` : ""}`,
        farmingExperienceDelta: xpGain,
        inventoryDeltas: [{ itemId: seedItem.id, quantityDelta: -emptyPlots.length }],
      };
    }),

  waterAll: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Water every eligible farm plot" } })
    .output(farmMutationResponseSchema)
    .mutation(async ({ ctx }) => {
      const [user, plots, questState] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.farmPlot.findMany({
          where: eq(farmPlot.userId, ctx.userId),
          with: { seedItem: true },
        }),
        fetchFarmingQuestState(ctx.drizzle, ctx.userId),
      ]);
      const guard = guardFarmingMutation(user);
      if (guard) return guard;

      const now = new Date();
      const totalPlots = getTotalFarmPlots(user.farmPlotsPurchased);
      const waterable = plots.filter(
        (plot) =>
          plot.slotIndex < totalPlots &&
          !!plot.seedItemId &&
          !!plot.finishAt &&
          !isPlotReady(plot.finishAt, now) &&
          mapPlotToState(plot, now).canWater,
      );
      if (waterable.length === 0) return errorResponse("No plots need water");

      const results = await Promise.all(
        waterable.map(async (plot) => {
          if (!plot.finishAt) return false;
          const newFinishAt = applyWaterReduction(plot.finishAt, now);
          const result = await ctx.drizzle
            .update(farmPlot)
            .set({ finishAt: newFinishAt, lastWateredAt: now, updatedAt: now })
            .where(
              and(
                eq(farmPlot.id, plot.id),
                eq(farmPlot.userId, ctx.userId),
                eq(farmPlot.finishAt, plot.finishAt),
                plot.lastWateredAt
                  ? eq(farmPlot.lastWateredAt, plot.lastWateredAt)
                  : isNull(farmPlot.lastWateredAt),
              ),
            );
          return result.rowsAffected === 1;
        }),
      );
      const wateredCount = results.filter(Boolean).length;
      if (wateredCount === 0)
        return errorResponse("Could not water all — please try again");

      const xpGain = FARM_WATER_EXPERIENCE * wateredCount;
      const progressAwarded = await awardFarmingProgress(
        ctx.drizzle,
        user,
        xpGain,
        questState,
        "plants_watered",
        wateredCount,
      );
      if (!progressAwarded) {
        return errorResponse("Watered crops but failed to update farming progress");
      }
      return {
        success: true,
        message: `Watered ${wateredCount} plot${wateredCount === 1 ? "" : "s"} (+${xpGain} farming XP)`,
        farmingExperienceDelta: xpGain,
      };
    }),

  fertilizeAll: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Fertilize every eligible farm plot" } })
    .input(z.object({ userItemId: z.string() }))
    .output(farmMutationResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, userItems, plots, questState] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.farmPlot.findMany({
          where: eq(farmPlot.userId, ctx.userId),
        }),
        fetchFarmingQuestState(ctx.drizzle, ctx.userId),
      ]);
      const guard = guardFarmingMutation(user);
      if (guard) return guard;

      const now = new Date();
      const fertilizerStack = userItems.find(
        (stack) =>
          stack.id === input.userItemId &&
          !stack.storedAtHome &&
          !stack.isInAuction &&
          (!stack.craftingFinishedAt || stack.craftingFinishedAt < now),
      );
      if (!fertilizerStack?.item.isFarmFertilizer) {
        return errorResponse("Fertilizer not found");
      }
      const totalPlots = getTotalFarmPlots(user.farmPlotsPurchased);
      const fertilizable = plots.filter(
        (plot) =>
          plot.slotIndex < totalPlots &&
          !!plot.seedItemId &&
          !!plot.finishAt &&
          !plot.fertilizerApplied &&
          !isPlotReady(plot.finishAt, now),
      );
      if (fertilizable.length === 0) {
        return errorResponse("No plots can be fertilized");
      }
      if (fertilizerStack.quantity < fertilizable.length) {
        return errorResponse(
          `Not enough ${fertilizerStack.item.name}: need ${fertilizable.length}, have ${fertilizerStack.quantity}`,
        );
      }

      const claim = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
      });
      if (!claim.success) {
        return errorResponse("Could not fertilize all — please try again");
      }

      const updates = await Promise.all(
        fertilizable.map(async (plot) => {
          if (!plot.finishAt) return false;
          const newFinishAt = applyFertilizerReduction(
            plot.finishAt,
            fertilizerStack.item.farmTimeReductionSeconds,
            now,
          );
          const result = await ctx.drizzle
            .update(farmPlot)
            .set({ finishAt: newFinishAt, fertilizerApplied: true, updatedAt: now })
            .where(
              and(
                eq(farmPlot.id, plot.id),
                eq(farmPlot.userId, ctx.userId),
                eq(farmPlot.finishAt, plot.finishAt),
                eq(farmPlot.fertilizerApplied, false),
              ),
            );
          return result.rowsAffected === 1;
        }),
      );
      if (updates.some((updated) => !updated)) {
        await rollbackBulkFertilizer(ctx.drizzle, ctx.userId, fertilizable, now);
        return errorResponse("Could not fertilize all — please try again");
      }

      const consumed = await updateUserItemQuantityAtomically({
        client: ctx.drizzle,
        userId: ctx.userId,
        userItemId: fertilizerStack.id,
        expectedQuantity: fertilizerStack.quantity,
        nextQuantity: fertilizerStack.quantity - fertilizable.length,
      });
      if (!consumed) {
        await rollbackBulkFertilizer(ctx.drizzle, ctx.userId, fertilizable, now);
        return errorResponse("Could not consume fertilizer — please try again");
      }

      const xpGain =
        getFertilizerExperience(fertilizerStack.item) * fertilizable.length;
      const progressAwarded = await awardFarmingProgress(
        ctx.drizzle,
        user,
        xpGain,
        questState,
        "plants_fertilized",
        fertilizable.length,
      );
      if (!progressAwarded) {
        return errorResponse("Fertilized crops but failed to update farming progress");
      }
      return {
        success: true,
        message: `Fertilized ${fertilizable.length} plot${fertilizable.length === 1 ? "" : "s"}${xpGain > 0 ? ` (+${xpGain} farming XP)` : ""}`,
        farmingExperienceDelta: xpGain,
        inventoryDeltas: [
          { itemId: fertilizerStack.itemId, quantityDelta: -fertilizable.length },
        ],
      };
    }),

  harvestAll: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Harvest every ready farm plot" } })
    .output(farmMutationResponseSchema)
    .mutation(async ({ ctx }) => {
      const [user, userItems, plots, questState] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchFarmPlotsWithItems(ctx.drizzle, ctx.userId),
        fetchFarmingQuestState(ctx.drizzle, ctx.userId),
      ]);
      const guard = guardFarmingMutation(user);
      if (guard) return guard;

      const now = new Date();
      const totalPlots = getTotalFarmPlots(user.farmPlotsPurchased);
      const readyPlots = plots.filter(
        (plot) =>
          plot.slotIndex < totalPlots &&
          !!plot.seedItem &&
          !!plot.yieldItem &&
          !!plot.finishAt &&
          isPlotReady(plot.finishAt, now),
      );
      if (readyPlots.length === 0) return errorResponse("No crops are ready");

      const harvests = new Map<string, { item: Item; quantity: number }>();
      for (const plot of readyPlots) {
        if (!plot.yieldItem) continue;
        const existing = harvests.get(plot.yieldItem.id);
        if (existing) existing.quantity += 1;
        else harvests.set(plot.yieldItem.id, { item: plot.yieldItem, quantity: 1 });
      }
      const inventoryGuard = guardBulkItemAwardInventoryCapacity(user, userItems, [
        ...harvests.values(),
      ]);
      if (inventoryGuard) return inventoryGuard;

      const readyPlotIds = readyPlots.map((plot) => plot.id);
      const harvestResult = await ctx.drizzle
        .update(farmPlot)
        .set({
          seedItemId: null,
          plantedAt: null,
          finishAt: null,
          lastWateredAt: null,
          fertilizerApplied: false,
          updatedAt: now,
        })
        .where(
          and(
            eq(farmPlot.userId, ctx.userId),
            inArray(farmPlot.id, readyPlotIds),
            sql`${farmPlot.finishAt} <= ${now}`,
          ),
        );
      if (harvestResult.rowsAffected !== readyPlots.length) {
        return errorResponse("Could not harvest all — please try again");
      }

      // Distinct crops land in distinct stacks, so the grants do not contend and can
      // run together instead of paying one inventory round-trip per crop type.
      const awards = await Promise.all(
        [...harvests.values()].map((harvest) =>
          awardItemToUser(
            ctx.drizzle,
            ctx.userId,
            harvest.item,
            harvest.quantity,
            userItems,
          ),
        ),
      );
      if (awards.some((awarded) => !awarded)) {
        return errorResponse("Harvested crops but failed to grant items");
      }
      await recordFirstFarmHarvests(ctx.drizzle, ctx.userId, [...harvests.keys()], now);
      const collectionCount = await getFarmCollectionCount(ctx.drizzle, ctx.userId);
      const xpGain = readyPlots.reduce(
        (sum, plot) =>
          sum + (plot.yieldItem ? getFarmHarvestExperience(plot.yieldItem) : 0),
        0,
      );
      const progressAwarded = await awardFarmingProgress(
        ctx.drizzle,
        user,
        xpGain,
        questState,
        "plants_harvested",
        readyPlots.length,
        collectionCount,
      );
      if (!progressAwarded) {
        return errorResponse("Harvested crops but failed to update farming progress");
      }
      return {
        success: true,
        message: `Harvested ${readyPlots.length} plot${readyPlots.length === 1 ? "" : "s"}${xpGain > 0 ? ` (+${xpGain} farming XP)` : ""}`,
        farmingExperienceDelta: xpGain,
        inventoryDeltas: [...harvests.entries()].map(([itemId, harvest]) => ({
          itemId,
          quantityDelta: harvest.quantity,
        })),
      };
    }),

  sellCrop: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Sell a farm crop for farm currency" } })
    .input(
      z.object({
        userItemId: z.string(),
        quantity: z.int().min(1).max(FARM_MAX_CROP_SELL_QUANTITY).prefault(1),
      }),
    )
    .output(farmMutationResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [user, userItems] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);

      const guard = guardFarmingMutation(user);
      if (guard) return guard;

      const cropStack = userItems.find((ui) => ui.id === input.userItemId);
      if (!cropStack) return errorResponse("Item not found");
      if (
        cropStack.storedAtHome ||
        cropStack.isInAuction ||
        (cropStack.craftingFinishedAt && cropStack.craftingFinishedAt >= new Date())
      ) {
        return errorResponse("Crop is not available in inventory");
      }
      if (cropStack.item.isFarmSeed || cropStack.item.isFarmFertilizer) {
        return errorResponse("This crop cannot be sold here");
      }
      const sellValue = cropStack.item.farmSellValue;
      if (sellValue <= 0) return errorResponse("This crop cannot be sold here");
      if (cropStack.quantity < input.quantity) return errorResponse("Not enough crops");

      const totalValue = sellValue * input.quantity;
      const nextQuantity = cropStack.quantity - input.quantity;

      const consumed = await updateUserItemQuantityAtomically({
        client: ctx.drizzle,
        userId: ctx.userId,
        userItemId: cropStack.id,
        expectedQuantity: cropStack.quantity,
        nextQuantity,
      });
      if (!consumed) return errorResponse("Could not sell crop — please try again");

      const currencyResult = await ctx.drizzle
        .update(userData)
        .set({ farmCurrency: sql`${userData.farmCurrency} + ${totalValue}` })
        .where(eq(userData.userId, ctx.userId));

      if (currencyResult.rowsAffected !== 1) {
        return errorResponse("Could not grant farm currency");
      }

      return {
        success: true,
        message: `Sold ${input.quantity}x ${cropStack.item.name} for ${totalValue} farm coins`,
        farmCurrencyDelta: totalValue,
        inventoryDeltas: [{ itemId: cropStack.itemId, quantityDelta: -input.quantity }],
      };
    }),

  buyShopItem: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Buy an item from the farm shop" } })
    .input(farmShopPurchaseInputSchema)
    .output(farmMutationResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // The inventory is only consulted on the SEED/FERTILIZER branch, but fetching it
      // alongside the user keeps the common purchase path at one round-trip instead of
      // two; plot and extractor upgrades simply ignore the extra read.
      const [user, shopEntry, userItems] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        resolveShopEntry(ctx.drizzle, input.type, input.itemId),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      const guard = guardFarmingMutation(user);
      if (guard) return guard;

      const farmingLevel = getFarmingLevel(user.farmingExperience);
      if (!shopEntry) return errorResponse("Shop item not found");
      if (
        (input.type === "PLOT" || input.type === "EXTRACTOR") &&
        input.quantity !== 1
      ) {
        return errorResponse("Upgrades can only be purchased one at a time");
      }
      const totalCost = shopEntry.cost * input.quantity;
      if (farmingLevel < shopEntry.minLevel) {
        return errorResponse(`Requires farming level ${shopEntry.minLevel}`);
      }
      if (user.farmCurrency < totalCost) {
        return errorResponse("Not enough farm coins");
      }

      if (input.type === "PLOT") {
        const maxPurchased = getMaxPurchasablePlots(farmingLevel);
        if (user.farmPlotsPurchased >= maxPurchased) {
          return errorResponse("Plot purchase limit reached for your level");
        }
        const newTotal = FARM_STARTING_PLOTS + user.farmPlotsPurchased + 1;
        if (newTotal > FARM_MAX_PLOTS) {
          return errorResponse("Maximum farm size reached");
        }

        const currencyResult = await ctx.drizzle
          .update(userData)
          .set({
            farmCurrency: sql`${userData.farmCurrency} - ${shopEntry.cost}`,
            farmPlotsPurchased: sql`${userData.farmPlotsPurchased} + 1`,
          })
          .where(
            and(
              eq(userData.userId, ctx.userId),
              gte(userData.farmCurrency, shopEntry.cost),
              eq(userData.farmPlotsPurchased, user.farmPlotsPurchased),
              lt(userData.farmPlotsPurchased, maxPurchased),
              sql`${FARM_STARTING_PLOTS} + ${userData.farmPlotsPurchased} + 1 <= ${FARM_MAX_PLOTS}`,
            ),
          );
        if (currencyResult.rowsAffected !== 1) {
          return errorResponse("Could not purchase plot — please try again");
        }

        await ctx.drizzle
          .insert(farmPlot)
          .values({
            id: nanoid(),
            userId: ctx.userId,
            slotIndex: newTotal - 1,
          })
          .onDuplicateKeyUpdate({ set: { id: sql`id` } });

        return {
          success: true,
          message: "Purchased an extra farm plot",
          farmCurrencyDelta: -shopEntry.cost,
          totalPlots: newTotal,
          farmPlotsPurchasedDelta: 1,
        };
      }

      if (input.type === "EXTRACTOR") {
        const maxExtractors = getMaxExtractors(farmingLevel);
        if (user.farmExtractorsOwned >= maxExtractors) {
          return errorResponse("Extractor limit reached for your level");
        }

        const currencyResult = await ctx.drizzle
          .update(userData)
          .set({
            farmCurrency: sql`${userData.farmCurrency} - ${shopEntry.cost}`,
            farmExtractorsOwned: sql`${userData.farmExtractorsOwned} + 1`,
          })
          .where(
            and(
              eq(userData.userId, ctx.userId),
              gte(userData.farmCurrency, shopEntry.cost),
              eq(userData.farmExtractorsOwned, user.farmExtractorsOwned),
              lt(userData.farmExtractorsOwned, maxExtractors),
            ),
          );
        if (currencyResult.rowsAffected !== 1) {
          return errorResponse("Could not purchase extractor — please try again");
        }

        return {
          success: true,
          message: "Purchased a seed extractor",
          farmCurrencyDelta: -shopEntry.cost,
          farmExtractorsOwnedDelta: 1,
        };
      }

      if (!input.itemId) return errorResponse("Item required");
      if (!("itemInfo" in shopEntry)) return errorResponse("Shop item not found");

      const inventoryGuard = guardItemAwardInventoryCapacity(
        user,
        userItems,
        shopEntry.itemInfo,
        input.quantity,
      );
      if (inventoryGuard) return inventoryGuard;

      const currencyResult = await ctx.drizzle
        .update(userData)
        .set({ farmCurrency: sql`${userData.farmCurrency} - ${totalCost}` })
        .where(
          and(eq(userData.userId, ctx.userId), gte(userData.farmCurrency, totalCost)),
        );
      if (currencyResult.rowsAffected !== 1) {
        return errorResponse("Not enough farm coins");
      }

      const itemAwarded = await awardItemToUser(
        ctx.drizzle,
        ctx.userId,
        shopEntry.itemInfo,
        input.quantity,
        userItems,
      );
      if (!itemAwarded) {
        return errorResponse("Purchase completed but failed to grant item");
      }
      return {
        success: true,
        message: `Purchased ${input.quantity}x ${shopEntry.label}`,
        farmCurrencyDelta: -totalCost,
        inventoryDeltas: [
          { itemId: shopEntry.itemInfo.id, quantityDelta: input.quantity },
        ],
      };
    }),

  extractSeeds: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Extract seeds from a crop using an extractor",
      },
    })
    .input(
      z.object({
        extractorSlot: z.int().min(0),
        userItemId: z.string(),
        quantity: z.int().min(1).prefault(1),
      }),
    )
    .output(farmMutationResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const [user, userItems, extractions] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchUserExtractions(ctx.drizzle, ctx.userId),
      ]);
      const activeExtraction = extractions.find(
        (extraction) => extraction.extractorSlot === input.extractorSlot,
      );

      const guard = guardFarmingMutation(user);
      if (guard) return guard;
      if (user.farmExtractorsOwned < 1) {
        return errorResponse("You need a seed extractor");
      }
      if (input.extractorSlot >= user.farmExtractorsOwned) {
        return errorResponse("Seed extractor not found");
      }
      if (activeExtraction) {
        return errorResponse(
          `Seed extractor ${input.extractorSlot + 1} is already processing crops`,
        );
      }
      if (input.quantity > FARM_CROPS_PER_EXTRACTOR) {
        return errorResponse(
          `Each extractor can process up to ${FARM_CROPS_PER_EXTRACTOR} crops at once`,
        );
      }

      const cropStack = userItems.find((ui) => ui.id === input.userItemId);
      if (!cropStack || cropStack.quantity < input.quantity) {
        return errorResponse("Crop not found");
      }
      if (
        cropStack.storedAtHome ||
        cropStack.isInAuction ||
        (cropStack.craftingFinishedAt && cropStack.craftingFinishedAt >= new Date())
      ) {
        return errorResponse("Crop is not available in inventory");
      }
      if (
        !cropStack.item.farmExtractSeedItemId ||
        cropStack.item.farmExtractSeedCount < 1
      ) {
        return errorResponse("This crop cannot be extracted");
      }

      const seedsToGrant = cropStack.item.farmExtractSeedCount * input.quantity;
      const seedItem = await ctx.drizzle.query.item.findFirst({
        where: eq(item.id, cropStack.item.farmExtractSeedItemId),
      });
      if (!seedItem) return errorResponse("Seed item not found");

      // The other extractors' seeds land in this same inventory. Sizing this job against
      // today's free rows alone lets two of them each fit on their own and overflow the
      // material cap together when they settle.
      const inventoryGuard = guardBulkItemAwardInventoryCapacity(user, userItems, [
        ...extractions
          .filter((extraction) => extraction.seedItem && extraction.seedQuantity > 0)
          .map((extraction) => ({
            item: extraction.seedItem as Item,
            quantity: extraction.seedQuantity,
          })),
        { item: seedItem, quantity: seedsToGrant },
      ]);
      if (inventoryGuard) return inventoryGuard;

      const claim = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        where: [eq(userData.status, "AWAKE")],
      });
      if (!claim.success) {
        return errorResponse("Could not start extraction — please try again");
      }

      const extractionId = nanoid();
      const extractionSeconds = getSeedExtractionDurationSeconds(input.quantity);
      const finishAt = new Date(now.getTime() + extractionSeconds * 1000);
      await ctx.drizzle
        .insert(farmExtraction)
        .values({
          id: extractionId,
          userId: ctx.userId,
          extractorSlot: input.extractorSlot,
          cropItemId: cropStack.itemId,
          seedItemId: seedItem.id,
          cropQuantity: input.quantity,
          seedQuantity: seedsToGrant,
          startedAt: now,
          finishAt,
        })
        .onDuplicateKeyUpdate({ set: { id: sql`id` } });
      const extractionCreated = await ctx.drizzle.query.farmExtraction.findFirst({
        where: and(
          eq(farmExtraction.id, extractionId),
          eq(farmExtraction.userId, ctx.userId),
          eq(farmExtraction.extractorSlot, input.extractorSlot),
        ),
      });
      if (!extractionCreated) {
        return errorResponse(
          `Seed extractor ${input.extractorSlot + 1} is already processing crops`,
        );
      }

      const consumed = await updateUserItemQuantityAtomically({
        client: ctx.drizzle,
        userId: ctx.userId,
        userItemId: cropStack.id,
        expectedQuantity: cropStack.quantity,
        nextQuantity: cropStack.quantity - input.quantity,
      });
      if (!consumed) {
        await ctx.drizzle
          .delete(farmExtraction)
          .where(
            and(
              eq(farmExtraction.id, extractionId),
              eq(farmExtraction.userId, ctx.userId),
            ),
          );
        return errorResponse("Could not consume crop — please try again");
      }

      return {
        success: true,
        message: `Seed extractor ${input.extractorSlot + 1} started processing ${input.quantity} ${cropStack.item.name}. Ready in ${extractionSeconds / 60} minutes.`,
        inventoryDeltas: [{ itemId: cropStack.itemId, quantityDelta: -input.quantity }],
      };
    }),
});

const guardFarmingMutation = (user: Awaited<ReturnType<typeof fetchUser>>) => {
  if (user.isBanned) return errorResponse("You are banned");
  if (user.status !== "AWAKE") {
    return errorResponse("You must be awake to farm");
  }
  if (user.sector === MAP_WAKE_ISLAND_SECTOR) {
    return errorResponse("Cannot farm on Wake Island");
  }
  return null;
};

const fetchFarmPlotWithItems = async (
  client: DrizzleClient,
  userId: string,
  plotId: string,
) => {
  const plot = await client.query.farmPlot.findFirst({
    where: and(eq(farmPlot.id, plotId), eq(farmPlot.userId, userId)),
    with: { seedItem: true },
  });
  if (!plot) return null;
  if (!plot.seedItemId) {
    return { ...plot, seedItem: null, yieldItem: null };
  }

  const seedItem = plot.seedItem ?? null;
  const yieldItem = seedItem?.farmYieldItemId
    ? ((await client.query.item.findFirst({
        where: eq(item.id, seedItem.farmYieldItemId),
      })) ?? null)
    : null;

  return { ...plot, seedItem, yieldItem };
};

const fetchFarmPlotsWithItems = async (client: DrizzleClient, userId: string) => {
  const plots = await client.query.farmPlot.findMany({
    where: eq(farmPlot.userId, userId),
    with: { seedItem: true },
  });
  const yieldItemIds = [
    ...new Set(
      plots
        .map((plot) => plot.seedItem?.farmYieldItemId)
        .filter((itemId): itemId is string => !!itemId),
    ),
  ];
  const yieldItems =
    yieldItemIds.length > 0
      ? await client.query.item.findMany({ where: inArray(item.id, yieldItemIds) })
      : [];
  const yieldItemsById = new Map(
    yieldItems.map((yieldItem) => [yieldItem.id, yieldItem]),
  );
  return plots.map((plot) => ({
    ...plot,
    seedItem: plot.seedItem ?? null,
    yieldItem: plot.seedItem?.farmYieldItemId
      ? (yieldItemsById.get(plot.seedItem.farmYieldItemId) ?? null)
      : null,
  }));
};

const getAvailableFarmItemStacks = (
  userItems: Awaited<ReturnType<typeof fetchUserItems>>,
  itemId: string,
  now: Date,
) =>
  userItems.filter(
    (stack) =>
      stack.itemId === itemId &&
      stack.quantity > 0 &&
      !stack.storedAtHome &&
      !stack.isInAuction &&
      (!stack.craftingFinishedAt || stack.craftingFinishedAt < now),
  );

const consumeFarmItemQuantity = async (
  client: DrizzleClient,
  userId: string,
  stacks: Awaited<ReturnType<typeof fetchUserItems>>,
  quantity: number,
) => {
  let remaining = quantity;
  const consumed: { stack: (typeof stacks)[number]; quantity: number }[] = [];
  for (const stack of stacks) {
    if (remaining <= 0) break;
    const stackQuantity = Math.min(remaining, stack.quantity);
    const success = await updateUserItemQuantityAtomically({
      client,
      userId,
      userItemId: stack.id,
      expectedQuantity: stack.quantity,
      nextQuantity: stack.quantity - stackQuantity,
    });
    if (!success) {
      await Promise.all(
        consumed.map(({ stack: consumedStack, quantity: consumedQuantity }) =>
          refundUserItemQuantityAtomically({
            client,
            itemSnapshot: consumedStack,
            quantity: consumedQuantity,
          }),
        ),
      );
      return false;
    }
    consumed.push({ stack, quantity: stackQuantity });
    remaining -= stackQuantity;
  }
  if (remaining === 0) return true;
  await Promise.all(
    consumed.map(({ stack, quantity: consumedQuantity }) =>
      refundUserItemQuantityAtomically({
        client,
        itemSnapshot: stack,
        quantity: consumedQuantity,
      }),
    ),
  );
  return false;
};

const rollbackBulkPlant = async (
  client: DrizzleClient,
  userId: string,
  plotIds: string[],
  seedItemId: string,
  plantedAt: Date,
) => {
  await client
    .update(farmPlot)
    .set({
      seedItemId: null,
      plantedAt: null,
      finishAt: null,
      lastWateredAt: null,
      fertilizerApplied: false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(farmPlot.userId, userId),
        inArray(farmPlot.id, plotIds),
        eq(farmPlot.seedItemId, seedItemId),
        eq(farmPlot.plantedAt, plantedAt),
      ),
    );
};

const rollbackBulkFertilizer = async (
  client: DrizzleClient,
  userId: string,
  plots: { id: string; finishAt: Date | null }[],
  updatedAt: Date,
) => {
  await Promise.all(
    plots.map((plot) =>
      plot.finishAt
        ? client
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
            )
        : Promise.resolve(),
    ),
  );
};

const resolveShopEntry = async (
  client: DrizzleClient,
  type: "PLOT" | "EXTRACTOR" | "SEED" | "FERTILIZER",
  itemId: string | undefined,
) => {
  if (type === "SEED" || type === "FERTILIZER") {
    if (!itemId) return null;
    const shopItem = await client.query.item.findFirst({ where: eq(item.id, itemId) });
    if (!shopItem) return null;
    if (type === "SEED" && !shopItem.isFarmSeed) return null;
    if (type === "FERTILIZER" && !shopItem.isFarmFertilizer) return null;
    if (shopItem.hidden || shopItem.farmSellValue <= 0) return null;
    if (type === "SEED") {
      if (shopItem.inShop) return null;
      return {
        type,
        label: shopItem.name,
        cost: shopItem.farmSellValue,
        minLevel: shopItem.farmMinLevel,
        itemId: shopItem.id,
        itemInfo: shopItem,
      };
    }
    return {
      type,
      label: shopItem.name,
      cost: shopItem.farmSellValue,
      minLevel: shopItem.farmMinLevel,
      itemId: shopItem.id,
      itemInfo: shopItem,
    };
  }

  const entry = FARM_SHOP_ENTRIES.find((e) => e.type === type);
  return entry ?? null;
};

const buildShopEntries = async (
  client: DrizzleClient,
  user: Awaited<ReturnType<typeof fetchUser>>,
): Promise<FarmShopEntryState[]> => {
  const farmingLevel = getFarmingLevel(user.farmingExperience);
  const maxPurchased = getMaxPurchasablePlots(farmingLevel);
  const maxExtractors = getMaxExtractors(farmingLevel);

  const [farmShopSeeds, farmShopFertilizers] = await Promise.all([
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

  const dynamicItems = [...farmShopSeeds, ...farmShopFertilizers];
  const shopYieldIds = farmShopSeeds
    .map((seed) => seed.farmYieldItemId)
    .filter((id): id is string => !!id);
  const shopYieldItems =
    shopYieldIds.length > 0
      ? await client.query.item.findMany({ where: inArray(item.id, shopYieldIds) })
      : [];
  const shopYieldById = new Map(
    shopYieldItems.map((yieldItem) => [yieldItem.id, yieldItem]),
  );

  const staticEntries: FarmShopEntryState[] = FARM_SHOP_ENTRIES.map((entry) => {
    let canPurchase = farmingLevel >= entry.minLevel && user.farmCurrency >= entry.cost;
    let lockedReason: string | undefined;

    if (farmingLevel < entry.minLevel) {
      lockedReason = `Requires level ${entry.minLevel}`;
      canPurchase = false;
    } else if (user.farmCurrency < entry.cost) {
      lockedReason = "Not enough farm coins";
      canPurchase = false;
    } else if (
      entry.type === "PLOT" &&
      FARM_STARTING_PLOTS + user.farmPlotsPurchased + 1 > FARM_MAX_PLOTS
    ) {
      lockedReason = "Maximum farm size reached";
      canPurchase = false;
    } else if (entry.type === "PLOT" && user.farmPlotsPurchased >= maxPurchased) {
      lockedReason = "Plot limit reached";
      canPurchase = false;
    } else if (
      entry.type === "EXTRACTOR" &&
      user.farmExtractorsOwned >= maxExtractors
    ) {
      lockedReason = "Extractor limit reached";
      canPurchase = false;
    }

    return {
      type: entry.type,
      label: entry.label,
      cost: entry.cost,
      minLevel: entry.minLevel,
      canAfford: user.farmCurrency >= entry.cost,
      canPurchase,
      lockedReason,
    };
  });

  const dynamicEntries: FarmShopEntryState[] = dynamicItems.map((shopItem) => {
    const cost = shopItem.farmSellValue;
    const type = shopItem.isFarmSeed ? "SEED" : "FERTILIZER";
    let canPurchase =
      farmingLevel >= shopItem.farmMinLevel && user.farmCurrency >= cost;
    let lockedReason: string | undefined;
    if (farmingLevel < shopItem.farmMinLevel) {
      lockedReason = `Requires level ${shopItem.farmMinLevel}`;
      canPurchase = false;
    } else if (user.farmCurrency < cost) {
      lockedReason = "Not enough farm coins";
      canPurchase = false;
    }
    const yieldItem = shopItem.farmYieldItemId
      ? shopYieldById.get(shopItem.farmYieldItemId)
      : undefined;
    return {
      type,
      label: shopItem.name,
      cost,
      minLevel: shopItem.farmMinLevel,
      itemId: shopItem.id,
      itemName: shopItem.name,
      itemImage: shopItem.image,
      canAfford: user.farmCurrency >= cost,
      canPurchase,
      lockedReason,
      growTimeSeconds: shopItem.isFarmSeed
        ? getFarmGrowTimeSeconds(shopItem.farmGrowTimeSeconds, user)
        : undefined,
      yieldItemId: yieldItem?.id,
      yieldName: yieldItem?.name,
      yieldImage: yieldItem?.image,
      yieldQuantity: shopItem.isFarmSeed ? 1 : undefined,
      experience: shopItem.isFarmSeed
        ? getFarmPlantExperience(shopItem)
        : getFertilizerExperience(shopItem),
      fertilizerTimeReductionSeconds: shopItem.isFarmFertilizer
        ? shopItem.farmTimeReductionSeconds
        : undefined,
    };
  });

  return [...staticEntries, ...dynamicEntries];
};

export const buildFarmState = async (
  client: DrizzleClient,
  userId: string,
): Promise<FarmStateResponse | { success: false; message: string }> => {
  const now = new Date();
  const [user, activeSeedExtractions] = await Promise.all([
    fetchUser(client, userId),
    settleFarmExtractions(client, userId, now),
  ]);
  const totalPlots = getTotalFarmPlots(user.farmPlotsPurchased);

  const [plotsRaw, userItems, shopEntries, collectionLog] = await Promise.all([
    ensureFarmPlots(client, userId, totalPlots),
    fetchUserItems(client, userId),
    buildShopEntries(client, user),
    getFarmCollectionState(client, userId),
  ]);

  const yieldIds = [
    ...plotsRaw.map((plot) => plot.seedItem?.farmYieldItemId),
    ...userItems.map((userItem) => userItem.item.farmYieldItemId),
  ].filter(Boolean) as string[];
  const yieldItems =
    yieldIds.length > 0
      ? await client.query.item.findMany({ where: inArray(item.id, yieldIds) })
      : [];

  const yieldItemsById = new Map(
    yieldItems.map((yieldItem) => [yieldItem.id, yieldItem]),
  );
  const orphanedPlotRefs = plotsRaw.flatMap((plot) => {
    if (!plot.seedItemId) return [];
    const seedItem = plot.seedItem;
    const hasValidYield =
      seedItem?.farmYieldItemId && yieldItemsById.has(seedItem.farmYieldItemId);
    if (seedItem?.isFarmSeed && hasValidYield) return [];
    return [{ plotId: plot.id, seedItemId: plot.seedItemId }];
  });
  const clearedOrphanIds = new Set(
    (
      await Promise.all(
        orphanedPlotRefs.map(async ({ plotId, seedItemId }) => {
          const result = await client
            .update(farmPlot)
            .set({
              seedItemId: null,
              plantedAt: null,
              finishAt: null,
              lastWateredAt: null,
              fertilizerApplied: false,
              updatedAt: now,
            })
            .where(
              and(
                eq(farmPlot.id, plotId),
                eq(farmPlot.userId, userId),
                eq(farmPlot.seedItemId, seedItemId),
              ),
            );
          return result.rowsAffected === 1 ? plotId : null;
        }),
      )
    ).filter((plotId): plotId is string => plotId !== null),
  );
  const plotsForState = plotsRaw.map((plot) =>
    clearedOrphanIds.has(plot.id)
      ? {
          ...plot,
          seedItemId: null,
          plantedAt: null,
          finishAt: null,
          lastWateredAt: null,
          fertilizerApplied: false,
          updatedAt: now,
          seedItem: null,
        }
      : plot,
  );

  const dayNightCycle = getWorldCycleState(now);
  const plots = plotsForState
    .filter((p) => p.slotIndex < totalPlots)
    .map((plot) => {
      const seedItem = plot.seedItemId ? plot.seedItem : null;
      const yieldItem = seedItem?.farmYieldItemId
        ? (yieldItemsById.get(seedItem.farmYieldItemId) ?? null)
        : null;
      return mapPlotToState({ ...plot, seedItem, yieldItem }, now);
    });

  const levelInfo = getFarmingLevelProgress(user.farmingExperience);
  const farmingLevel = levelInfo.level;

  const eligibleItems = userItems.filter(
    (ui) =>
      !ui.storedAtHome &&
      !ui.isInAuction &&
      (!ui.craftingFinishedAt || ui.craftingFinishedAt < now),
  );

  const availableSeedsByItemId = new Map<
    string,
    FarmStateResponse["availableSeeds"][number]
  >();
  for (const userItem of eligibleItems) {
    if (!userItem.item.isFarmSeed || userItem.quantity <= 0) continue;
    const yieldItem = userItem.item.farmYieldItemId
      ? yieldItemsById.get(userItem.item.farmYieldItemId)
      : undefined;
    if (!yieldItem) continue;
    const existingSeed = availableSeedsByItemId.get(userItem.itemId);
    if (existingSeed) {
      existingSeed.quantity += userItem.quantity;
    } else {
      availableSeedsByItemId.set(userItem.itemId, {
        itemId: userItem.itemId,
        name: userItem.item.name,
        image: userItem.item.image,
        quantity: userItem.quantity,
        minLevel: userItem.item.farmMinLevel,
        growTimeSeconds: getFarmGrowTimeSeconds(
          userItem.item.farmGrowTimeSeconds,
          user,
        ),
        yieldItemId: yieldItem.id,
        yieldName: yieldItem.name,
        yieldImage: yieldItem.image,
        yieldQuantity: 1,
        plantExperience: getFarmPlantExperience(userItem.item),
        harvestExperience: getFarmHarvestExperience(yieldItem),
      });
    }
  }
  const availableSeeds = [...availableSeedsByItemId.values()];

  const availableFertilizers = eligibleItems
    .filter((ui) => ui.item.isFarmFertilizer && ui.quantity > 0)
    .map((ui) => ({
      userItemId: ui.id,
      itemId: ui.itemId,
      name: ui.item.name,
      image: ui.item.image,
      quantity: ui.quantity,
      timeReductionSeconds: ui.item.farmTimeReductionSeconds,
    }));

  const extractableCrops = eligibleItems
    .filter(
      (ui) =>
        ui.item.farmExtractSeedItemId &&
        ui.item.farmExtractSeedCount > 0 &&
        ui.quantity > 0,
    )
    .map((ui) => ({
      userItemId: ui.id,
      itemId: ui.itemId,
      name: ui.item.name,
      image: ui.item.image,
      quantity: ui.quantity,
      seedItemId: ui.item.farmExtractSeedItemId as string,
      seedCount: ui.item.farmExtractSeedCount,
    }));

  const sellableCrops = eligibleItems
    .filter(
      (ui) =>
        ui.item.farmSellValue > 0 &&
        ui.quantity > 0 &&
        !ui.item.isFarmSeed &&
        !ui.item.isFarmFertilizer,
    )
    .map((ui) => ({
      userItemId: ui.id,
      itemId: ui.itemId,
      name: ui.item.name,
      image: ui.item.image,
      quantity: ui.quantity,
      sellValue: ui.item.farmSellValue,
    }));

  return {
    farmingLevel,
    farmingExperience: user.farmingExperience,
    expForCurrentLevel: levelInfo.expForCurrentLevel,
    expForNextLevel: levelInfo.expForNextLevel,
    farmCurrency: user.farmCurrency,
    farmPlotsPurchased: user.farmPlotsPurchased,
    farmExtractorsOwned: user.farmExtractorsOwned,
    maxPurchasablePlots: getMaxPurchasablePlots(farmingLevel),
    maxExtractors: getMaxExtractors(farmingLevel),
    totalPlots,
    dayNightCycle,
    collectionLog,
    plots,
    shopEntries,
    availableSeeds,
    availableFertilizers,
    activeSeedExtractions,
    extractableCrops,
    sellableCrops,
  };
};

const settleFarmExtractions = async (
  client: DrizzleClient,
  userId: string,
  now: Date,
): Promise<FarmStateResponse["activeSeedExtractions"]> => {
  const extractions = await fetchUserExtractions(client, userId);

  const completedExtractions = extractions.filter(
    (extraction) => extraction.finishAt <= now,
  );
  const settledIds =
    completedExtractions.length > 0
      ? await payOutExtractions(client, userId, completedExtractions, now)
      : new Set<string>();

  // Anything still on the books is still the player's, finished or not. A payout held back
  // for want of inventory space keeps its row, and showing it keeps the extractor from
  // looking empty while it is in fact still holding seeds.
  return extractions
    .filter(
      (extraction) =>
        !settledIds.has(extraction.id) && extraction.cropItem && extraction.seedItem,
    )
    .map((extraction) => ({
      id: extraction.id,
      extractorSlot: extraction.extractorSlot,
      cropItemId: extraction.cropItemId,
      cropName: extraction.cropItem?.name ?? "Crop",
      cropImage: extraction.cropItem?.image ?? "",
      cropQuantity: extraction.cropQuantity,
      seedItemId: extraction.seedItemId,
      seedName: extraction.seedItem?.name ?? "Seeds",
      seedImage: extraction.seedItem?.image ?? "",
      seedQuantity: extraction.seedQuantity,
      startedAt: extraction.startedAt,
      finishAt: extraction.finishAt,
    }));
};

const fetchUserExtractions = async (client: DrizzleClient, userId: string) =>
  await client.query.farmExtraction.findMany({
    where: eq(farmExtraction.userId, userId),
    orderBy: (extraction, { asc }) => [asc(extraction.extractorSlot)],
    with: { cropItem: true, seedItem: true },
  });

/** How long a settlement claim is honoured before another request may take it over. */
const FARM_EXTRACTION_CLAIM_TIMEOUT_SECONDS = 60;

/**
 * Pays out finished extractions, at most once except for one known window.
 *
 * Each row is claimed before anything is granted, so two concurrent settlements cannot both
 * award it. The claim is a mark rather than a delete: the row has to outlive the grant, or a
 * failed item write would take the extraction down with it and the player would lose both.
 * A grant that fails releases its claim and is retried by the next settlement; a claim left
 * behind by a request that died is taken over once it goes stale.
 *
 * The window: settledAt is written after the seeds land, so a failure of that one statement
 * leaves a granted payout looking unpaid, and the stale-claim takeover grants it again. This
 * is not exactly-once and should not be described as such. Closing it needs either a
 * transaction, which PlanetScale does not give us, or a grant keyed to the extraction id so
 * a replay collides -- and an insert-only grant cannot top up a partial stack, which is what
 * keeps settlement inside the material cap. The duplicate is the accepted side of that trade.
 *
 * Grants are aggregated per seed item because they share one inventory snapshot. Two
 * extractions of the same seed would otherwise both measure the same partial stack, and the
 * one that lost the fill would open a row past the material cap.
 */
const payOutExtractions = async (
  client: DrizzleClient,
  userId: string,
  completedExtractions: Awaited<ReturnType<typeof fetchUserExtractions>>,
  now: Date,
): Promise<Set<string>> => {
  // A settled row has already paid out and is only ever waiting to be cleaned up. Keeping
  // it out of the claim is what makes a failed delete replay-safe rather than a second payout.
  const alreadySettledIds = completedExtractions
    .filter((extraction) => extraction.settledAt !== null)
    .map((extraction) => extraction.id);
  const payable = completedExtractions.filter(
    (extraction) => extraction.settledAt === null,
  );

  const staleClaim = new Date(
    now.getTime() - FARM_EXTRACTION_CLAIM_TIMEOUT_SECONDS * 1000,
  );
  const claimed = (
    await Promise.all(
      payable.map(async (extraction) => {
        const claim = await client
          .update(farmExtraction)
          .set({ claimedAt: now, updatedAt: now })
          .where(
            and(
              eq(farmExtraction.id, extraction.id),
              eq(farmExtraction.userId, userId),
              lte(farmExtraction.finishAt, now),
              isNull(farmExtraction.settledAt),
              or(
                isNull(farmExtraction.claimedAt),
                lt(farmExtraction.claimedAt, staleClaim),
              ),
            ),
          );
        return Number(claim.rowsAffected ?? 0) === 1 ? extraction : null;
      }),
    )
  ).filter((extraction) => extraction !== null);

  const grants = new Map<string, { item: Item; quantity: number; ids: string[] }>();
  // Rows with nothing left to pay out still have to go, or the extractor slot stays
  // occupied forever -- extractSeeds only asks whether a row exists for that slot.
  const emptyIds: string[] = [];
  for (const extraction of claimed) {
    if (!extraction.seedItem || extraction.seedQuantity <= 0) {
      emptyIds.push(extraction.id);
      continue;
    }
    const grant = grants.get(extraction.seedItemId);
    if (grant) {
      grant.quantity += extraction.seedQuantity;
      grant.ids.push(extraction.id);
    } else {
      grants.set(extraction.seedItemId, {
        item: extraction.seedItem,
        quantity: extraction.seedQuantity,
        ids: [extraction.id],
      });
    }
  }

  let results: { ids: string[]; granted: boolean }[] = [];
  if (grants.size > 0) {
    const [settlingUser, settledUserItems] = await Promise.all([
      fetchUser(client, userId),
      fetchUserItems(client, userId),
    ]);

    // Admission sized every extraction against the inventory as it stood then, so a player
    // who has filled up since can still arrive here with more seeds than rows to hold them.
    // Hold the whole payout rather than opening a row past the cap: the seeds stay in the
    // extractor, and the next settlement pays out once there is space.
    const overCapacity =
      guardBulkItemAwardInventoryCapacity(
        settlingUser,
        settledUserItems,
        [...grants.values()].map((grant) => ({
          item: grant.item,
          quantity: grant.quantity,
        })),
      ) !== null;

    results = overCapacity
      ? [...grants.values()].map((grant) => ({ ids: grant.ids, granted: false }))
      : await Promise.all(
          [...grants.values()].map(async (grant) => {
            try {
              const granted = await awardItemToUser(
                client,
                userId,
                grant.item,
                grant.quantity,
                settledUserItems,
              );
              return { ids: grant.ids, granted };
            } catch {
              return { ids: grant.ids, granted: false };
            }
          }),
        );
  }

  const grantedIds = results
    .filter((result) => result.granted)
    .flatMap((result) => result.ids);
  const releasedIds = results
    .filter((result) => !result.granted)
    .flatMap((result) => result.ids);

  // Mark paid before removing anything. This write, not the delete, is what completes the
  // payout: if it lands and the delete then fails, the leftover row is settled and gets
  // cleaned up rather than paid a second time.
  if (grantedIds.length > 0) {
    await client
      .update(farmExtraction)
      .set({ settledAt: now })
      .where(
        and(eq(farmExtraction.userId, userId), inArray(farmExtraction.id, grantedIds)),
      );
  }
  if (releasedIds.length > 0) {
    await client
      .update(farmExtraction)
      .set({ claimedAt: null })
      .where(
        and(eq(farmExtraction.userId, userId), inArray(farmExtraction.id, releasedIds)),
      );
  }

  const doneIds = [...alreadySettledIds, ...emptyIds, ...grantedIds];
  if (doneIds.length > 0) {
    // Cleanup only. A failure here leaves rows that the next settlement removes, so it must
    // not fail the read that triggered it.
    try {
      await client
        .delete(farmExtraction)
        .where(
          and(eq(farmExtraction.userId, userId), inArray(farmExtraction.id, doneIds)),
        );
    } catch {}
  }
  return new Set(doneIds);
};

export const ensureFarmPlots = async (
  client: DrizzleClient,
  userId: string,
  totalPlots: number,
) => {
  const existing = await client.query.farmPlot.findMany({
    where: eq(farmPlot.userId, userId),
    orderBy: (plot, { asc }) => [asc(plot.slotIndex)],
    with: { seedItem: true },
  });
  const existingSlots = new Set(existing.map((p) => p.slotIndex));
  const inserts = [];
  for (let slotIndex = 0; slotIndex < totalPlots; slotIndex++) {
    if (!existingSlots.has(slotIndex)) {
      inserts.push({
        id: nanoid(),
        userId,
        slotIndex,
      });
    }
  }
  if (inserts.length > 0) {
    await client
      .insert(farmPlot)
      .values(inserts)
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });

    return await client.query.farmPlot.findMany({
      where: eq(farmPlot.userId, userId),
      orderBy: (plot, { asc }) => [asc(plot.slotIndex)],
      with: { seedItem: true },
    });
  }

  return existing;
};

const guardItemAwardInventoryCapacity = (
  user: Awaited<ReturnType<typeof fetchUser>>,
  userItems: Awaited<ReturnType<typeof fetchUserItems>>,
  itemInfo: Item,
  quantity: number,
) => {
  const stackSize = itemInfo.canStack ? Math.max(1, itemInfo.stackSize) : 1;
  const now = new Date();
  const existingStack = itemInfo.canStack
    ? userItems.find(
        (ui) =>
          ui.itemId === itemInfo.id &&
          ui.equipped === "NONE" &&
          !ui.storedAtHome &&
          !ui.isInAuction &&
          ui.item.canStack &&
          (!ui.craftingFinishedAt || ui.craftingFinishedAt < now),
      )
    : undefined;
  const reusableStackSpace = existingStack
    ? Math.max(0, stackSize - existingStack.quantity)
    : 0;
  const newStacksRequired = Math.ceil(
    Math.max(0, quantity - reusableStackSpace) / stackSize,
  );

  const inventoryItems = userItems.filter((ui) => !ui.storedAtHome);
  const bucket = getInventoryBucket(itemInfo);
  const bucketCount = inventoryItems.filter(
    (ui) => getInventoryBucket(ui.item) === bucket,
  ).length;
  if (bucketCount + newStacksRequired > getInventoryBucketCapacity(bucket, user)) {
    return errorResponse(getInventoryBucketFullMessage(bucket));
  }

  return null;
};

const guardBulkItemAwardInventoryCapacity = (
  user: Awaited<ReturnType<typeof fetchUser>>,
  userItems: Awaited<ReturnType<typeof fetchUserItems>>,
  awards: { item: Item; quantity: number }[],
) => {
  const inventoryItems = userItems.filter((userItem) => !userItem.storedAtHome);
  const requiredStacks: Record<InventoryBucket, number> = {
    event: 0,
    materials: 0,
    cooking: 0,
    normal: 0,
  };
  const now = new Date();

  // Fold repeat awards of the same item together. Sized separately they would each claim
  // the same partial stack's free space, and a pair that does not fit would look like it does.
  const merged = new Map<string, { item: Item; quantity: number }>();
  for (const award of awards) {
    const existing = merged.get(award.item.id);
    if (existing) existing.quantity += award.quantity;
    else merged.set(award.item.id, { item: award.item, quantity: award.quantity });
  }

  for (const award of merged.values()) {
    const stackSize = award.item.canStack ? Math.max(1, award.item.stackSize) : 1;
    const existingStack = award.item.canStack
      ? userItems.find(
          (userItem) =>
            userItem.itemId === award.item.id &&
            userItem.equipped === "NONE" &&
            !userItem.storedAtHome &&
            !userItem.isInAuction &&
            userItem.item.canStack &&
            (!userItem.craftingFinishedAt || userItem.craftingFinishedAt < now),
        )
      : undefined;
    const reusableStackSpace = existingStack
      ? Math.max(0, stackSize - existingStack.quantity)
      : 0;
    const newStacks = Math.ceil(
      Math.max(0, award.quantity - reusableStackSpace) / stackSize,
    );
    requiredStacks[getInventoryBucket(award.item)] += newStacks;
  }

  for (const bucket of Object.keys(requiredStacks) as InventoryBucket[]) {
    const needed = requiredStacks[bucket];
    if (needed <= 0) continue;
    const bucketCount = inventoryItems.filter(
      (userItem) => getInventoryBucket(userItem.item) === bucket,
    ).length;
    if (bucketCount + needed > getInventoryBucketCapacity(bucket, user)) {
      return errorResponse(getInventoryBucketFullMessage(bucket));
    }
  }
  return null;
};

/** Max attempts to fill a partial stack before giving up and opening a new row. */
const STACK_FILL_ATTEMPTS = 3;

const awardItemToUser = async (
  client: DrizzleClient,
  userId: string,
  itemInfo: Item | null | undefined,
  quantity: number,
  /**
   * Inventory snapshot from the caller's opening fetch. Re-reading it here would
   * add a full inventory join per grant, which harvestAll multiplies by the number
   * of distinct crops. Callers must aggregate repeat grants of the same item into
   * one call, so that two grants never measure the same stack from this snapshot.
   */
  userItems: Awaited<ReturnType<typeof fetchUserItems>>,
): Promise<boolean> => {
  if (quantity <= 0) return true;
  if (!itemInfo) return false;

  let remaining = quantity;
  const stackSize = itemInfo.canStack ? Math.max(1, itemInfo.stackSize) : 1;

  if (itemInfo.canStack) {
    const existing = userItems.find(
      (ui) =>
        ui.itemId === itemInfo.id &&
        ui.equipped === "NONE" &&
        !ui.storedAtHome &&
        !ui.isInAuction &&
        ui.item.canStack &&
        (!ui.craftingFinishedAt || ui.craftingFinishedAt < new Date()),
    );
    // A lost CAS means the snapshot went stale under a concurrent grant. Re-read that one
    // stack and try again rather than falling through to the insert: opening a fresh row
    // for a quantity that belongs in the existing stack puts the player past the cap.
    let quantityOnRecord = existing?.quantity;
    for (
      let attempt = 0;
      existing && quantityOnRecord !== undefined && attempt < STACK_FILL_ATTEMPTS;
      attempt++
    ) {
      const space = Math.max(0, stackSize - quantityOnRecord);
      if (space <= 0) break;
      const toAdd = Math.min(remaining, space);
      const fillResult = await client
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
      if (fillResult.rowsAffected === 1) {
        remaining -= toAdd;
        break;
      }
      const fresh = await client.query.userItem.findFirst({
        where: eq(userItem.id, existing.id),
        columns: { quantity: true },
      });
      quantityOnRecord = fresh?.quantity;
    }
  }

  const inserts = [];
  while (remaining > 0) {
    const qty = Math.min(remaining, stackSize);
    inserts.push({
      id: nanoid(),
      userId,
      itemId: itemInfo.id,
      quantity: qty,
      equipped: "NONE" as const,
    });
    remaining -= qty;
  }
  if (inserts.length > 0) {
    await client.insert(userItem).values(inserts);
  }
  return true;
};

type FarmingQuestTask =
  | "seeds_planted"
  | "plants_watered"
  | "plants_fertilized"
  | "plants_harvested";

/**
 * Thin quest-state fetch for farming objective emits. This keeps the tracker
 * snapshot internally consistent without pulling the full user relation graph.
 */
const fetchFarmingQuestState = async (client: DrizzleClient, userId: string) => {
  return await client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: { userId: true, questData: true, updatedAt: true },
    with: {
      userQuests: {
        where: or(
          and(isNull(questHistory.endAt), eq(questHistory.completed, 0)),
          eq(questHistory.questType, "achievement"),
        ),
        with: { quest: true },
      },
      completedQuests: {
        columns: { id: true, questId: true, completed: true },
        where: gte(questHistory.completed, 1),
      },
    },
  });
};

/** Awards farming XP and advances the matching active quest objectives together. */
/** Max read-modify-write passes before a contended quest update gives up. */
const QUEST_PROGRESS_ATTEMPTS = 3;

/**
 * Farming XP is a SQL increment and merges on its own, but quest trackers are one JSON
 * document rewritten wholesale. Two farming actions that each read the same trackers would
 * both write "1", and the later write would erase the earlier one -- watering two plots left
 * `plants_watered` at 1. So the tracker write is a compare-and-swap on the row it was derived
 * from, and a lost race re-reads and recomputes instead of overwriting.
 */
const awardFarmingProgress = async (
  client: DrizzleClient,
  user: Awaited<ReturnType<typeof fetchUser>>,
  xpGain: number,
  questState: Awaited<ReturnType<typeof fetchFarmingQuestState>>,
  task: FarmingQuestTask,
  increment = 1,
  farmingCollectionCount?: number,
) => {
  const emittedTasks = new Set<AllObjectiveTask>([
    task,
    ...(xpGain > 0 ? (["farming_level"] as const) : []),
    ...(farmingCollectionCount !== undefined
      ? (["farming_collection_log"] as const)
      : []),
  ]);

  /** Trackers this action would produce from one snapshot of the user's quest state. */
  const questUpdateFor = (
    snapshotUser: Awaited<ReturnType<typeof fetchUser>>,
    snapshotQuests: Awaited<ReturnType<typeof fetchFarmingQuestState>>,
  ) => {
    const advancesObjective = snapshotQuests?.userQuests.some((uq) =>
      uq.quest?.content.objectives.some((objective) => {
        if (!emittedTasks.has(objective.task)) return false;
        const goal = snapshotQuests.questData
          ?.find((tracker) => tracker.id === uq.questId)
          ?.goals.find((entry) => entry.id === objective.id);
        return !goal?.done;
      }),
    );
    if (!snapshotQuests || !advancesObjective) {
      return {
        advancesObjective: false,
        questData: undefined as
          | ReturnType<typeof filterQuestTrackersForDbPersist>
          | undefined,
      };
    }
    const trackerUser = {
      ...snapshotUser,
      farmingExperience: snapshotUser.farmingExperience + xpGain,
      farmingCollectionCount,
      questData: snapshotQuests.questData,
      userQuests: snapshotQuests.userQuests.filter((entry) => entry.quest),
      completedQuests: snapshotQuests.completedQuests,
    } as unknown as Parameters<typeof getNewTrackers>[0];
    const taskUpdates: ObjectiveTrackerTaskInput[] = [
      { task, increment },
      ...(xpGain > 0
        ? [
            {
              task: "farming_level" as const,
              value: getFarmingLevel(snapshotUser.farmingExperience + xpGain),
            },
          ]
        : []),
      ...(farmingCollectionCount !== undefined
        ? [
            {
              task: "farming_collection_log" as const,
              value: farmingCollectionCount,
            },
          ]
        : []),
    ];
    const { trackers } = getNewTrackers(trackerUser, taskUpdates);
    return {
      advancesObjective: true,
      questData: filterQuestTrackersForDbPersist(trackers, trackerUser) as
        | ReturnType<typeof filterQuestTrackersForDbPersist>
        | undefined,
    };
  };

  const first = questUpdateFor(user, questState);
  if (xpGain <= 0 && !first.advancesObjective) return true;

  // Nothing but XP to persist: the SQL increment is already conflict-free.
  if (!first.advancesObjective) {
    const result = await client
      .update(userData)
      .set({ farmingExperience: sql`${userData.farmingExperience} + ${xpGain}` })
      .where(eq(userData.userId, user.userId));
    return Number(result.rowsAffected ?? 0) >= 1;
  }

  let snapshotUser = user;
  let snapshotQuests = questState;
  let update = first;
  for (let attempt = 0; attempt < QUEST_PROGRESS_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      [snapshotUser, snapshotQuests] = await Promise.all([
        fetchUser(client, user.userId),
        fetchFarmingQuestState(client, user.userId),
      ]);
      update = questUpdateFor(snapshotUser, snapshotQuests);
      if (!update.advancesObjective) {
        // Another action already satisfied every objective this one would have advanced;
        // only the XP is still outstanding.
        const result = await client
          .update(userData)
          .set({ farmingExperience: sql`${userData.farmingExperience} + ${xpGain}` })
          .where(eq(userData.userId, user.userId));
        return Number(result.rowsAffected ?? 0) >= 1;
      }
    }
    // The guard has to come from the same read as the payload. fetchUser and
    // fetchFarmingQuestState are separate queries, so a write landing between them
    // pairs a current timestamp with a stale document, and the CAS waves it through.
    if (!snapshotQuests) return false;
    const claim = await claimUserSnapshot({
      client,
      userId: user.userId,
      updatedAt: snapshotQuests.updatedAt,
      set: {
        ...(xpGain > 0
          ? { farmingExperience: sql`${userData.farmingExperience} + ${xpGain}` }
          : {}),
        questData: update.questData,
      },
    });
    if (claim.success) return true;
  }
  return false;
};
