import { z } from "zod";
import { nanoid } from "nanoid";
import { eq, sql, gte, and, like } from "drizzle-orm";
import { item, userItem, userData, actionLog, bloodlineRolls } from "@/drizzle/schema";
import { ItemTypes, ItemSlots } from "@/drizzle/constants";
import { fetchUser, fetchUpdatedUser } from "@/routers/profile";
import { fetchStructures } from "@/routers/village";
import { fetchItemBloodlineRolls } from "@/routers/bloodline";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/api/trpc";
import { serverError, baseServerResponse, errorResponse } from "@/api/trpc";
import { ItemValidator } from "@/libs/combat/types";
import { canChangeContent } from "@/utils/permissions";
import { callDiscordContent } from "@/libs/discord";
import { effectFilters } from "@/libs/train";
import { structureBoost } from "@/utils/village";
import { calcItemSellingPrice } from "@/libs/item";
import { ANBU_ITEMSHOP_DISCOUNT_PERC } from "@/drizzle/constants";
import { nonCombatConsume } from "@/libs/item";
import { getRandomElement } from "@/utils/array";
import { calcMaxItems, calcMaxEventItems } from "@/libs/item";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { calculateContentDiff } from "@/utils/diff";
import { HealTag } from "@/libs/combat/types";
import { itemFilteringSchema } from "@/validators/item";
import { filterRollableBloodlines } from "@/libs/bloodline";
import { fetchBloodlines } from "@/routers/bloodline";
import type { ItemSlot } from "@/drizzle/constants";
import type { ZodAllTags } from "@/libs/combat/types";
import type { DrizzleClient } from "@/server/db";
import type { ExecutedQuery } from "@planetscale/database";

export const itemRouter = createTRPCRouter({
  getAllNames: publicProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.item.findMany({
      columns: { id: true, name: true, image: true },
    });
  }),
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchItem(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Item not found");
      }
      return result as Omit<typeof result, "effects"> & { effects: ZodAllTags[] };
    }),
  // Create new item
  create: protectedProcedure
    .input(z.object({ type: z.enum(ItemTypes) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (canChangeContent(user.role)) {
        const id = nanoid();
        await ctx.drizzle.insert(item).values({
          id: id,
          name: `New Item - ${id}`,
          image: IMG_AVATAR_DEFAULT,
          description: "New item description",
          itemType: input.type,
          rarity: "COMMON",
          slot: "ITEM",
          target: "CHARACTER",
          effects: [],
          hidden: true,
        });
        return { success: true, message: id };
      } else {
        return { success: false, message: `Not allowed to create item` };
      }
    }),
  // Delete a item
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const entry = await fetchItem(ctx.drizzle, input.id);
      if (entry && canChangeContent(user.role)) {
        await ctx.drizzle.delete(item).where(eq(item.id, input.id));
        await ctx.drizzle.delete(userItem).where(eq(userItem.itemId, input.id));
        return { success: true, message: `Item deleted` };
      } else {
        return { success: false, message: `Not allowed to delete item` };
      }
    }),
  // Update an item
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: ItemValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, entry, itemWithName] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItem(ctx.drizzle, input.id),
        ctx.drizzle.query.item.findFirst({
          columns: { name: true, id: true },
          where: eq(item.name, input.data.name),
        }),
      ]);
      // Guard
      if (!entry) return errorResponse("Item not found");
      if (itemWithName && itemWithName.id !== entry.id)
        return errorResponse("Item name already exists");
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to edit item");
      }
      // Calculate diff
      const diff = calculateContentDiff(entry, {
        id: entry.id,
        updatedAt: entry.updatedAt,
        createdAt: entry.createdAt,
        ...input.data,
      });
      // Update database
      await Promise.all([
        ctx.drizzle.update(item).set(input.data).where(eq(item.id, input.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "item",
          changes: diff,
          relatedId: entry.id,
          relatedMsg: `Update: ${entry.name}`,
          relatedImage: entry.image,
        }),
        ...(input.data.hidden
          ? [
              ctx.drizzle
                .update(userItem)
                .set({ equipped: "NONE" })
                .where(eq(userItem.itemId, entry.id)),
            ]
          : []),
      ]);
      if (process.env.NODE_ENV !== "development") {
        await callDiscordContent(user.username, entry.name, diff, entry.image);
      }
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),
  getAll: publicProcedure
    .input(
      itemFilteringSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.effect && !(effectFilters as string[]).includes(input.effect)) {
        throw serverError("PRECONDITION_FAILED", `Invalid filter: ${input.effect}`);
      }
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const results = await ctx.drizzle.query.item.findMany({
        offset: skip,
        limit: input.limit,
        where: and(
          ...(input.name ? [like(item.name, `%${input.name}%`)] : []),
          ...(input.itemRarity ? [eq(item.rarity, input.itemRarity)] : []),
          ...(input.itemType ? [eq(item.itemType, input.itemType)] : []),
          ...(input.slot ? [eq(item.slot, input.slot)] : []),
          ...(input.method ? [eq(item.method, input.method)] : []),
          ...(input.target ? [eq(item.target, input.target)] : []),
          ...(input.effect
            ? [sql`JSON_SEARCH(${item.effects},'one',${input.effect}) IS NOT NULL`]
            : []),
          ...(input.stat
            ? [sql`JSON_SEARCH(${item.effects},'one',${input.stat}) IS NOT NULL`]
            : []),
          ...(input.eventItems !== undefined
            ? [eq(item.isEventItem, input.eventItems)]
            : []),
          ...(input.onlyInShop ? [eq(item.inShop, true)] : []),
          ...(input?.hidden !== undefined
            ? [eq(item.hidden, input.hidden)]
            : [eq(item.hidden, false)]),
          gte(item.cost, input.minCost),
          gte(item.repsCost, input.minRepsCost),
        ),
        orderBy: (table, { asc }) => [
          asc(table.cost),
          asc(table.repsCost),
        ],
      });
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),
  // Get counts of user items grouped by item ID
  getUserItemCounts: protectedProcedure.query(async ({ ctx }) => {
    const counts = await ctx.drizzle
      .select({
        count: sql<number>`count(${userItem.id})`,
        itemId: userItem.itemId,
        quantity: sql<number>`sum(${userItem.quantity})`,
      })
      .from(userItem)
      .where(eq(userItem.userId, ctx.userId))
      .groupBy(userItem.itemId);
    return counts.map((c) => ({ id: c.itemId, quantity: c.quantity ?? 0 }));
  }),
  // Get user items
  getUserItems: protectedProcedure.query(async ({ ctx }) => {
    return await fetchUserItems(ctx.drizzle, ctx.userId);
  }),
  // Merge item stacks
  mergeStacks: protectedProcedure
    .input(z.object({ itemId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const info = await fetchItem(ctx.drizzle, input.itemId);
      const userItems = await ctx.drizzle.query.userItem.findMany({
        where: and(eq(userItem.userId, ctx.userId), eq(userItem.itemId, input.itemId)),
      });
      const totalQuantity = userItems.reduce((acc, i) => acc + i.quantity, 0);
      if (info && userItems.length > 0) {
        let currentCount = 0;
        for (const i of userItems.keys()) {
          const id = userItems?.[i]?.id;
          const newQuantity = Math.min(info.stackSize, totalQuantity - currentCount);
          if (id) {
            if (newQuantity > 0) {
              currentCount += newQuantity;
              await ctx.drizzle
                .update(userItem)
                .set({ quantity: newQuantity })
                .where(eq(userItem.id, id));
            } else {
              await ctx.drizzle.delete(userItem).where(eq(userItem.id, id));
            }
          }
        }
        return { success: true, message: `Merged stacks of ${info.name}` };
      }
      return { success: false, message: "Failed to merge stacks" };
    }),
  // Drop user item
  sellUserItem: protectedProcedure
    .input(z.object({ userItemId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, useritem] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItem(ctx.drizzle, ctx.userId, input.userItemId),
      ]);
      const structures = await fetchStructures(ctx.drizzle, user.villageId);
      // Guard
      if (!useritem) return errorResponse("User item not found");
      if (useritem.userId !== user.userId) return errorResponse("Not yours to sell");
      // Derived
      const cost = calcItemSellingPrice(user, useritem, structures);
      // Mutate
      await Promise.all([
        ctx.drizzle.delete(userItem).where(eq(userItem.id, input.userItemId)),
        ctx.drizzle
          .update(userData)
          .set({ money: sql`${userData.money} + ${cost}` })
          .where(eq(userData.userId, ctx.userId)),
        ...(useritem.item.cost >= 500000
          ? [
              ctx.drizzle.insert(actionLog).values({
                id: nanoid(),
                userId: ctx.userId,
                tableName: "user",
                changes: [`Sold item: ${useritem.item.name} for ${cost} ryo`],
                relatedId: ctx.userId,
                relatedMsg: `Sold item: ${useritem.item.name}`,
                relatedImage: useritem.item.image,
              }),
            ]
          : []),
      ]);
      return {
        success: true,
        message:
          cost > 0
            ? `You sold ${useritem.item.name} for ${cost} ryo`
            : `You dropped ${useritem.item.name}`,
      };
    }),
  // Use user item
  toggleEquip: protectedProcedure
    .input(z.object({ userItemId: z.string(), slot: z.enum(ItemSlots).optional() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [useritems, user] = await Promise.all([
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      const useritem = useritems.find((i) => i.id === input.userItemId);
      // Definitions & Guard
      if (!useritem) return errorResponse("User item not found");
      if (useritem.storedAtHome) return errorResponse("Fetch at home first");
      if (user.level < useritem.item.requiredLevel) {
        return errorResponse(`You need to be level ${useritem.item.requiredLevel} to equip this item`);
      }
      const doEquip = !useritem.equipped || useritem.equipped !== input.slot;
      const info = useritem.item;
      const instances = useritems.filter(
        (ui) => ui.itemId === info.id && ui.equipped !== "NONE",
      );
      const instancesEquipped = instances.length;
      if (doEquip && instancesEquipped >= info.maxEquips) {
        return errorResponse(
          `No more than ${info.maxEquips} instances. Already have ${instancesEquipped} equipped.`,
        );
      }
      // Determine equipment slot (first empty slots, then any slot)
      let newEquipSlot = input.slot;
      if (newEquipSlot === undefined) {
        ItemSlots.forEach((slot) => {
          if (slot.includes(info.slot) && !useritems.find((i) => i.equipped === slot)) {
            newEquipSlot = slot;
          }
        });
        if (newEquipSlot === undefined) {
          ItemSlots.forEach((slot) => {
            if (slot.includes(info.slot)) {
              newEquipSlot = slot;
            }
          });
        }
      }
      // Mutate
      if (doEquip) {
        const userItemInSlot = useritems.find(
          (ui) => ui.equipped === newEquipSlot && ui.id !== useritem.id,
        );
        await Promise.all([
          ctx.drizzle
            .update(userItem)
            .set({ equipped: newEquipSlot })
            .where(eq(userItem.id, useritem.id)),
          ...(userItemInSlot
            ? [
                ctx.drizzle
                  .update(userItem)
                  .set({ equipped: "NONE" })
                  .where(eq(userItem.id, userItemInSlot.id)),
              ]
            : []),
        ]);
        return { success: true, message: `Equipped ${info.name}` };
      } else {
        await ctx.drizzle
          .update(userItem)
          .set({ equipped: "NONE" })
          .where(eq(userItem.id, useritem.id));
        return { success: true, message: `Unequipped ${info.name}` };
      }
    }),
  // Consume item
  consume: protectedProcedure
    .input(z.object({ userItemId: z.string() }))
    .output(baseServerResponse.extend({ data: z.unknown().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const [updatedUser, useritem, bloodlines, previousRolls] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
          forceRegen: true,
        }),
        fetchUserItem(ctx.drizzle, ctx.userId, input.userItemId),
        fetchBloodlines(ctx.drizzle),
        fetchItemBloodlineRolls(ctx.drizzle, ctx.userId),
      ]);
      const { user } = updatedUser;

      // Guard
      if (!user) return errorResponse("User not found");
      if (!useritem) return errorResponse("User item not found");
      if (useritem.userId !== user.userId) return errorResponse("Not yours to consume");
      if (user.status !== "AWAKE")
        return errorResponse(`Cannot use items while ${user.status.toLowerCase()}`);
      if (!nonCombatConsume(useritem.item, user)) {
        return errorResponse("Not consumable");
      }

      // Bookkeeping
      const messages: string[] = [];
      const updates = {
        bloodlineId: user.bloodlineId,
        curHealth: user.curHealth,
        curStamina: user.curStamina,
        curChakra: user.curChakra,
        marriageSlots: user.marriageSlots,
      };
      const data: unknown[] = [];

      // Calculations
      const promises: Promise<ExecutedQuery<any[] | Record<string, any>>>[] = [];
      useritem.item.effects.forEach((effect) => {
        if (effect.type === "rollbloodline") {
          const bloodlinePool = filterRollableBloodlines({
            bloodlines,
            user,
            previousRolls,
            rank: effect.rank,
          });
          data.push(bloodlinePool);
          const randomBloodline = getRandomElement(bloodlinePool);
          if (!randomBloodline) throw serverError("NOT_FOUND", "No bloodline found");
          // Success?
          const roll = Math.random() * 100;
          const success = roll < effect.power;
          data.push({ roll, success });
          // Log action
          const previousRoll = previousRolls.find((r) =>
            success
              ? r.bloodlineId === randomBloodline.id
              : r.goal === effect.rank && !r.bloodlineId,
          );
          if (previousRoll) {
            promises.push(
              ctx.drizzle
                .update(bloodlineRolls)
                .set({ used: sql`${bloodlineRolls.used} + 1`, updatedAt: new Date() })
                .where(eq(bloodlineRolls.id, previousRoll.id)),
            );
          } else {
            promises.push(
              ctx.drizzle.insert(bloodlineRolls).values({
                id: nanoid(),
                userId: ctx.userId,
                type: "ITEM",
                bloodlineId: success ? randomBloodline.id : null,
                goal: effect.rank,
                used: 1,
              }),
            );
          }
          // Message
          if (success) {
            updates.bloodlineId = randomBloodline.id;
            messages.push(`You rolled a new bloodline: ${randomBloodline.name}. `);
          } else {
            messages.push(`You rolled for a new bloodline, but none was found. `);
          }
        } else if (effect.type === "removebloodline") {
          if (Math.random() * 100 < effect.power) {
            updates.bloodlineId = null;
            messages.push(`Your bloodline was removed. `);
          } else {
            messages.push(`Your bloodline could not be removed successfully.`);
          }
        } else if (effect.type === "marriageslotincrease") {
          if (updates.marriageSlots < 5) {
            updates.marriageSlots += effect.power;
            if (updates.marriageSlots > 5) {
              updates.marriageSlots = 5;
            }
            messages.push(`Your marriage slots were increased! `);
          } else {
            messages.push(
              `Your marriage slots are already at max! Current Slots: ${updates.marriageSlots}`,
            );
          }
        } else if (effect.type === "heal") {
          const parsedEffect = HealTag.parse(effect);
          const poolsAffects = parsedEffect.poolsAffected || ["Health"];
          poolsAffects.forEach((pool) => {
            switch (pool) {
              case "Health":
                const oldHp = updates.curHealth;
                updates.curHealth = Math.min(
                  user.curHealth +
                    (effect.calculation === "percentage"
                      ? user.maxHealth * (effect.power / 100)
                      : effect.power),
                  user.maxHealth,
                );
                messages.push(`You healed ${Math.ceil(updates.curHealth - oldHp)} HP`);
                break;
              case "Chakra":
                const oldCp = updates.curChakra;
                updates.curChakra = Math.min(
                  user.curChakra +
                    (effect.calculation === "percentage"
                      ? user.maxChakra * (effect.power / 100)
                      : effect.power),
                  user.maxChakra,
                );
                messages.push(`You healed ${Math.ceil(updates.curChakra - oldCp)} CP`);
                break;
              case "Stamina":
                const oldSp = updates.curStamina;
                updates.curStamina = Math.min(
                  user.curStamina +
                    (effect.calculation === "percentage"
                      ? user.maxStamina * (effect.power / 100)
                      : effect.power),
                  user.maxStamina,
                );
                messages.push(`You healed ${Math.ceil(updates.curStamina - oldSp)} SP`);
                break;
            }
          });
        }
      });
      // Mutate
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set(updates)
          .where(eq(userData.userId, ctx.userId)),
        useritem.quantity > 1
          ? ctx.drizzle
              .update(userItem)
              .set({ quantity: sql`${userItem.quantity} - 1` })
              .where(eq(userItem.id, input.userItemId))
          : ctx.drizzle.delete(userItem).where(eq(userItem.id, input.userItemId)),
        ...promises,
      ]);
      // Return
      return {
        success: true,
        message: `You used ${useritem.item.name}. ${messages.join(". ")}`,
        data,
      };
    }),
  // Buy user item
  buy: protectedProcedure
    .input(
      z.object({
        itemId: z.string(),
        stack: z.number().min(1).max(50),
        villageId: z.string().nullish(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const iid = input.itemId;
      const uid = ctx.userId;
      const [user, info, useritems, structures] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItem(ctx.drizzle, iid),
        fetchUserItems(ctx.drizzle, uid),
        fetchStructures(ctx.drizzle, input.villageId),
      ]);
      // Derived
      const regularItemsCount =
        useritems?.filter((ui) => !ui.item.isEventItem && !ui.storedAtHome).length || 0;
      const eventItemsCount =
        useritems?.filter((ui) => ui.item.isEventItem && !ui.storedAtHome).length || 0;
      const sDiscount = structureBoost("itemDiscountPerLvl", structures);
      const aDiscount = user.anbuId ? ANBU_ITEMSHOP_DISCOUNT_PERC : 0;
      const factor = (100 - sDiscount - aDiscount) / 100;
      // Guard
      if (user.villageId !== input.villageId) return errorResponse("Wrong village");
      if (!info) return errorResponse("Item not found");
      if (input.stack > 1 && !item.canStack) return errorResponse("Item cannot stack");
      if (!info.inShop) return errorResponse("Item is not for sale");
      if (user.isBanned) return errorResponse("You are banned");
      if (info.hidden && !canChangeContent(user.role)) {
        return errorResponse("Item is hidden, cannot be bought");
      }
      if (!info.isEventItem && regularItemsCount >= calcMaxItems(user)) {
        return errorResponse("Inventory is full");
      }
      if (info.isEventItem && eventItemsCount >= calcMaxEventItems(user)) {
        return errorResponse("Event item inventory is full");
      }
      const ryoCost = Math.ceil(info.cost * input.stack * factor);
      const repsCost = Math.ceil(info.repsCost * input.stack);
      // Figure out if we equip this
      let equipped: ItemSlot = "NONE";
      const instancesEquipped = useritems.filter(
        (ui) => ui.itemId === info.id && ui.equipped !== "NONE",
      ).length;
      if (
        !info.effects.find((e) => e.type.includes("bloodline")) &&
        instancesEquipped < info.maxEquips &&
        user.level >= info.requiredLevel
      ) {
        ItemSlots.forEach((slot) => {
          if (slot.includes(info.slot) && !useritems.find((i) => i.equipped === slot)) {
            equipped = slot;
          }
        });
      }
      // Mutate
      const result = await ctx.drizzle
        .update(userData)
        .set({
          money: sql`${userData.money} - ${ryoCost}`,
          reputationPoints: sql`${userData.reputationPoints} - ${repsCost}`,
        })
        .where(
          and(
            eq(userData.userId, uid),
            gte(userData.money, ryoCost),
            gte(userData.reputationPoints, repsCost),
          ),
        );
      if (result.rowsAffected !== 1) {
        return { success: false, message: "Insufficient funds for this purchase" };
      }
      await ctx.drizzle.insert(userItem).values({
        id: nanoid(),
        userId: uid,
        itemId: iid,
        quantity: input.stack,
        equipped: equipped,
      });
      return { success: true, message: `You bought ${info.name}` };
    }),
});

/**
 * COMMON QUERIES WHICH ARE REUSED
 */

export const fetchItem = async (client: DrizzleClient, id: string) => {
  return await client.query.item.findFirst({
    where: eq(item.id, id),
  });
};

export const fetchUserItems = async (client: DrizzleClient, userId: string) => {
  const useritems = await client.query.userItem.findMany({
    where: eq(userItem.userId, userId),
    with: { item: true },
  });
  return useritems.filter((ui) => ui.item && !ui.item.hidden);
};

export const fetchUserItem = async (
  client: DrizzleClient,
  userId: string,
  userItemId: string,
) => {
  return await client.query.userItem.findFirst({
    where: and(eq(userItem.userId, userId), eq(userItem.id, userItemId)),
    with: { item: true },
  });
};
