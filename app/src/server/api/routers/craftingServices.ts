import { nanoid } from "nanoid";
import { z } from "zod";
import { getServiceSubmissionCacheUpdate } from "@/deltas/craftingServices";
import {
  CRAFTING_SERVICE_MAX_FEE,
  CRAFTING_SERVICES,
  CRAFTING_TIMES_MINS,
  ItemRarities,
} from "@/drizzle/constants";
import type { CraftingServiceRequest } from "@/drizzle/schema";
import { getActivityBonuses } from "@/libs/activityBonuses";
import {
  calculateItemConsumption,
  craftingStartBlockMessage,
  getCraftingExperienceGain,
  getCraftingRank,
  getCraftingSeconds,
} from "@/libs/crafting";
import {
  getServiceRepairDurability,
  isServiceEquipmentAvailable,
  serviceImbueError,
  serviceRecipeError,
} from "@/libs/craftingServices";
import { getPvpBoost } from "@/libs/pvpExperience";
import {
  filterQuestTrackersForDbPersist,
  getCraftTrackerTasks,
  getNewTrackers,
} from "@/libs/quest";
import { needsInventoryRepair } from "@/libs/repair";
import { getTerritoryWarBoost } from "@/libs/territoryWar";
import {
  acceptServiceRequest,
  claimServiceCrafter,
  claimServiceOffer,
  claimServiceUser,
  consumeServiceMaterial,
  escrowServiceEquipment,
  findOpenServiceRequests,
  findServiceEquipment,
  findServiceHistory,
  findServicePrices,
  findVisibleOpenServiceRequests,
  insertServiceRequest,
  notifyServiceRequest,
  saveServicePrice,
} from "@/queries/craftingServices";
import { fetchItemWithCraftingRequirements } from "@/queries/item";
import { fetchUser } from "@/queries/profile";
import { fetchUserItems } from "@/server/api/routers/item";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { errorResponse, protectedProcedure } from "@/server/api/trpc";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import {
  CraftingServiceConflict,
  completeCraftingService,
  publishServiceNotification,
  refundCraftingService,
  settleCraftingServices,
} from "@/server/utils/craftingServices";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { handleQuestConsequences } from "@/server/utils/questConsequences";
import { getNextUserSnapshotAt } from "@/utils/time";
import { countBoostingShrines, getShrineBoost } from "@/utils/village";
import type { CraftingQueueMaterial } from "@/validators/train";

export const craftingServiceProcedures = {
  getServicePrices: protectedProcedure
    .input(z.object({ crafterId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [crafter, prices] = await Promise.all([
        fetchUser(ctx.drizzle, input.crafterId),
        findServicePrices(ctx.drizzle, input.crafterId),
      ]);
      return {
        crafter: {
          userId: crafter.userId,
          username: crafter.username,
          occupation: crafter.occupation,
          rank: getCraftingRank(crafter.craftingExperience),
        },
        prices,
      };
    }),
  setServicePrice: protectedProcedure
    .input(
      z.object({
        service: z.enum(CRAFTING_SERVICES),
        rarity: z.enum(ItemRarities),
        fee: z.number().int().min(0).max(CRAFTING_SERVICE_MAX_FEE),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.occupation !== "CRAFTING")
        return errorResponse("Select the Crafting occupation to offer services");
      await saveServicePrice(ctx.drizzle, { ...input, userId: ctx.userId });
      return { success: true, message: "Service price saved" };
    }),
  getServiceRequests: protectedProcedure.query(async ({ ctx }) => {
    let [pending, history] = await Promise.all([
      findVisibleOpenServiceRequests(ctx.drizzle, ctx.userId),
      findServiceHistory(ctx.drizzle, ctx.userId),
    ]);
    const now = new Date();
    const hasDue = pending.some(
      (row) => row.status === "ACTIVE" && row.finishesAt && row.finishesAt <= now,
    );
    const settlement = await settleCraftingServices(ctx.drizzle, pending, now);
    // A competing reader can win delivery, so reread even when this reader changed no rows.
    if (hasDue)
      [pending, history] = await Promise.all([
        findVisibleOpenServiceRequests(ctx.drizzle, ctx.userId),
        findServiceHistory(ctx.drizzle, ctx.userId),
      ]);
    const failed = new Set(settlement.failedRequestIds);
    return [
      ...new Map([...pending, ...history].map((row) => [row.id, row])).values(),
    ].map((row) => ({
      ...row,
      settlementError: failed.has(row.id)
        ? "Delivery is delayed. Your request is recorded; retry or contact support."
        : null,
    }));
  }),
  submitServiceRequest: protectedProcedure
    .input(
      z.object({
        crafterId: z.string(),
        service: z.enum(CRAFTING_SERVICES),
        itemId: z.string().optional(),
        userItemId: z.string().optional(),
        userCrystalItemId: z.string().optional(),
        imbuementId: z.string().optional(),
        expectedFee: z.number().int().min(0).max(CRAFTING_SERVICE_MAX_FEE),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.crafterId === ctx.userId)
        return errorResponse("Use your occupation tools for your own items");
      const [requesterResult, crafterResult, inventory, prices, recipe] =
        await Promise.all([
          fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
          fetchUpdatedUser({ client: ctx.drizzle, userId: input.crafterId }),
          fetchUserItems(ctx.drizzle, ctx.userId),
          findServicePrices(ctx.drizzle, input.crafterId),
          input.itemId
            ? fetchItemWithCraftingRequirements(ctx.drizzle, input.itemId)
            : undefined,
        ]);
      const initialRequester = requesterResult.user;
      if (!initialRequester) return errorResponse("Requester not found");
      if (initialRequester.isBanned) return errorResponse("You are banned");
      const readiness = prepareActionReadiness(
        initialRequester,
        requesterResult.settings,
      );
      if (readiness.error) return errorResponse(readiness.error);
      const requester = readiness.user;
      const crafter = crafterResult.user;
      if (crafter?.occupation !== "CRAFTING")
        return errorResponse("This player is not a crafter");
      const block = craftingStartBlockMessage(requester);
      if (block) return errorResponse(block);
      const rank = getCraftingRank(crafter.craftingExperience);
      const target = inventory.find((row) => row.id === input.userItemId);
      const crystal = inventory.find((row) => row.id === input.userCrystalItemId);
      const imbuement = target?.imbuements.find((row) => row.id === input.imbuementId);
      const info = input.service === "CRAFT" ? recipe : target?.item;
      if (!info) return errorResponse("Select a recipe or an owned item");
      if (
        input.service !== "CRAFT" &&
        (!target || !isServiceEquipmentAvailable(target))
      )
        return errorResponse(
          "Select an available, unequipped single item outside storage and auction",
        );
      if (input.service === "CRAFT" && recipe) {
        const error = serviceRecipeError(recipe, rank, crafter);
        if (error) return errorResponse(error);
      }
      if (input.service === "IMBUE") {
        if (
          !target ||
          !crystal ||
          crystal.quantity < 1 ||
          crystal.isInAuction ||
          crystal.storedAtHome ||
          crystal.equipped !== "NONE" ||
          (crystal.craftingFinishedAt && crystal.craftingFinishedAt > new Date())
        )
          return errorResponse("Select an available crystal");
        const error = serviceImbueError(target, crystal.item, rank, crafter);
        if (error) return errorResponse(error);
      }
      if (
        input.service === "DISIMBUE" &&
        (!imbuement ||
          !target?.item.canBeImbued ||
          CRAFTING_TIMES_MINS[rank][imbuement.item.rarity] === 0)
      )
        return errorResponse("Select an imbuement the crafter's rank can remove");
      if (
        input.service === "REPAIR" &&
        (!target ||
          !needsInventoryRepair(target) ||
          target.item.itemType === "FURNITURE")
      )
        return errorResponse("This item does not need repair");
      const rarity =
        input.service === "IMBUE"
          ? crystal?.item.rarity
          : input.service === "DISIMBUE"
            ? imbuement?.item.rarity
            : info.rarity;
      const price = prices.find(
        (row) => row.service === input.service && row.rarity === rarity && row.enabled,
      );
      if (!price || price.fee !== input.expectedFee)
        return errorResponse(
          "This service price changed or is unavailable. Refresh the offer",
        );
      if (requester.money < price.fee)
        return errorResponse("You do not have enough ryo");
      const materials: CraftingQueueMaterial[] = [];
      const consumptions: { row: (typeof inventory)[number]; quantity: number }[] = [];
      for (const requirement of input.service === "CRAFT"
        ? (recipe?.craftingRequirements ?? [])
        : []) {
        const available = inventory.filter(
          (row) =>
            !row.storedAtHome && row.equipped === "NONE" && row.imbuements.length === 0,
        );
        const { consumptions: planned } = calculateItemConsumption(
          available,
          requirement.requirementItemId,
          requirement.quantity,
        );
        if (
          planned.reduce((sum, row) => sum + row.consumeQuantity, 0) !==
          requirement.quantity
        )
          return errorResponse(`Insufficient ${requirement.requirementItem.name}`);
        for (const take of planned) {
          const row = inventory.find((row) => row.id === take.userItemId);
          if (!row) return errorResponse("Materials changed. Please try again");
          consumptions.push({ row, quantity: take.consumeQuantity });
          materials.push({
            userItemId: row.id,
            itemId: row.itemId,
            name: row.item.name,
            quantity: take.consumeQuantity,
            storedAtHome: false,
          });
        }
      }
      if (input.service === "IMBUE" && crystal) {
        consumptions.push({ row: crystal, quantity: 1 });
        materials.push({
          userItemId: crystal.id,
          itemId: crystal.itemId,
          name: crystal.item.name,
          quantity: 1,
          storedAtHome: false,
        });
      }
      const request: CraftingServiceRequest = {
        id: `service:${nanoid()}`,
        requesterId: ctx.userId,
        crafterId: input.crafterId,
        service: input.service,
        status: input.service === "REPAIR" ? "ACTIVE" : "PENDING",
        fee: price.fee,
        itemId: info.id,
        itemName: info.name,
        targetUserItemId: input.service === "CRAFT" ? null : (target?.id ?? null),
        crystalItemId:
          input.service === "IMBUE"
            ? (crystal?.itemId ?? null)
            : input.service === "DISIMBUE"
              ? (imbuement?.imbuementItemId ?? null)
              : null,
        imbuementId: imbuement?.id ?? null,
        materials,
        outputQuantity: input.service === "CRAFT" ? info.craftingOutputQuantity : 1,
        createdAt: new Date(),
        repairDurability:
          input.service === "REPAIR"
            ? getServiceRepairDurability(info.maxDurability, rank)
            : null,
        startedAt: input.service === "REPAIR" ? new Date() : null,
        finishesAt: input.service === "REPAIR" ? new Date() : null,
      };
      try {
        // Reserving materials and inserting their durable receipt cannot be one guarded UPDATE.
        // Roll back the debit and all consumed stacks when any snapshot loses a race.
        const notification = await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            if (
              (await claimServiceUser(tx, requester, price.fee, readiness))
                .rowsAffected !== 1
            )
              throw new CraftingServiceConflict(
                "Your balance or state changed. Please try again",
              );
            if ((await claimServiceCrafter(tx, crafter)).rowsAffected !== 1)
              throw new CraftingServiceConflict(
                "The crafter changed. Please try again",
              );
            if ((await claimServiceOffer(tx, price)).rowsAffected !== 1)
              throw new CraftingServiceConflict(
                "The service price changed. Refresh the offer",
              );
            for (const take of consumptions)
              if (
                (
                  await consumeServiceMaterial(
                    tx,
                    take.row,
                    take.quantity,
                    request.createdAt,
                  )
                ).rowsAffected !== 1
              )
                throw new CraftingServiceConflict(
                  "Materials changed. Please try again",
                );
            if (
              target &&
              input.service !== "CRAFT" &&
              (await escrowServiceEquipment(tx, target, request.id)).rowsAffected !== 1
            )
              throw new CraftingServiceConflict("Equipment changed. Please try again");
            await insertServiceRequest(tx, request);
            if (input.service !== "REPAIR")
              return notifyServiceRequest(tx, request, "requested");
          }),
        );
        if (notification) publishServiceNotification(ctx.drizzle, notification);
        if (input.service === "REPAIR")
          await completeCraftingService(ctx.drizzle, request);
        return actionReadinessResponse(
          {
            success: true,
            serviceUpdate: getServiceSubmissionCacheUpdate({
              requester: initialRequester,
              requesterResult,
              crafterResult,
              request,
              consumptions,
              equipment: input.service === "CRAFT" ? undefined : target,
              crafterName: crafter.username,
              crystalName:
                input.service === "IMBUE" ? crystal?.item.name : imbuement?.item.name,
            }),
            message:
              input.service === "REPAIR"
                ? "Repair completed and delivered to your inventory"
                : "Request sent. Your fee and items are held in escrow",
          },
          readiness,
          ctx.drizzle,
        );
      } catch (error) {
        if (error instanceof CraftingServiceConflict)
          return errorResponse(error.message);
        throw error;
      }
    }),
  respondToServiceRequest: protectedProcedure
    .input(
      z.object({
        requestId: z.string(),
        action: z.enum(["ACCEPT", "DECLINE", "CANCEL"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [open, updated] = await Promise.all([
        findOpenServiceRequests(ctx.drizzle, ctx.userId),
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
      ]);
      const request = open.find((row) => row.id === input.requestId);
      if (request?.status !== "PENDING" || request.service === "REPAIR")
        return errorResponse("This request has already been handled");
      if (
        input.action === "CANCEL"
          ? request.requesterId !== ctx.userId
          : request.crafterId !== ctx.userId
      )
        return errorResponse("You cannot manage this request");
      if (input.action !== "ACCEPT")
        return {
          success: await refundCraftingService(ctx.drizzle, request),
          message: "Request refunded",
        };
      const initialUser = updated.user;
      if (!initialUser) return errorResponse("User not found");
      if (initialUser.isBanned) return errorResponse("You are banned");
      const readiness = prepareActionReadiness(initialUser, updated.settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      if (user?.occupation !== "CRAFTING")
        return errorResponse("Select the Crafting occupation to accept work");
      const block = craftingStartBlockMessage(user);
      if (block) return errorResponse(block);
      // Inventory must follow the account snapshot: an intervening personal job either
      // appears in inventory or changes updatedAt and loses the slot CAS.
      const inventory = await fetchUserItems(ctx.drizzle, ctx.userId);
      if (
        (user.serviceCraftUntil && user.serviceCraftUntil > new Date()) ||
        user.queue.some((row) => row.kind === "CRAFT") ||
        inventory.some(
          (row) =>
            (row.craftingFinishedAt && row.craftingFinishedAt > new Date()) ||
            row.imbuements.some((imb) => imb.craftingFinishedAt > new Date()),
        )
      )
        return errorResponse(
          "Your crafting slot is occupied. Wait for your current work and queue to finish",
        );
      const [recipe, equipment] = await Promise.all([
        fetchItemWithCraftingRequirements(
          ctx.drizzle,
          request.service === "IMBUE" || request.service === "DISIMBUE"
            ? (request.crystalItemId ?? "")
            : request.itemId,
        ),
        request.targetUserItemId
          ? findServiceEquipment(ctx.drizzle, request)
          : undefined,
      ]);
      if (!recipe)
        return errorResponse(
          "This item is no longer available. Decline to refund the request",
        );
      const rank = getCraftingRank(user.craftingExperience);
      const error =
        request.service === "CRAFT"
          ? serviceRecipeError(recipe, rank, user)
          : request.service === "IMBUE" && equipment
            ? serviceImbueError(equipment, recipe, rank, user)
            : !equipment
              ? "Equipment is unavailable"
              : null;
      if (error) return errorResponse(error);
      if (request.service !== "CRAFT" && CRAFTING_TIMES_MINS[rank][recipe.rarity] === 0)
        return errorResponse("Your rank cannot service this crystal rarity");
      const territory = getTerritoryWarBoost(user);
      const seconds =
        request.service === "CRAFT"
          ? getCraftingSeconds(
              recipe,
              rank,
              1,
              getShrineBoost(
                countBoostingShrines(user.village?.sectors),
                "Crafting",
                user.village,
              ),
              user.clan?.craftingTimeBoost,
              getActivityBonuses(user).craftingReductionPercent,
              territory,
            )
          : CRAFTING_TIMES_MINS[rank][recipe.rarity] * 60;
      const finishesAt = new Date(Date.now() + seconds * 1000);
      const experience = getCraftingExperienceGain(
        request.service === "CRAFT"
          ? recipe.craftingExperience
          : Math.floor(recipe.craftingExperience / 2),
        user,
        territory,
        getPvpBoost(user, updated.settings).totalPercent,
      );
      const tasks =
        request.service === "CRAFT"
          ? getCraftTrackerTasks(experience, request.outputQuantity, request.itemId)
          : [{ task: "crafting_experience_gained" as const, increment: experience }];
      const progressedUser = {
        ...user,
        craftingExperience: user.craftingExperience + experience,
        serviceCraftUntil: finishesAt,
      };
      const { trackers, consequences, notifications } = getNewTrackers(
        progressedUser,
        tasks,
      );
      progressedUser.questData = filterQuestTrackersForDbPersist(trackers, user, true);
      try {
        const result = await handleQuestConsequences(
          ctx.drizzle,
          progressedUser,
          consequences,
          notifications,
          {
            readiness,
            alwaysClaimUserState: true,
            partyTrackers: trackers,
            claimUserState: async ({
              userId,
              updatedAt,
              set = {},
              where,
              readiness,
            }) => {
              const claimedAt = getNextUserSnapshotAt(updatedAt);
              const accepted = await retryOnDeadlock(() =>
                acceptServiceRequest(
                  ctx.drizzle,
                  request,
                  { userId, updatedAt },
                  experience,
                  { set, where, claimedAt },
                  finishesAt,
                  readiness,
                ),
              );
              return { success: accepted.rowsAffected === 3, claimedAt };
            },
          },
        );
        if (!result.claimed)
          throw new CraftingServiceConflict(
            "The request or participant state changed. Please refresh and try again",
          );
        return actionReadinessResponse(
          {
            success: true,
            message: [
              "Service started. Delivery and payment happen automatically when it finishes",
              ...result.notifications,
            ].join("\n"),
            itemsChanged:
              result.battleAttempted ||
              consequences.some(
                (entry) => entry.type === "add_item" || entry.type === "remove_item",
              ),
            inventoryChanges: result.battleAttempted
              ? undefined
              : result.inventoryChanges,
            ...result.battleUserUpdate,
          },
          readiness,
          ctx.drizzle,
          result.committedActivity,
        );
      } catch (error) {
        if (error instanceof CraftingServiceConflict)
          return errorResponse(error.message);
        throw error;
      }
    }),
};
