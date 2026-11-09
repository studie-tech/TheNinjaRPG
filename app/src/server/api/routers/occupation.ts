import { eq, isNull, ne, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  getCancelQueuedCraftUserUpdate,
  getCraftingUserUpdate,
  getImbuedItemUserUpdate,
  getSelectOccupationUserUpdate,
} from "@/deltas/occupation";
import {
  CRAFTING_TIMES_MINS,
  MAP_WAKE_ISLAND_SECTOR,
  MAX_COOKING_BATCHES,
  OCCUPATIONS,
} from "@/drizzle/constants";
import { userData, userItem } from "@/drizzle/schema";
import { getActivityBonuses } from "@/libs/activityBonuses";
import {
  getCookingExperience,
  getCookingLevel,
  getCookingSeconds,
} from "@/libs/cooking";
import {
  calculateItemConsumption,
  craftingStartBlockMessage,
  formatCraftingRank,
  getCraftingExperienceGain,
  getCraftingRank,
  getCraftingSeconds,
  getEffectiveMaxImbuements,
  getImbuementRankCapMessage,
  getMissingCraftingRank,
  getTotalItemQuantity,
} from "@/libs/crafting";
import {
  countsTowardInventoryStorage,
  getInventoryBucket,
  getInventoryBucketCapacity,
  getInventoryBucketFullMessage,
  splitIntoStacks,
} from "@/libs/item";
import { getOccupationChangeDaysRemaining } from "@/libs/occupation";
import { getPvpBoost } from "@/libs/pvpExperience";
import {
  filterQuestTrackersForDbPersist,
  getCraftTrackerTasks,
  getNewTrackers,
} from "@/libs/quest";
import { getNextQueueSchedule } from "@/libs/queue";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import { getTerritoryWarBoost } from "@/libs/territoryWar";
import { fetchItemWithCraftingRequirements, insertUserItems } from "@/queries/item";
import {
  deleteUserItemImbuementForRemoveImbuement,
  findCraftingQueueState,
  findUserItemImbuementForRemoveImbuement,
  insertUserCookingJobForCraftItem,
  insertUserItemForRemoveImbuement,
  insertUserItemImbuementForImbueItem,
  listItemForGetCookingRecipes,
  listItemForGetCraftableItems,
  updateUserCookingJobForFinishCraftingImmediately,
  updateUserDataForCraftItem,
  updateUserDataForImbueItem,
  updateUserDataForSelectOccupation,
  updateUserItemForFinishCraftingImmediately,
  updateUserItemForImbueItem,
  updateUserItemImbuementForFinishImbuingImmediately,
} from "@/queries/occupation";
import { fetchUser } from "@/queries/profile";
import { fetchUpdatedUser } from "@/routers/profile";
import { fetchUserItems } from "@/server/api/routers/item";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import {
  claimUserSnapshot,
  updateUserItemQuantityAtomically,
} from "@/server/utils/concurrency";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import {
  appendQueueEntries,
  cancelQueuedCraft,
  fetchCraftingQueue,
  hasDueTimedJob,
  hasQueueRoom,
  lastQueuePosition,
  returnCraftMaterials,
  settleCraftingQueue,
  toQueuedCraft,
} from "@/server/utils/userQueue";
import { getQueueTotalCapacity } from "@/utils/paypal";
import { canChangeContent } from "@/utils/permissions";
import {
  formatSecondsToTimeDisplay,
  getNextUserSnapshotAt,
  getSecondPrecisionDate,
} from "@/utils/time";
import { countBoostingShrines, getShrineBoost } from "@/utils/village";
import {
  type CraftingQueueMaterial,
  cancelQueuedJobInputSchema,
  queuedJobSchema,
} from "@/validators/train";
import { userDeltaResponseSchema } from "@/validators/userCache";

const craftingQueueOutputSchema = z.object({
  capacity: z.number(),
  waiting: z.array(
    queuedJobSchema.extend({
      itemId: z.string(),
      name: z.string(),
      image: z.string().nullable(),
      quantity: z.number(),
      materials: z.array(z.object({ name: z.string(), quantity: z.number() })),
    }),
  ),
});

/** Shared production input counts batches; meal output quantity comes from the recipe. */
const cookItemInputSchema = z.object({
  itemId: z.string(),
  quantity: z.int().min(1).max(MAX_COOKING_BATCHES).prefault(1),
});

export const occupationRouter = createTRPCRouter({
  /** Visible crafting recipes; public for the crafting manual page. */
  getCraftableItems: publicProcedure
    .meta({ mcp: { description: "Get all craftable items" } })
    .query(async ({ ctx }) => {
      return await listItemForGetCraftableItems(ctx.drizzle);
    }),

  /** Visible meal recipes and ingredient requirements; Cooking needs no occupation. */
  getCookingRecipes: protectedProcedure.query(({ ctx }) =>
    listItemForGetCookingRecipes(ctx.drizzle),
  ),

  selectOccupation: protectedProcedure
    .meta({ mcp: { description: "Select a crafting occupation" } })
    .input(z.object({ occupation: z.enum(OCCUPATIONS) }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);

      // Guard
      if (user.occupation && user.occupationSignupAt) {
        const daysRemaining = getOccupationChangeDaysRemaining(user.occupationSignupAt);
        if (daysRemaining > 0 && !canChangeContent(user.role)) {
          return errorResponse(
            `You must wait ${daysRemaining} more day(s) before changing occupations`,
          );
        }
      }

      // Preserve the second precision of NOW() while returning the exact timestamp written.
      const occupationSignupAt = getSecondPrecisionDate();
      if (
        user.occupation === input.occupation &&
        user.occupationSignupAt?.getTime() === occupationSignupAt.getTime()
      ) {
        return {
          success: true,
          message: "Occupation selected successfully!",
          ...getSelectOccupationUserUpdate({
            inputOccupation: input.occupation,
            occupationSignupAt,
          }),
        };
      }
      const result = await updateUserDataForSelectOccupation(
        ctx.drizzle,
        input,
        occupationSignupAt,
        ctx,
        user,
      );
      if (result.rowsAffected === 0) {
        return errorResponse("Occupation changed while saving. Please try again");
      }
      return {
        success: true,
        message: "Occupation selected successfully!",
        ...getSelectOccupationUserUpdate({
          inputOccupation: input.occupation,
          occupationSignupAt,
        }),
      };
    }),

  craftItem: protectedProcedure
    .meta({ mcp: { description: "Craft an item using materials" } })
    .input(cookItemInputSchema)
    .output(userDeltaResponseSchema.extend({ finishTime: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Read userData before inventory. Every capacity mutation commits both rows
      // atomically and bumps updatedAt, so this ordering gives the later CAS a
      // consistent boundary even when another request commits between the reads.
      // The refresh also starts any queued craft whose turn has come.
      const updatedUser = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      const { user: initialUser, settings } = updatedUser;
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const [itemWithRequirements, useritems, waiting] = await Promise.all([
        fetchItemWithCraftingRequirements(ctx.drizzle, input.itemId),
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchCraftingQueue(ctx.drizzle, ctx.userId),
      ]);
      // Derived
      const currentlyCrafting = useritems.find(
        (item) => item.craftingFinishedAt && item.craftingFinishedAt > new Date(),
      );
      // Guards
      const craftingBlock = craftingStartBlockMessage(user);
      if (craftingBlock) return errorResponse(craftingBlock);
      if (itemWithRequirements?.itemType !== "MEAL" && user.occupation !== "CRAFTING") {
        return errorResponse("You must have the Crafting occupation to craft items");
      }
      if (!itemWithRequirements) {
        return errorResponse("Item not found");
      }
      const isMeal = itemWithRequirements.itemType === "MEAL";
      const outputQuantity =
        input.quantity * (isMeal ? itemWithRequirements.cookingOutputQuantity : 1);
      if (
        isMeal &&
        getCookingLevel(user.cookingExperience) < itemWithRequirements.cookingMinLevel
      ) {
        return errorResponse(
          `Cooking level ${itemWithRequirements.cookingMinLevel} required`,
        );
      }
      // Behind a running craft, this one waits in the queue with its materials taken.
      const isQueued = !!currentlyCrafting || waiting.length > 0;
      if (isQueued && !hasQueueRoom(user, waiting.length)) {
        return errorResponse("Your crafting queue is full");
      }
      if (itemWithRequirements.hidden) {
        return errorResponse("This item is hidden and cannot be crafted");
      }
      if (!itemWithRequirements.canBeCrafted) {
        return errorResponse("This item is not craftable");
      }
      if (itemWithRequirements.parentItemId) {
        return errorResponse("Evolution items cannot be crafted; they must be evolved");
      }
      if (itemWithRequirements.craftingRequirements.length === 0) {
        return errorResponse("This item cannot be crafted (no requirements defined)");
      }
      // Crafted output is added as new carried stacks, so reserve enough room in
      // the dedicated cooking bucket before consuming any materials. The user
      // snapshot claim below serializes this check with other capacity-changing
      // mutations.
      const outputBucket = getInventoryBucket(itemWithRequirements);
      if (outputBucket === "cooking") {
        const carriedCookingStacks = useritems.filter(
          (ui) =>
            countsTowardInventoryStorage(ui) &&
            getInventoryBucket(ui.item) === "cooking",
        ).length;
        const newStacksRequired = Math.ceil(
          outputQuantity / Math.max(1, itemWithRequirements.stackSize),
        );
        // Queued cooking crafts land in the same bucket when they start.
        const queuedCookingStacks = waiting.reduce(
          (sum, entry) =>
            entry.item && getInventoryBucket(entry.item) === "cooking"
              ? sum + Math.ceil(entry.quantity / Math.max(1, entry.item.stackSize))
              : sum,
          0,
        );
        if (
          carriedCookingStacks + queuedCookingStacks + newStacksRequired >
          getInventoryBucketCapacity(outputBucket, user)
        ) {
          return errorResponse(getInventoryBucketFullMessage(outputBucket));
        }
      }
      // Derived
      const userCraftingRank = getCraftingRank(user.craftingExperience);
      // Guards - check rank eligibility regardless of item type
      const missingCraftingRank = getMissingCraftingRank(
        itemWithRequirements,
        userCraftingRank,
      );
      if (missingCraftingRank) {
        return errorResponse(
          `You need to be at least ${formatCraftingRank(missingCraftingRank)} rank to craft ${itemWithRequirements.rarity} items`,
        );
      }
      // Validate user has enough materials using collapsed quantities, and plan which
      // stacks to take; a total that covers a requirement always yields a full plan.
      const allConsumptions: ReturnType<
        typeof calculateItemConsumption
      >["consumptions"] = [];
      for (const requirement of itemWithRequirements.craftingRequirements) {
        const totalQuantity = getTotalItemQuantity(
          useritems,
          requirement.requirementItemId,
        );
        const requiredQuantity = requirement.quantity * input.quantity;
        if (totalQuantity < requiredQuantity) {
          const itemName = requirement.requirementItem?.name || "Unknown item";
          return errorResponse(
            `You need ${requiredQuantity} ${itemName} (you have ${totalQuantity})`,
          );
        }
        allConsumptions.push(
          ...calculateItemConsumption(
            useritems,
            requirement.requirementItemId,
            requiredQuantity,
          ).consumptions,
        );
      }

      // See if we have a shrine boost, add it to crafting time in case
      const sectors = countBoostingShrines(user.village?.sectors);
      const shrineBoost = getShrineBoost(sectors, "Crafting", user.village);
      const territoryBoost = isQueued ? 0 : getTerritoryWarBoost(user);
      // Save passives at submission; only Territory War is reevaluated when a queued job starts.
      const bonuses = getActivityBonuses(user);
      const craftSeconds = isMeal
        ? getCookingSeconds(
            itemWithRequirements,
            input.quantity,
            shrineBoost,
            territoryBoost,
            bonuses.cookingReductionPercent,
          )
        : getCraftingSeconds(
            itemWithRequirements,
            userCraftingRank,
            input.quantity,
            shrineBoost,
            user.clan?.craftingTimeBoost,
            bonuses.craftingReductionPercent,
            territoryBoost,
          );

      // Calculate crafting finish time
      const finishTime = new Date(Date.now() + craftSeconds * 1000);
      const queueSchedule = getNextQueueSchedule(
        craftSeconds,
        waiting.at(-1)?.finishesAt ?? currentlyCrafting?.craftingFinishedAt,
      );

      // Create crafting item entry/entries
      // Respect stackSize limit when creating items
      const craftingItemValues: (typeof userItem.$inferInsert)[] = [];
      for (const quantity of splitIntoStacks(
        outputQuantity,
        itemWithRequirements.stackSize,
      )) {
        craftingItemValues.push({
          id: nanoid(),
          userId: ctx.userId,
          itemId: input.itemId,
          quantity,
          craftingFinishedAt: finishTime,
        });
      }

      // Award crafting experience (from item config, or 0 if not set)
      const baseExpGain = isMeal
        ? 0
        : (itemWithRequirements.craftingExperience ?? 0) * input.quantity;
      const cookingExpGain = isMeal
        ? getCookingExperience(
            itemWithRequirements.cookingExperience,
            outputQuantity,
            getTerritoryWarBoost(user),
          )
        : 0;
      const expGain = getCraftingExperienceGain(
        baseExpGain,
        user,
        getTerritoryWarBoost(user),
        getPvpBoost(user, settings).totalPercent,
      );
      // Update trackers: crafting experience, total items crafted, and any
      // craft-this-specific-item objectives. Emitted here (behind the transaction's
      // craft CAS below) — NOT from the quest-reward EXP path
      // (getExperienceTrackerTasks), which must stay experience-only to avoid double-counting.
      // Waiting crafts have not earned their production progress yet.
      const { trackers, consequences, questIdsUpdated } = isQueued
        ? { trackers: user.questData ?? [], consequences: [], questIdsUpdated: [] }
        : getNewTrackers(
            { ...user, craftingExperience: user.craftingExperience + expGain },
            isMeal ? [] : getCraftTrackerTasks(expGain, input.quantity, input.itemId),
          );
      const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);
      const materials: CraftingQueueMaterial[] = allConsumptions.flatMap(
        (consumption) => {
          const source = useritems.find((ui) => ui.id === consumption.userItemId);
          return source
            ? [
                {
                  userItemId: source.id,
                  itemId: source.itemId,
                  name: source.item.name,
                  quantity: consumption.consumeQuantity,
                  storedAtHome: source.storedAtHome,
                },
              ]
            : [];
        },
      );
      if (isQueued) {
        // The snapshot claim serializes this user's crafts; the materials are taken next
        // and only then is the craft recorded, so a failed step returns what was taken.
        const claim = await claimUserSnapshot({
          client: ctx.drizzle,
          userId: ctx.userId,
          updatedAt: user.updatedAt,
          readiness,
          where: [
            or(isNull(userData.sector), ne(userData.sector, MAP_WAKE_ISLAND_SECTOR)),
          ],
        });
        if (!claim.success) {
          return errorResponse(
            "Could not start crafting — state changed, please try again",
          );
        }
        const taken = await Promise.all(
          allConsumptions.map((consumption) =>
            takeCraftMaterial(ctx.drizzle, ctx.userId, consumption),
          ),
        );
        if (taken.some((ok) => !ok)) {
          await returnCraftMaterials(
            ctx.drizzle,
            ctx.userId,
            materials.filter((_, index) => taken[index]),
          );
          return actionReadinessResponse(
            errorResponse(
              "Could not start crafting — materials changed, please try again",
            ),
            readiness,
            ctx.drizzle,
          );
        }
        try {
          const added = await appendQueueEntries(
            ctx.drizzle,
            ctx.userId,
            "CRAFT",
            [
              {
                itemId: input.itemId,
                quantity: outputQuantity,
                materials,
                durationSeconds: craftSeconds,
                ...queueSchedule,
              },
            ],
            lastQueuePosition(waiting, "CRAFT"),
          );
          user.queue.push(...added);
          user.updatedAt = claim.claimedAt;
        } catch (error) {
          await returnCraftMaterials(ctx.drizzle, ctx.userId, materials);
          // Concurrent appends can claim the same unique slot; the losing craft is refunded.
          if (isMysqlDuplicateKeyError(error))
            return actionReadinessResponse(
              errorResponse("Your crafting queue changed. Please try again."),
              readiness,
              ctx.drizzle,
            );
          throw error;
        }
        return actionReadinessResponse(
          {
            success: true,
            message: `Queued ${outputQuantity}x ${itemWithRequirements.name}. Starts in ${formatSecondsToTimeDisplay(Math.max(0, Math.round((queueSchedule.startsAt.getTime() - Date.now()) / 1000)))}.`,
            finishTime: queueSchedule.finishesAt.toISOString(),
            ...getCraftingUserUpdate({
              user,
              updatedUser,
              consequences,
              questIdsUpdated,
              allConsumptions,
            }),
          },
          readiness,
          ctx.drizzle,
        );
      }
      const cookingJob = isMeal
        ? {
            id: nanoid(),
            userId: ctx.userId,
            experience: cookingExpGain,
            finishesAt: finishTime,
          }
        : undefined;
      const craftedAt = getNextUserSnapshotAt(user.updatedAt);
      const materialConflict = Symbol("materialConflict");
      // One statement cannot claim the user snapshot, debit a variable set of material
      // stacks (each an UPDATE or a DELETE) and insert the crafted stacks and cooking job;
      // a failed debit must roll back the claim and every earlier debit.
      try {
        const craftCommitted = await ctx.drizzle.transaction(async (tx) => {
          const claimResult = await updateUserDataForCraftItem(
            tx,
            user,
            expGain,
            questDataForDb,
            ctx,
            craftedAt,
            readiness,
          );
          if (claimResult.rowsAffected !== 1) return false;

          for (const consumption of allConsumptions) {
            if (!(await takeCraftMaterial(tx, ctx.userId, consumption))) {
              throw materialConflict;
            }
          }

          await insertUserItems(tx, craftingItemValues);
          if (cookingJob) await insertUserCookingJobForCraftItem(tx, cookingJob);
          return true;
        });
        if (!craftCommitted) {
          return errorResponse(
            "Could not start crafting — state changed, please try again",
          );
        }
      } catch (error) {
        if (error === materialConflict) {
          return errorResponse(
            "Could not start crafting — materials changed, please try again",
          );
        }
        throw error;
      }

      user.updatedAt = craftedAt;
      user.craftingExperience += expGain;
      user.questData = trackers;
      if (cookingJob) user.cookingJobs.push(cookingJob);
      return actionReadinessResponse(
        {
          success: true,
          message: `Started ${isMeal ? "cooking" : "crafting"} ${outputQuantity}x ${itemWithRequirements.name}. ${expGain > 0 ? `+${expGain} EXP.` : ""} Ready in ${formatSecondsToTimeDisplay(craftSeconds)}.`,
          finishTime: finishTime.toISOString(),
          ...getCraftingUserUpdate({
            user,
            updatedUser,
            consequences,
            questIdsUpdated,
            allConsumptions,
          }),
        },
        readiness,
        ctx.drizzle,
      );
    }),

  getCraftingQueue: protectedProcedure
    .meta({ mcp: { description: "Get crafts queued behind the active craft" } })
    .output(craftingQueueOutputSchema)
    .query(async ({ ctx }) => {
      let [user, waiting] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchCraftingQueue(ctx.drizzle, ctx.userId),
      ]);
      // Polled on its own, so reading the queue starts crafts whose turn has come.
      if (hasDueTimedJob(waiting)) {
        await settleCraftingQueue(ctx.drizzle, ctx.userId, new Date(), waiting);
        waiting = await fetchCraftingQueue(ctx.drizzle, ctx.userId);
      }
      return {
        capacity: getQueueTotalCapacity(user),
        waiting: waiting.map((entry) => ({
          id: entry.id,
          itemId: entry.itemId,
          name: entry.item?.name ?? "Removed item",
          image: entry.item?.image ?? null,
          quantity: entry.quantity,
          durationSeconds: entry.durationSeconds,
          startsAt: entry.startsAt,
          finishesAt: entry.finishesAt,
          materials: Object.values(
            entry.materials.reduce<Record<string, { name: string; quantity: number }>>(
              (sum, material) => {
                const name = material.name ?? "Unknown item";
                sum[material.itemId] = {
                  name,
                  quantity: (sum[material.itemId]?.quantity ?? 0) + material.quantity,
                };
                return sum;
              },
              {},
            ),
          ),
        })),
      };
    }),

  cancelQueuedCraft: protectedProcedure
    .meta({ mcp: { description: "Cancel a queued craft and return its materials" } })
    .input(cancelQueuedJobInputSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const snapshot = await findCraftingQueueState(ctx.drizzle, ctx.userId);
      if (!snapshot) return errorResponse("User not found");
      const cancelled = await cancelQueuedCraft(
        ctx.drizzle,
        ctx.userId,
        input.queueId,
        snapshot.queue.filter((row) => row.kind === "CRAFT").map(toQueuedCraft),
      );
      if (!cancelled) return errorResponse("That queued craft already started");
      // With no remaining craft, cancellation changes only this receipt and inventory.
      // Starting/rescheduling another craft can settle progression and needs recovery.
      return {
        success: true,
        message: "Queued craft cancelled, materials returned",
        ...getCancelQueuedCraftUserUpdate({
          cancelledRemaining: cancelled.remaining,
          cancelledEntryMaterials: cancelled.entry.materials,
          snapshotItems: snapshot.items,
          snapshotQueue: snapshot.queue,
          cancelledEntryId: cancelled.entry.id,
        }),
      };
    }),

  imbueItem: protectedProcedure
    .meta({ mcp: { description: "Imbue an item with a crystal" } })
    .input(
      z.object({
        userItemId: z.string(),
        userCrystalItemId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Run all initial queries in parallel
      const [updatedUserResult, userItems] = await Promise.all([
        // Get user data
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        // Get all user items (like in crafting)
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);

      // Guards
      const initialUser = updatedUserResult.user;
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, updatedUserResult.settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      if (user.sector === MAP_WAKE_ISLAND_SECTOR) {
        return errorResponse("Cannot imbue items on Wake Island");
      }

      // Find target item and crystal from user items
      const targetUserItem = userItems.find((ui) => ui.id === input.userItemId);
      const crystalUserItem = userItems.find((ui) => ui.id === input.userCrystalItemId);

      // Derived
      const userCraftingRank = getCraftingRank(user.craftingExperience);
      const maxImbuedItems = getEffectiveMaxImbuements(
        userCraftingRank,
        targetUserItem?.item.maxImbueNumber || 1,
      );
      const curImbuingItemsCount = userItems.filter(
        (ui) =>
          ui.imbuements.length > 0 &&
          ui.imbuements.some(
            (imbuement) =>
              imbuement.craftingFinishedAt &&
              new Date(imbuement.craftingFinishedAt) > new Date(),
          ),
      ).length;

      // Guards
      if (user.occupation !== "CRAFTING") {
        return errorResponse("You must have the Crafting occupation to imbue items");
      }
      if (!targetUserItem) {
        return errorResponse("Target item not found");
      }
      if (!crystalUserItem) {
        return errorResponse("Crystal not found");
      }
      const crystalItem = crystalUserItem.item;
      if (crystalUserItem.quantity <= 0) {
        return errorResponse("You don't have this crystal");
      }
      if (crystalUserItem.isInAuction) {
        return errorResponse("Cannot use a crystal reserved for auction or trade");
      }
      if (
        crystalUserItem.craftingFinishedAt &&
        new Date(crystalUserItem.craftingFinishedAt) > new Date()
      ) {
        return errorResponse("You cannot use a crystal that is still being crafted");
      }
      if (!hasRequiredSkill(crystalItem, user))
        return errorResponse("Activate the required skill to use this crystal");
      if (crystalItem.itemType !== "CRYSTAL") {
        return errorResponse("Selected item is not a crystal");
      }
      if (crystalItem.crystalTargetTypes) {
        if (crystalItem.crystalTargetTypes !== targetUserItem.item.itemType) {
          return errorResponse(
            `This crystal can only be applied to ${crystalItem.crystalTargetTypes} items`,
          );
        }
      }
      if (!targetUserItem.item.canBeImbued) {
        return errorResponse("This item cannot be imbued");
      }
      if (
        crystalItem.battleUsageType === "PVE" &&
        targetUserItem.item.battleUsageType !== "PVE"
      ) {
        return errorResponse("PvE-only crystals can only be imbued on PvE-only items");
      }
      if (targetUserItem.equipped !== "NONE") {
        return errorResponse("You cannot imbue an equipped item");
      }
      if (curImbuingItemsCount > 0) {
        return errorResponse(
          "You are already imbuing an item. Please wait for it to finish.",
        );
      }
      if (targetUserItem.imbuements.length >= maxImbuedItems) {
        return errorResponse(
          getImbuementRankCapMessage(
            userCraftingRank,
            targetUserItem.item.maxImbueNumber || 1,
            targetUserItem.imbuements.length,
          ) ??
            `This item already has its maximum of ${targetUserItem.item.maxImbueNumber || 1} crystals`,
        );
      }
      if (
        targetUserItem.imbuements.some((imb) => imb.imbuementItemId === crystalItem.id)
      ) {
        return errorResponse(`This item already has a ${crystalItem.name} imbuement`);
      }
      // Derived
      const imbuingTime = CRAFTING_TIMES_MINS[userCraftingRank][crystalItem.rarity];
      const finishTime = new Date(Date.now() + imbuingTime * 60 * 1000);

      // Check rarity
      if (imbuingTime === 0) {
        const missingRank = getMissingCraftingRank(crystalItem, userCraftingRank);
        return errorResponse(
          `You need to be at least ${formatCraftingRank(missingRank ?? "UNKNOWN")} rank to imbue ${crystalItem.rarity} crystals`,
        );
      }

      // CAS + atomic crystal consume serialize parallel imbues on the same account.
      const imbueClaimResult = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        readiness,
        where: [
          or(isNull(userData.sector), ne(userData.sector, MAP_WAKE_ISLAND_SECTOR)),
        ],
      });
      if (!imbueClaimResult.success) {
        return errorResponse(
          "Could not start imbuing — state changed, please try again",
        );
      }

      // Write-time guard: only proceed if item is still not in auction (atomic). The quantity
      // guard also refuses rows held by a stack-merge claim or left as a merge tombstone, so an
      // imbuement is never attached to a row the merge protocol is about to fold away or delete.
      const notInAuctionGuard = await updateUserItemForImbueItem(
        ctx.drizzle,
        input,
        ctx,
      );
      if (notInAuctionGuard.rowsAffected === 0) {
        return actionReadinessResponse(
          errorResponse(
            "You cannot imbue an item that is listed for auction or direct sale",
          ),
          readiness,
          ctx.drizzle,
        );
      }

      const consumeCrystal = await updateUserItemQuantityAtomically({
        client: ctx.drizzle,
        userId: ctx.userId,
        userItemId: crystalUserItem.id,
        expectedQuantity: crystalUserItem.quantity,
        nextQuantity: crystalUserItem.quantity - 1,
        where: [eq(userItem.isInAuction, false)],
      });
      if (!consumeCrystal) {
        return actionReadinessResponse(
          errorResponse("Crystal no longer available"),
          readiness,
          ctx.drizzle,
        );
      }

      const createImbuement = insertUserItemImbuementForImbueItem(
        ctx.drizzle,
        input,
        crystalItem,
        finishTime,
      );

      // Award small amount of crafting experience (half of crystal's crafting experience, or 0 if not set)
      const baseExpGain = Math.floor((crystalItem.craftingExperience ?? 0) / 2);
      const expGain = getCraftingExperienceGain(
        baseExpGain,
        user,
        getTerritoryWarBoost(user),
        getPvpBoost(user, updatedUserResult.settings).totalPercent,
      );
      // Update trackers with crafting experience gained
      const { trackers, consequences, questIdsUpdated } = getNewTrackers(user, [
        { task: "crafting_experience_gained", increment: expGain },
      ]);
      const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);
      const expUpdate = updateUserDataForImbueItem(
        ctx.drizzle,
        expGain,
        questDataForDb,
        ctx,
      );

      const [, expResult] = await Promise.all([createImbuement, expUpdate]);
      if (expResult?.rowsAffected !== 1) {
        return actionReadinessResponse(
          errorResponse(
            "Could not start imbuing — you must be awake and not on Wake Island",
          ),
          readiness,
          ctx.drizzle,
        );
      }

      return actionReadinessResponse(
        {
          success: true,
          ...getImbuedItemUserUpdate({
            user,
            updatedUser: updatedUserResult,
            trackers,
            consequences,
            questIdsUpdated,
            crystalUserItemId: crystalUserItem.id,
            experience: expGain,
            claimedAt: imbueClaimResult.claimedAt,
          }),
          message: `Started imbuing ${targetUserItem.item.name} with ${crystalItem.name}. It will be ready in ${imbuingTime} minutes.`,
          finishTime: finishTime.toISOString(),
        },
        readiness,
        ctx.drizzle,
      );
    }),

  finishCraftingImmediately: protectedProcedure
    .input(z.object({ userItemId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [user, userItems] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      // Find the crafting item
      const craftingItem = userItems.find((ui) => ui.id === input.userItemId);
      // Guards
      if (!canChangeContent(user.role)) {
        return errorResponse(
          "You do not have permission to finish crafting immediately",
        );
      }
      if (!craftingItem) {
        return errorResponse("Crafting item not found");
      }
      if (!craftingItem.craftingFinishedAt) {
        return errorResponse("This item is not being crafted");
      }
      if (craftingItem.craftingFinishedAt <= new Date()) {
        return errorResponse("This item has already finished crafting");
      }
      // Immediately finish the crafting by setting the finish time to now
      await updateUserItemForFinishCraftingImmediately(ctx.drizzle, input);
      if (craftingItem.item.itemType === "MEAL") {
        await updateUserCookingJobForFinishCraftingImmediately(ctx.drizzle, ctx, {
          craftingFinishedAt: craftingItem.craftingFinishedAt,
        });
      }
      // The next queued craft starts now instead of in the finished craft's slot.
      await settleCraftingQueue(ctx.drizzle, ctx.userId);
      return {
        success: true,
        message: `Immediately finished crafting ${craftingItem.item.name}`,
      };
    }),

  finishImbuingImmediately: protectedProcedure
    .input(z.object({ userItemImbuementId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [user, userItems] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      // Find the imbuing item
      const imbuingItem = userItems.find((ui) =>
        ui.imbuements.some((imbuement) => imbuement.id === input.userItemImbuementId),
      );
      const imbuingImbuement = imbuingItem?.imbuements.find(
        (imbuement) => imbuement.id === input.userItemImbuementId,
      );
      // Guards
      if (!canChangeContent(user.role)) {
        return errorResponse(
          "You do not have permission to finish imbuing immediately",
        );
      }
      if (!imbuingItem || !imbuingImbuement) {
        return errorResponse("Imbuing item not found");
      }
      if (!imbuingImbuement.craftingFinishedAt) {
        return errorResponse("This item is not being imbued");
      }
      if (imbuingImbuement.craftingFinishedAt <= new Date()) {
        return errorResponse("This item has already finished imbuing");
      }
      // Immediately finish the imbuing by setting the finish time to now
      await updateUserItemImbuementForFinishImbuingImmediately(ctx.drizzle, input);
      return {
        success: true,
        message: `Immediately finished imbuing ${imbuingItem.item.name}`,
      };
    }),

  removeImbuement: protectedProcedure
    .meta({ mcp: { description: "Remove an imbuement from an item" } })
    .input(z.object({ userItemImbuementId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries
      const [userItems, imbuement] = await Promise.all([
        fetchUserItems(ctx.drizzle, ctx.userId),
        findUserItemImbuementForRemoveImbuement(ctx.drizzle, input),
      ]);

      // Guards
      if (!imbuement) {
        return errorResponse("Imbuement not found");
      }

      // Check if the user owns this item
      const ownedUserItem = userItems.find((ui) => ui.id === imbuement.userItemId);
      if (!ownedUserItem) {
        return errorResponse("You don't own this item");
      }

      if (ownedUserItem.isInAuction) {
        return errorResponse(
          "Cannot remove imbuement from an item reserved for auction or trade",
        );
      }

      // Check if item is equipped
      if (ownedUserItem.equipped !== "NONE") {
        return errorResponse("Cannot remove imbuement from equipped item");
      }

      // Check if imbuement is still being crafted
      if (imbuement.craftingFinishedAt && imbuement.craftingFinishedAt > new Date()) {
        return errorResponse("Cannot remove imbuement that is still being crafted");
      }

      // When imbuing is disabled on the item, refund the crystal to inventory
      const returnsCrystal = !ownedUserItem.item.canBeImbued;

      const deleteResult = await deleteUserItemImbuementForRemoveImbuement(
        ctx.drizzle,
        input,
        ownedUserItem,
        ctx,
      );
      if (deleteResult.rowsAffected === 0) {
        return errorResponse(
          "Item availability changed or imbuement already removed; please refresh",
        );
      }

      if (returnsCrystal) {
        await insertUserItemForRemoveImbuement(ctx.drizzle, ctx, imbuement);
      }

      return {
        success: true,
        message: returnsCrystal
          ? `Removed ${imbuement.item.name} from ${ownedUserItem.item.name} and returned the crystal to your inventory`
          : `Removed ${imbuement.item.name} from ${ownedUserItem.item.name}`,
      };
    }),
});

/** Debit one material stack, failing when it changed or was listed at auction. */
const takeCraftMaterial = (
  client: Pick<DrizzleClient, "update" | "delete">,
  userId: string,
  consumption: { userItemId: string; consumeQuantity: number; newQuantity: number },
) =>
  updateUserItemQuantityAtomically({
    client,
    userId,
    userItemId: consumption.userItemId,
    expectedQuantity: consumption.consumeQuantity + consumption.newQuantity,
    nextQuantity: consumption.newQuantity,
    where: [eq(userItem.isInAuction, false)],
  });
