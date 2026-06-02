import { and, eq, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  ACTION_QUEUE_BASE_SLOTS,
  CLAN_BOOST_MAX_LEVEL,
  CLAN_BOOST_PERCENT_PER_LEVEL,
  CONSUMABLE_CRAFTING_TIMES_MINS,
  CRAFTING_TIMES_MINS,
  JUTSU_LEVEL_CAP,
  MAP_WAKE_ISLAND_SECTOR,
} from "@/drizzle/constants";
import { actionQueue, userData } from "@/drizzle/schema";
import {
  computeProjectedJutsuTrainingLevel,
  countUserActionQueue,
  executeCraftItem,
  executeJutsuTraining,
  executeStatTraining,
  fetchUserActionQueue,
  getActionQueueSlotLimit,
  getNextQueuePosition,
  payCraftMaterialsUpfront,
  processActionQueues,
  removeActionQueueEntry,
  removeActionQueueEntryWithRefund,
} from "@/libs/actionQueue";
import { getCraftingRank } from "@/libs/crafting";
import {
  calcJutsuTrainCost,
  calcJutsuTrainTime,
  canTrainJutsu,
  canUseJutsu,
} from "@/libs/train";
import { fetchItemWithCraftingRequirements, fetchUserItems } from "@/routers/item";
import { fetchJutsu, fetchUserJutsus } from "@/routers/jutsu";
import { fetchUpdatedUser } from "@/routers/profile";
import { fetchStudents } from "@/routers/sensei";
import { canChangeContent } from "@/utils/permissions";
import { formatSecondsToTimeDisplay } from "@/utils/time";
import { getShrineBoost } from "@/utils/village";
import {
  actionQueueEntrySchema,
  addCraftQueueSchema,
  addJutsuQueueSchema,
  addStatQueueSchema,
  removeActionQueueSchema,
} from "@/validators/actionQueue";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "../trpc";

const enrichQueueEntries = async (props: {
  client: Parameters<typeof fetchUserActionQueue>[0];
  userId: string;
  user: NonNullable<Awaited<ReturnType<typeof fetchUpdatedUser>>["user"]>;
  entries: Awaited<ReturnType<typeof fetchUserActionQueue>>;
  userJutsus: Awaited<ReturnType<typeof fetchUserJutsus>>;
  students: Awaited<ReturnType<typeof fetchStudents>>;
}) => {
  const { client, user, entries, userJutsus, students } = props;

  const jutsuIds = [
    ...new Set(entries.map((e) => e.jutsuId).filter(Boolean)),
  ] as string[];
  const itemIds = [
    ...new Set(entries.map((e) => e.itemId).filter(Boolean)),
  ] as string[];

  const [jutsus, items] = await Promise.all([
    Promise.all(jutsuIds.map((id) => fetchJutsu(client, id))),
    Promise.all(itemIds.map((id) => fetchItemWithCraftingRequirements(client, id))),
  ]);
  const jutsuMap = new Map(jutsuIds.map((id, i) => [id, jutsus[i]]));
  const itemMap = new Map(itemIds.map((id, i) => [id, items[i]]));

  const sectors = user.village?.sectors?.length || 0;
  const shrineBoost = getShrineBoost(sectors, "Crafting", user.village);
  const shrineBoostFactor = shrineBoost ? 1 - shrineBoost : 1;
  const clanCraftingTimeBoostCap =
    (CLAN_BOOST_MAX_LEVEL * CLAN_BOOST_PERCENT_PER_LEVEL) / 100;
  const clanCraftingTimeBoost = user.isOutlaw
    ? 0
    : Math.min((user.clan?.craftingTimeBoost ?? 0) / 100, clanCraftingTimeBoostCap);
  const clanCraftingTimeFactor = 1 - clanCraftingTimeBoost;
  const userCraftingRank = getCraftingRank(user.craftingExperience);

  return entries.map((entry) => {
    if (entry.queueType === "JUTSU" && entry.jutsuId) {
      const info = jutsuMap.get(entry.jutsuId);
      const level = entry.targetLevel ?? 0;
      const cost = info ? calcJutsuTrainCost(info, level, user, students) : null;
      const trainMs = info ? calcJutsuTrainTime(info, level, user) : null;
      return actionQueueEntrySchema.parse({
        ...entry,
        label: info ? `${info.name} → Lv.${level + 1}` : "Unknown jutsu",
        costLabel:
          entry.moneyCost !== null && entry.moneyCost !== undefined
            ? `${entry.moneyCost.toLocaleString()} ryo (paid)`
            : cost !== null
              ? `${cost.toLocaleString()} ryo`
              : null,
        durationLabel:
          trainMs !== null
            ? formatSecondsToTimeDisplay(Math.ceil(trainMs / 1000))
            : null,
      });
    }

    if (entry.queueType === "STAT" && entry.stat) {
      return actionQueueEntrySchema.parse({
        ...entry,
        label: `Train ${entry.stat}`,
        costLabel: null,
        durationLabel: user.trainingSpeed,
      });
    }

    if (entry.queueType === "CRAFT" && entry.itemId) {
      const item = itemMap.get(entry.itemId);
      const rankCraftingTime = item
        ? CRAFTING_TIMES_MINS[userCraftingRank][item.rarity]
        : 0;
      const craftingTime =
        item?.itemType === "CONSUMABLE"
          ? CONSUMABLE_CRAFTING_TIMES_MINS[item.rarity]
          : rankCraftingTime;
      const craftSeconds = Math.round(
        craftingTime * 60 * shrineBoostFactor * clanCraftingTimeFactor * entry.quantity,
      );
      return actionQueueEntrySchema.parse({
        ...entry,
        label: item ? `Craft ${entry.quantity}x ${item.name}` : "Unknown item",
        costLabel:
          entry.queuedMaterialRefunds && entry.queuedMaterialRefunds.length > 0
            ? "Materials paid"
            : "Materials on start",
        durationLabel: formatSecondsToTimeDisplay(craftSeconds),
      });
    }

    return actionQueueEntrySchema.parse({
      ...entry,
      label: "Unknown",
      costLabel: null,
      durationLabel: null,
    });
  });
};

const assertQueueCapacity = async (
  client: Parameters<typeof countUserActionQueue>[0],
  user: Parameters<typeof getActionQueueSlotLimit>[0],
  userId: string,
) => {
  const [count, limit] = await Promise.all([
    countUserActionQueue(client, userId),
    Promise.resolve(getActionQueueSlotLimit(user)),
  ]);
  if (count >= limit) {
    return errorResponse(`Action queue full (${limit} slot${limit === 1 ? "" : "s"})`);
  }
  return null;
};

export const actionQueueRouter = createTRPCRouter({
  get: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get user's action queue" } })
    .output(
      z.object({
        entries: z.array(actionQueueEntrySchema),
        slotsUsed: z.number(),
        slotLimit: z.number(),
      }),
    )
    .query(async ({ ctx }) => {
      const [{ user }, entries, userJutsus, students] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchUserActionQueue(ctx.drizzle, ctx.userId),
        fetchUserJutsus(ctx.drizzle, ctx.userId),
        fetchStudents(ctx.drizzle, ctx.userId),
      ]);
      if (!user)
        return { entries: [], slotsUsed: 0, slotLimit: ACTION_QUEUE_BASE_SLOTS };

      const enriched = await enrichQueueEntries({
        client: ctx.drizzle,
        userId: ctx.userId,
        user,
        entries,
        userJutsus,
        students,
      });

      return {
        entries: enriched,
        slotsUsed: entries.length,
        slotLimit: getActionQueueSlotLimit(user),
      };
    }),

  addJutsu: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Queue jutsu training" } })
    .input(addJutsuQueueSchema)
    .output(
      baseServerResponse.extend({
        data: z.object({ money: z.number() }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [{ user }, info, userJutsus, existingQueue, students] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchJutsu(ctx.drizzle, input.jutsuId),
        fetchUserJutsus(ctx.drizzle, ctx.userId),
        fetchUserActionQueue(ctx.drizzle, ctx.userId),
        fetchStudents(ctx.drizzle, ctx.userId),
      ]);
      if (!user) return errorResponse("User not found");
      if (!info) return errorResponse("Jutsu not found");

      const userjutsuObj = userJutsus.find((j) => j.jutsuId === input.jutsuId);
      if (!canTrainJutsu(info, user) && !info.parentJutsuId)
        return errorResponse("Jutsu not for you");
      if (info.parentJutsuId && !userjutsuObj)
        return errorResponse(
          "Evolution jutsus can only be obtained by evolving the parent jutsu",
        );
      if (info.parentJutsuId && userjutsuObj && !canUseJutsu(info, user))
        return errorResponse("Jutsu not for you");
      if (
        userJutsus.some(
          (j) =>
            j.jutsu.parentJutsuId === input.jutsuId ||
            j.parentJutsuParentId === input.jutsuId,
        )
      )
        return errorResponse("You have already evolved this jutsu");
      if (user.status !== "AWAKE") return errorResponse("Must be awake");
      if (info.hidden && !canChangeContent(user.role))
        return errorResponse("Jutsu is hidden, cannot be trained");

      const sameJutsuQueued = existingQueue.filter(
        (e) => e.queueType === "JUTSU" && e.jutsuId === input.jutsuId,
      ).length;
      const targetLevel = computeProjectedJutsuTrainingLevel(
        userJutsus,
        input.jutsuId,
        sameJutsuQueued,
      );
      if (targetLevel >= JUTSU_LEVEL_CAP) {
        return errorResponse("Jutsu is already at max level");
      }

      const isTraining = userJutsus.some(
        (j) => j.finishTraining && j.finishTraining > new Date(),
      );
      if (!isTraining) {
        return executeJutsuTraining({
          client: ctx.drizzle,
          userId: ctx.userId,
          jutsuId: input.jutsuId,
          trainingLevel: targetLevel,
          requireNoActiveTraining: true,
        });
      }

      const capacityError = await assertQueueCapacity(ctx.drizzle, user, ctx.userId);
      if (capacityError) return capacityError;

      const trainCost = calcJutsuTrainCost(info, targetLevel, user, students);
      const moneyUpdate = await ctx.drizzle
        .update(userData)
        .set({ money: sql`${userData.money} - ${trainCost}` })
        .where(and(eq(userData.userId, ctx.userId), gte(userData.money, trainCost)));
      if (moneyUpdate.rowsAffected !== 1) {
        return errorResponse("You don't have enough money");
      }

      const position = await getNextQueuePosition(ctx.drizzle, ctx.userId, "JUTSU");
      await ctx.drizzle.insert(actionQueue).values({
        id: nanoid(),
        userId: ctx.userId,
        queueType: "JUTSU",
        position,
        jutsuId: input.jutsuId,
        targetLevel,
        moneyCost: trainCost,
      });

      return {
        success: true,
        message: `Queued ${info.name} training (Lv.${targetLevel + 1}) for ${trainCost.toLocaleString()} ryo`,
        data: { money: user.money - trainCost },
      };
    }),

  addStat: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Queue stat training" } })
    .input(addStatQueueSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        forceRegen: true,
      });
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") return errorResponse("Must be awake to train");

      if (!user.currentlyTraining) {
        return executeStatTraining({
          client: ctx.drizzle,
          userId: ctx.userId,
          stat: input.stat,
          requireNoActiveTraining: true,
        });
      }

      const capacityError = await assertQueueCapacity(ctx.drizzle, user, ctx.userId);
      if (capacityError) return capacityError;

      const position = await getNextQueuePosition(ctx.drizzle, ctx.userId, "STAT");
      await ctx.drizzle.insert(actionQueue).values({
        id: nanoid(),
        userId: ctx.userId,
        queueType: "STAT",
        position,
        stat: input.stat,
      });

      return {
        success: true,
        message: `Queued ${input.stat} training`,
      };
    }),

  addCraft: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Queue item crafting" } })
    .input(addCraftQueueSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [{ user }, userItems, item] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchItemWithCraftingRequirements(ctx.drizzle, input.itemId),
      ]);
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE") return errorResponse("User is not awake");
      if (user.sector === MAP_WAKE_ISLAND_SECTOR) {
        return errorResponse("Cannot craft items on Wake Island");
      }
      if (user.occupation !== "CRAFTING") {
        return errorResponse("You must have the Crafting occupation to craft items");
      }
      if (!item) return errorResponse("Item not found");
      if (item.hidden)
        return errorResponse("This item is hidden and cannot be crafted");
      if (!item.canBeCrafted) return errorResponse("This item is not craftable");
      if (item.craftingRequirements.length === 0) {
        return errorResponse("This item cannot be crafted (no requirements defined)");
      }

      const userCraftingRank = getCraftingRank(user.craftingExperience);
      const rankCraftingTime = CRAFTING_TIMES_MINS[userCraftingRank][item.rarity];
      if (rankCraftingTime === 0) {
        return errorResponse("Your crafting rank is too low for this item");
      }

      const isCrafting = userItems.some(
        (i) => i.craftingFinishedAt && i.craftingFinishedAt > new Date(),
      );
      if (!isCrafting) {
        return executeCraftItem({
          client: ctx.drizzle,
          userId: ctx.userId,
          itemId: input.itemId,
          quantity: input.quantity,
          requireNoActiveCraft: true,
        });
      }

      const capacityError = await assertQueueCapacity(ctx.drizzle, user, ctx.userId);
      if (capacityError) return capacityError;

      const payment = await payCraftMaterialsUpfront({
        client: ctx.drizzle,
        userId: ctx.userId,
        user,
        itemWithRequirements: item,
        useritems: userItems,
        quantity: input.quantity,
      });
      if (!payment.success) return payment;
      if (!("refunds" in payment)) return payment;

      const position = await getNextQueuePosition(ctx.drizzle, ctx.userId, "CRAFT");
      await ctx.drizzle.insert(actionQueue).values({
        id: nanoid(),
        userId: ctx.userId,
        queueType: "CRAFT",
        position,
        itemId: input.itemId,
        quantity: input.quantity,
        queuedMaterialRefunds: payment.refunds,
      });

      return {
        success: true,
        message: `Queued crafting ${input.quantity}x ${item.name} (materials paid)`,
      };
    }),

  remove: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Remove an action queue entry" } })
    .input(removeActionQueueSchema)
    .output(
      baseServerResponse.extend({
        data: z
          .object({ refundedMoney: z.number(), money: z.number().optional() })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      if (!user) return errorResponse("User not found");

      const result = await removeActionQueueEntryWithRefund(
        ctx.drizzle,
        ctx.userId,
        input.id,
      );
      if (!result.found) return errorResponse("Queue entry not found");
      if (result.materialsRefundFailed) {
        return errorResponse(
          "Could not refund materials — inventory changed. Try again or contact support.",
        );
      }

      const parts: string[] = ["Removed from queue"];
      if (result.refundedMoney > 0) {
        parts.push(`refunded ${result.refundedMoney.toLocaleString()} ryo`);
      }
      if (result.refundedMaterials) {
        parts.push("refunded materials");
      }

      return {
        success: true,
        message: parts.join(" and "),
        data: {
          refundedMoney: result.refundedMoney,
          money:
            result.refundedMoney > 0 ? user.money + result.refundedMoney : undefined,
        },
      };
    }),

  process: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Process pending action queue entries" },
    })
    .output(
      baseServerResponse.extend({ data: z.object({ messages: z.array(z.string()) }) }),
    )
    .mutation(async ({ ctx }) => {
      const messages = await processActionQueues({
        client: ctx.drizzle,
        userId: ctx.userId,
      });
      return {
        success: true,
        message:
          messages.length > 0 ? messages.join("; ") : "No queued actions started",
        data: { messages },
      };
    }),
});
