import { z } from "zod";
import { nanoid } from "nanoid";
import { eq, sql, gte, and, like, desc, or } from "drizzle-orm";
import {
  item,
  userItem,
  userItemImbuement,
  userData,
  actionLog,
  bloodlineRolls,
  craftingRequirement,
  itemLoadout,
  userSkill,
} from "@/drizzle/schema";
import { ItemTypes, ItemSlots } from "@/drizzle/constants";
import { fetchUser, fetchUpdatedUser } from "@/routers/profile";
import { fetchStructures } from "@/routers/village";
import { fetchItemBloodlineRolls } from "@/routers/bloodline";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/api/trpc";
import { serverError, baseServerResponse, errorResponse } from "@/api/trpc";
import { ItemValidator } from "@/libs/combat/types";
import { canChangeContent } from "@/utils/permissions";
import { callDiscordContent } from "@/libs/discord";
import { getStrucBoost } from "@/utils/village";
import { calcItemSellingPrice, calcItemRepairCost } from "@/libs/item";
import {
  ANBU_ITEMSHOP_DISCOUNT_PERC,
  MEDNIN_HEAL_ITEM_DISCOUNT_PERC,
} from "@/drizzle/constants";
import { nonCombatConsume } from "@/libs/item";
import { getRandomElement } from "@/utils/array";
import { calcMaxItems, calcMaxEventItems } from "@/libs/item";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { calculateContentDiff } from "@/utils/diff";
import { fetchUserSkills } from "@/routers/skillTree";
import { HealTag, NonCombatGainSkill } from "@/libs/combat/types";
import { itemFilteringSchema } from "@/validators/item";
import { filterRollableBloodlines } from "@/libs/bloodline";
import { fetchBloodlines } from "@/routers/bloodline";
import { setEmptyStringsToNulls } from "@/utils/typeutils";
import { fedItemLoadouts } from "@/utils/paypal";
import type { UserItemWithRelations, UserData } from "@/drizzle/schema";
import type { ItemSlot } from "@/drizzle/constants";
import type { ZodAllTags } from "@/libs/combat/types";
import type { DrizzleClient } from "@/server/db";
import type { ItemLoadout } from "@/drizzle/schema";
import type { ItemFilteringSchema } from "@/validators/item";
import type { QueryCondition } from "@/utils/typeutils";
import { postProcessRewards, type PostProcessedRewards } from "@/libs/quest";
import { updateRewards } from "./quests";
import { collapseRewards } from "@/libs/quest";
import { ObjectiveReward, type ObjectiveRewardType } from "@/validators/objectives";

export const itemRouter = createTRPCRouter({
  getAllNames: publicProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.item.findMany({
      columns: {
        id: true,
        name: true,
        image: true,
        canBeHunted: true,
        canBeGathered: true,
      },
      orderBy: (table, { asc }) => [asc(table.name)],
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
  getItemWithCraftingRequirements: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchItemWithCraftingRequirements(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Item not found");
      }
      return result;
    }),
  getUserItem: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchUserItem(ctx.drizzle, ctx.userId, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Item not found");
      }
      return result;
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
  // Clone an existing item
  clone: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, itemData] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItemWithCraftingRequirements(ctx.drizzle, input.id),
      ]);
      // Guard
      if (!itemData) return errorResponse("Item not found");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");

      // Create new item with copied data
      const newItemId = nanoid();
      const clonedItem = {
        ...itemData,
        id: newItemId,
        name: `${itemData.name} - copy`,
        hidden: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Run all inserts at once
      await Promise.all([
        ctx.drizzle.insert(item).values(clonedItem),
        ...(itemData.craftingRequirements && itemData.craftingRequirements.length > 0
          ? [
              ctx.drizzle.insert(craftingRequirement).values(
                itemData.craftingRequirements.map((req) => ({
                  id: nanoid(),
                  craftItemId: newItemId,
                  requirementItemId: req.requirementItemId,
                  quantity: req.quantity,
                })),
              ),
            ]
          : []),
      ]);

      return { success: true, message: newItemId };
    }),
  // Delete a item
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const entry = await fetchItem(ctx.drizzle, input.id);
      if (entry && canChangeContent(user.role)) {
        await Promise.all([
          ctx.drizzle.delete(item).where(eq(item.id, input.id)),
          ctx.drizzle.delete(userItem).where(eq(userItem.itemId, input.id)),
          ctx.drizzle
            .delete(userItemImbuement)
            .where(eq(userItemImbuement.imbuementItemId, input.id)),
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "item",
            changes: [`Deleted: ${entry.name}`],
            relatedId: entry.id,
            relatedMsg: `Delete: ${entry.name}`,
            relatedImage: entry.image,
          }),
        ]);
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
      setEmptyStringsToNulls(input.data);
      // Query
      const [user, entry, itemWithName] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItemWithCraftingRequirements(ctx.drizzle, input.id),
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
      // Update crafting requirements
      const newRequirements = input.data.craftingRequirements;
      await ctx.drizzle
        .delete(craftingRequirement)
        .where(eq(craftingRequirement.craftItemId, input.id));

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
        ...(newRequirements && newRequirements?.length > 0
          ? [
              ctx.drizzle.insert(craftingRequirement).values(
                newRequirements
                  .map((req) =>
                    req.ids?.map((id) => ({
                      id: nanoid(),
                      craftItemId: input.id,
                      requirementItemId: id,
                      quantity: req.number,
                    })),
                  )
                  .flat(),
              ),
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
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;

      // Build where conditions using the generalized filter
      const baseFilters = itemDatabaseFilter(input);

      const results = await ctx.drizzle.query.item.findMany({
        offset: skip,
        limit: input.limit,
        where: and(...baseFilters),
        orderBy: (table, { asc }) => [
          asc(table.cost),
          asc(table.repsCost),
          asc(table.id),
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
        with: { imbuements: true },
      });
      const filteredUserItems = userItems.filter((i) => i.imbuements.length === 0);
      const totalQuantity = filteredUserItems.reduce((acc, i) => acc + i.quantity, 0);
      if (info && filteredUserItems.length > 0) {
        let currentCount = 0;
        for (const i of filteredUserItems.keys()) {
          const id = filteredUserItems?.[i]?.id;
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
      if (useritem.craftingFinishedAt && useritem.craftingFinishedAt > new Date()) {
        return errorResponse("Cannot sell crafting item");
      }
      if (useritem.isInAuction) {
        return errorResponse("Cannot sell item in auction");
      }
      // Derived
      const cost = calcItemSellingPrice(user, useritem, structures);
      // Mutate
      await Promise.all([
        ctx.drizzle.delete(userItem).where(eq(userItem.id, input.userItemId)),
        ctx.drizzle
          .delete(userItemImbuement)
          .where(eq(userItemImbuement.userItemId, input.userItemId)),
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
      const [useritems, user, loadouts] = await Promise.all([
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
      ]);
      // Mutate
      const result = await toggleEquipItem(
        ctx.drizzle,
        input.userItemId,
        useritems,
        user,
        input.slot,
      );
      // If anything happened
      if (result.success && "promises" in result && result.promises.length > 0) {
        // Update current loadout with new equipment state
        if (user.itemLoadout) {
          const currentLoadout = loadouts.find((l) => l.id === user.itemLoadout);
          if (currentLoadout) {
            const newItemData = result.newUserItems
              .filter((ui) => ui.equipped !== "NONE")
              .map((ui) => ({ itemId: ui.itemId, slot: ui.equipped }));
            result.promises.push(
              ctx.drizzle
                .update(itemLoadout)
                .set({ itemData: newItemData })
                .where(eq(itemLoadout.id, currentLoadout.id)),
            );
          }
        }
        // Execute all promises in parallel
        await Promise.all(result.promises);
        // Return
        return { success: true, message: result.message };
      }
      // Else return the result from toggling
      return result;
    }),
  // Consume item
  consume: protectedProcedure
    .input(z.object({ userItemId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const [updatedUser, useritem, allBloodlines, previousRolls, userSkills] =
        await Promise.all([
          fetchUpdatedUser({
            client: ctx.drizzle,
            userId: ctx.userId,
            forceRegen: true,
          }),
          fetchUserItem(ctx.drizzle, ctx.userId, input.userItemId),
          fetchBloodlines(ctx.drizzle),
          fetchItemBloodlineRolls(ctx.drizzle, ctx.userId),
          fetchUserSkills(ctx.drizzle, ctx.userId),
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

      // Rewards
      const rewards: ObjectiveRewardType[] = [];

      // Calculations
      const promises: Promise<any>[] = [];
      useritem.item.effects.forEach((effect) => {
        if (effect.type === "rollbloodline") {
          const bloodlinePool = filterRollableBloodlines({
            bloodlines: allBloodlines,
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
        } else if (effect.type === "noncombatconsumereward") {
          rewards.push(ObjectiveReward.parse(effect));
        } else if (effect.type === "noncombatgainskill") {
          const parsedEffect = NonCombatGainSkill.parse(effect);
          if (parsedEffect.skillId) {
            const skill = userSkills.find((s) => s.skill.id === parsedEffect.skillId);
            if (!skill) {
              promises.push(
                ctx.drizzle.insert(userSkill).values({
                  id: nanoid(),
                  userId: ctx.userId,
                  skillId: parsedEffect.skillId,
                  activated: false,
                }),
              );
              messages.push("You unlocked a special skill!");
            } else {
              messages.push(`You already have the skill ${skill.skill.name}.`);
            }
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
      // Parse rewards
      let processedRewards: PostProcessedRewards | null = null;
      if (rewards.length > 0) {
        const collapsedRewards = collapseRewards(rewards);
        processedRewards = postProcessRewards(collapsedRewards);
      }
      // Mutate
      const [{ items, jutsus, bloodlines, badges }] = await Promise.all([
        processedRewards
          ? updateRewards({
              client: ctx.drizzle,
              user,
              rewards: processedRewards,
              reason: "ITEM/CONSUME",
            })
          : { items: [], jutsus: [], bloodlines: [], badges: [] },
        ctx.drizzle
          .update(userData)
          .set(updates)
          .where(eq(userData.userId, ctx.userId)),
        useritem.quantity > 1
          ? ctx.drizzle
              .update(userItem)
              .set({ quantity: sql`${userItem.quantity} - 1` })
              .where(eq(userItem.id, input.userItemId))
          : Promise.all([
              ctx.drizzle.delete(userItem).where(eq(userItem.id, input.userItemId)),
              ctx.drizzle
                .delete(userItemImbuement)
                .where(eq(userItemImbuement.userItemId, input.userItemId)),
            ]),
        ...promises,
      ]);
      // Prettify rewards
      if (processedRewards) {
        processedRewards.reward_items = items.map((i) => i.name);
        processedRewards.reward_jutsus = jutsus.map((i) => i.name);
        processedRewards.reward_bloodlines = bloodlines.map((i) => i.name);
        processedRewards.reward_badges = badges.map((i) => i.name);
      }
      // Return
      return {
        success: true,
        message: `You used ${useritem.item.name}`,
        notifications: messages,
        rewards: processedRewards,
      };
    }),
  // Repair user item
  repair: protectedProcedure
    .input(z.object({ userItemId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, useritem] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItem(ctx.drizzle, ctx.userId, input.userItemId),
      ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!useritem) return errorResponse("User item not found");
      if (useritem.userId !== user.userId) return errorResponse("Not yours to repair");
      if (user.status !== "AWAKE") {
        return errorResponse(`Cannot repair items while ${user.status.toLowerCase()}`);
      }
      if (useritem.durability >= useritem.item.maxDurability) {
        return errorResponse("Item is already at full durability");
      }
      // Calculate repair cost
      const repairCost = calcItemRepairCost(useritem);
      if (user.money < repairCost) {
        return errorResponse(`Insufficient funds. Repair costs ${repairCost} ryo`);
      }
      // Mutate
      await Promise.all([
        ctx.drizzle
          .update(userData)
          .set({ money: sql`${userData.money} - ${repairCost}` })
          .where(eq(userData.userId, ctx.userId)),
        ctx.drizzle
          .update(userItem)
          .set({ durability: useritem.item.maxDurability })
          .where(eq(userItem.id, input.userItemId)),
      ]);
      return {
        success: true,
        message: `Repaired ${useritem.item.name} for ${repairCost} ryo`,
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
      const sDiscount = getStrucBoost("itemDiscountPerLvl", structures);
      const aDiscount = user.anbuId ? ANBU_ITEMSHOP_DISCOUNT_PERC : 0;
      const hDiscount = info?.effects.find((e) => e.type === "heal")
        ? MEDNIN_HEAL_ITEM_DISCOUNT_PERC
        : 0;
      const factor = (100 - sDiscount - aDiscount - hDiscount) / 100;
      // Guard
      if (user.villageId !== input.villageId) return errorResponse("Wrong village");
      if (!info) return errorResponse("Item not found");
      if (input.stack > 1 && !item.canStack) return errorResponse("Item cannot stack");
      if (input.stack > 1 && input.stack > info.stackSize)
        return errorResponse("You can not buy a stack with this many items");
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
      if (info.expireFromStoreAt && new Date(info.expireFromStoreAt) < new Date()) {
        return errorResponse("Item has expired");
      }
      const ryoCost = Math.ceil(info.cost * input.stack * factor);
      const repsCost = Math.ceil(info.repsCost * input.stack);
      const seichiSilverCost = Math.ceil(info.seichiSilverCost * input.stack);
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
          seichiSilver: sql`${userData.seichiSilver} - ${seichiSilverCost}`,
        })
        .where(
          and(
            eq(userData.userId, uid),
            gte(userData.money, ryoCost),
            gte(userData.reputationPoints, repsCost),
            gte(userData.seichiSilver, seichiSilverCost),
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
  // Auto-equip optimal items based on cost
  autoEquipOptimal: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Fetch user items
      const [useritems, user] = await Promise.all([
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);

      // Get unequipped items that are not stored at home, sorted by cost (descending)
      const unequippedItems = useritems
        .filter(
          (ui) =>
            ui.equipped === "NONE" &&
            !ui.storedAtHome &&
            !ui.isInAuction &&
            (!ui.craftingFinishedAt || ui.craftingFinishedAt < new Date()),
        )
        .sort((a, b) => b.item.cost - a.item.cost);
      let availableSlots = ItemSlots.filter(
        (slot) => !useritems.find((ui) => ui.equipped === slot),
      );

      // Guard
      if (unequippedItems.length === 0) {
        return errorResponse("No unequipped items available");
      }
      if (availableSlots.length === 0) {
        return errorResponse("No available slots to equip items");
      }

      // Try to equip each unequipped item
      const updatePromises = [];
      let nEquipped = 0;
      for (const useritem of unequippedItems) {
        const slot = availableSlots.find((slot) => slot.includes(useritem.item.slot));
        if (slot) {
          const result = await toggleEquipItem(
            ctx.drizzle,
            useritem.id,
            useritems,
            user,
            slot,
          );
          if (result.success && "promises" in result && result.promises.length > 0) {
            nEquipped++;
            updatePromises.push(...result.promises);
            availableSlots = availableSlots.filter((s) => s !== slot);
          }
        }
      }

      // Execute all updates
      if (updatePromises.length > 0) {
        await Promise.all(updatePromises);
      }

      return {
        success: true,
        message: `Equipped ${nEquipped} item${nEquipped === 1 ? "" : "s"}`,
      };
    }),
  getItemLoadouts: protectedProcedure.query(async ({ ctx }) => {
    // Query
    const [loadouts, user] = await Promise.all([
      fetchItemLoadouts(ctx.drizzle, ctx.userId),
      fetchUser(ctx.drizzle, ctx.userId),
    ]);
    // Derived
    const maxLoadouts = fedItemLoadouts(user);
    // Create missing loadouts if needed
    if (loadouts.length < maxLoadouts) {
      for (let i = loadouts.length; i < maxLoadouts; i++) {
        const loadout = {
          id: nanoid(),
          userId: ctx.userId,
          itemData: [],
          createdAt: new Date(),
        };
        await ctx.drizzle.insert(itemLoadout).values(loadout);
        loadouts.push(loadout);
      }
    }
    return maxLoadouts < loadouts.length ? loadouts.slice(0, maxLoadouts) : loadouts;
  }),
  selectItemLoadout: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [loadouts, user, useritems] = await Promise.all([
        fetchItemLoadouts(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserItems(ctx.drizzle, ctx.userId),
      ]);
      // Mutate & return result
      const id = input.id;
      return await selectItemLoadout(ctx.drizzle, id, loadouts, useritems, user);
    }),
});

/**
 * COMMON QUERIES WHICH ARE REUSED
 */

/**
 * @param client - The database client
 * @param loadoutId - The ID of the loadout to select
 * @param loadouts - The loadouts to select from
 * @param useritems - The user items to select from
 * @param user - The user data
 * @returns A promise that resolves to the result of the select
 */
export const selectItemLoadout = async (
  client: DrizzleClient,
  loadoutId: string,
  loadouts: ItemLoadout[],
  useritems: UserItemWithRelations[],
  user: UserData,
) => {
  // First unequip all items
  // Derived
  const loadout = loadouts.find((l) => l.id === loadoutId);
  const maxLoadouts = fedItemLoadouts(user);
  // Guard
  if (!loadout) return errorResponse("Loadout not found");
  if (maxLoadouts <= 0) return errorResponse("Loadouts not available");

  // Validate items in loadout
  const validItemData = [];
  const invalidItems = [];
  for (const itemEntry of loadout.itemData) {
    const useritem = useritems.find((ui) => ui.itemId === itemEntry.itemId);
    if (!useritem) {
      invalidItems.push(`Item not found`);
      continue;
    }
    if (useritem.storedAtHome) {
      invalidItems.push(`${useritem.item.name} is stored at home`);
      continue;
    }
    if (useritem.item.requiredLevel > user.level) {
      invalidItems.push(
        `${useritem.item.name} requires level ${useritem.item.requiredLevel}`,
      );
      continue;
    }
    if (useritem.craftingFinishedAt && useritem.craftingFinishedAt > new Date()) {
      invalidItems.push(`${useritem.item.name} is being crafted`);
      continue;
    }
    if (useritem.isInAuction) {
      invalidItems.push(`${useritem.item.name} is in auction`);
      continue;
    }
    const currentlyImbuing = useritem.imbuements.filter(
      (imbuement) =>
        imbuement.craftingFinishedAt && imbuement.craftingFinishedAt > new Date(),
    );
    if (currentlyImbuing.length > 0) {
      invalidItems.push(`${useritem.item.name} is being imbued`);
      continue;
    }
    validItemData.push(itemEntry);
  }

  // Get valid item ids
  const validItemIds = validItemData.map((i) => i.itemId);

  // First unequip all items
  await client
    .update(userItem)
    .set({ equipped: "NONE" })
    .where(eq(userItem.userId, user.userId));

  // Then equip valid items from loadout
  const equipPromises = [];
  for (const itemEntry of validItemData) {
    // Find the first available item with this itemId
    const userItemToEquip =
      useritems.find(
        (ui) => ui.itemId === itemEntry.itemId && ui.equipped === "NONE",
      ) || useritems.find((ui) => ui.itemId === itemEntry.itemId);

    if (userItemToEquip) {
      equipPromises.push(
        client
          .update(userItem)
          .set({ equipped: itemEntry.slot })
          .where(eq(userItem.id, userItemToEquip.id)),
      );
    }
  }
  // Execute all updates
  await Promise.all([
    client
      .update(userData)
      .set({ itemLoadout: loadout.id })
      .where(eq(userData.userId, user.userId)),
    ...equipPromises,
  ]);
  // Return
  const message =
    invalidItems.length > 0
      ? `Loadout selected. Warnings: ${invalidItems.join(", ")}`
      : "Loadout selected";

  return {
    success: true,
    message,
    items: useritems.filter((ui) => validItemIds.includes(ui.itemId)),
  };
};

export const fetchItem = async (client: DrizzleClient, id: string) => {
  return await client.query.item.findFirst({
    where: eq(item.id, id),
  });
};

export const fetchItemWithCraftingRequirements = async (
  client: DrizzleClient,
  id: string,
) => {
  return await client.query.item.findFirst({
    where: eq(item.id, id),
    with: {
      craftingRequirements: {
        with: {
          requirementItem: true,
        },
      },
    },
  });
};

export const fetchUserItems = async (client: DrizzleClient, userId: string) => {
  const useritems = await client.query.userItem.findMany({
    where: and(eq(userItem.userId, userId)),
    with: { item: true, imbuements: { with: { item: true } } },
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

/**
 * @param client - The database client
 * @param userItemId - The ID of the user item to toggle
 * @param useritems - The user items to toggle
 * @param user - The user data
 * @param slot - The slot to toggle (optional)
 * @returns A promise that resolves to the result of the toggle
 */
export const toggleEquipItem = async (
  client: DrizzleClient,
  userItemId: string,
  useritems: UserItemWithRelations[],
  user: UserData,
  slot?: ItemSlot,
) => {
  // Create a clone to be returned
  const newUserItems = structuredClone(useritems);
  // Get the user item
  const useritem = newUserItems.find((i) => i.id === userItemId);
  // Definitions & Guard
  if (!useritem) return errorResponse("User item not found");
  if (useritem.storedAtHome) return errorResponse("Fetch at home first");
  if (useritem.item.requiredLevel > user.level) {
    return errorResponse(
      `You need to be level ${useritem.item.requiredLevel} to equip this item`,
    );
  }
  if (useritem.craftingFinishedAt && useritem.craftingFinishedAt > new Date()) {
    return errorResponse("Cannot equip crafting item");
  }
  if (useritem.isInAuction) {
    return errorResponse("Cannot equip item in auction");
  }
  const currentlyImbuing = useritem.imbuements.filter(
    (imbuement) =>
      imbuement.craftingFinishedAt && imbuement.craftingFinishedAt > new Date(),
  );
  if (currentlyImbuing.length > 0) {
    return errorResponse("Cannot equip item because it is being imbued");
  }

  const doEquip = !useritem.equipped || useritem.equipped !== slot;
  const info = useritem.item;
  const instances = newUserItems.filter(
    (ui) => ui.itemId === info.id && ui.equipped !== "NONE",
  );
  const instancesEquipped = instances.length;
  if (doEquip && instancesEquipped >= info.maxEquips) {
    return errorResponse(
      `No more than ${info.maxEquips} instances. Already have ${instancesEquipped} equipped.`,
    );
  }
  // Determine equipment slot (first empty slots, then any slot)
  let newEquipSlot = slot;
  if (newEquipSlot === undefined) {
    ItemSlots.forEach((slot) => {
      if (slot.includes(info.slot) && !newUserItems.find((i) => i.equipped === slot)) {
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
  // We need to have a slot
  if (!newEquipSlot) return errorResponse("No slot found");
  // Response info
  let message = "";
  let promises: Promise<unknown>[] = [];
  // Mutate
  if (doEquip) {
    const userItemInSlot = newUserItems.find(
      (ui) => ui.equipped === newEquipSlot && ui.id !== useritem.id,
    );
    // Optimistic update
    useritem.equipped = newEquipSlot;
    if (userItemInSlot) {
      userItemInSlot.equipped = "NONE";
    }
    // Promises
    promises = [
      client
        .update(userItem)
        .set({ equipped: newEquipSlot })
        .where(eq(userItem.id, useritem.id)),
      ...(userItemInSlot
        ? [
            client
              .update(userItem)
              .set({ equipped: "NONE" })
              .where(eq(userItem.id, userItemInSlot.id)),
          ]
        : []),
    ];
    message = `Equipped ${info.name}`;
  } else {
    useritem.equipped = "NONE";
    promises = [
      client
        .update(userItem)
        .set({ equipped: "NONE" })
        .where(eq(userItem.id, useritem.id)),
    ];
    message = `Unequipped ${info.name}`;
  }
  // Return information
  return {
    success: true,
    message,
    promises,
    newUserItems,
  };
};

export const fetchItemLoadouts = async (client: DrizzleClient, userId: string) => {
  return await client.query.itemLoadout.findMany({
    where: eq(itemLoadout.userId, userId),
    orderBy: (table) => desc(table.createdAt),
  });
};

/**
 * Build database filters for item queries based on filtering schema
 */
export const itemDatabaseFilter = (
  input?: Partial<ItemFilteringSchema>,
): QueryCondition[] => {
  return [
    // Name filter
    ...(input?.name ? [like(item.name, `%${input.name}%`)] : []),

    // Item type filter
    ...(input?.itemType ? [eq(item.itemType, input.itemType)] : []),

    // Rarity filter
    ...(input?.itemRarity ? [eq(item.rarity, input.itemRarity)] : []),

    // Slot filter
    ...(input?.slot ? [eq(item.slot, input.slot)] : []),

    // Method filter
    ...(input?.method ? [eq(item.method, input.method)] : []),

    // Target filter
    ...(input?.target ? [eq(item.target, input.target)] : []),

    // Effect filter
    ...(input?.effect && input.effect.length > 0
      ? [
          or(
            ...input.effect.map(
              (effect: string) =>
                sql`JSON_SEARCH(${item.effects},'one',${effect}) IS NOT NULL`,
            ),
          ),
        ]
      : []),

    // Stat filter
    ...(input?.stat
      ? [sql`JSON_SEARCH(${item.effects},'one',${input.stat}) IS NOT NULL`]
      : []),

    // Event items filter
    ...(input?.eventItems !== undefined
      ? [eq(item.isEventItem, input.eventItems)]
      : []),

    // Shop filter
    ...(input?.onlyInShop !== undefined ? [eq(item.inShop, input.onlyInShop)] : []),

    // Hidden filter (default to false if not specified)
    ...(input?.hidden !== undefined
      ? [eq(item.hidden, input.hidden)]
      : [eq(item.hidden, false)]),

    // Crafting filter
    ...(input?.canBeCrafted !== undefined
      ? [eq(item.canBeCrafted, input.canBeCrafted)]
      : []),

    // Imbuing filter
    ...(input?.canBeImbued !== undefined
      ? [eq(item.canBeImbued, input.canBeImbued)]
      : []),

    // Hunting filter
    ...(input?.canBeHunted !== undefined
      ? [eq(item.canBeHunted, input.canBeHunted)]
      : []),

    // Gathering filter
    ...(input?.canBeGathered !== undefined
      ? [eq(item.canBeGathered, input.canBeGathered)]
      : []),

    // Trading filter
    ...(input?.canBeTraded !== undefined
      ? [eq(item.canBeTraded, input.canBeTraded)]
      : []),

    // Cost filters
    gte(item.cost, input?.minCost ?? 0),
    gte(item.repsCost, input?.minRepsCost ?? 0),
    gte(item.seichiSilverCost, input?.minSeichiSilverCost ?? 0),
  ];
};
