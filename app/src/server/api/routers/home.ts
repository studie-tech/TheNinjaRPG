import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { baseServerResponse, errorResponse } from "@/server/api/trpc";
import { eq, gte, and, sql } from "drizzle-orm";
import { userData, userItem } from "@/drizzle/schema";
import { fetchUpdatedUser } from "@/routers/profile";
import { getServerPusher, updateUserOnMap } from "@/libs/pusher";
import { calcIsInVillage } from "@/libs/travel/controls";
import { fetchSectorVillage } from "@/routers/village";
import { HomeTypes, HomeTypeDetails } from "@/drizzle/constants";
import { fetchUserItems } from "@/routers/item";
import {
  calcMaxItems,
  calcMaxEventItems,
  calcMaxMaterials,
  calcMaxHouseMaterials,
} from "@/libs/item";
import type { UserStatus } from "@/drizzle/constants";

export const homeRouter = createTRPCRouter({
  toggleSleep: protectedProcedure
    .output(
      baseServerResponse.extend({
        newStatus: z.enum(["AWAKE", "ASLEEP"]).optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      // Query
      const { user } = await fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
        forceRegen: true,
      });
      // Guard
      if (!user) return errorResponse("User not found");
      const inVillage = calcIsInVillage({ x: user.longitude, y: user.latitude });
      if (user.isOutlaw && inVillage) {
        const sectorVillage = await fetchSectorVillage(ctx.drizzle, user?.sector ?? -1);
        if (
          sectorVillage &&
          !["OUTLAW", "HIDEOUT", "TOWN"].includes(sectorVillage.type)
        ) {
          return errorResponse("You can't sleep in a village as an outlaw");
        }
      } else if (!user.isOutlaw && !inVillage) {
        return errorResponse("You can't sleep outside a village as a non-outlaw");
      }
      if (user.isBanned) return errorResponse("You are banned");
      if (!["ASLEEP", "AWAKE"].includes(user.status)) {
        return errorResponse("Invalid status, must be awake or asleep");
      }
      if (user.sector !== user.village?.sector && !user.isOutlaw) {
        return errorResponse("Wrong sector");
      }
      // Mutate
      const newStatus: UserStatus = user.status === "ASLEEP" ? "AWAKE" : "ASLEEP";
      if (user.status === "ASLEEP") {
        await ctx.drizzle
          .update(userData)
          .set({ status: "AWAKE" })
          .where(eq(userData.userId, ctx.userId));
      } else {
        const result = await ctx.drizzle
          .update(userData)
          .set({ status: "ASLEEP" })
          .where(
            and(
              eq(userData.userId, ctx.userId),
              eq(userData.status, "AWAKE"),
              gte(userData.curHealth, 0),
            ),
          );
        if (result.rowsAffected === 0) {
          return errorResponse("You can't sleep right now; are you awake and well?");
        }
      }
      // Push status update to sector
      const output = {
        longitude: user.longitude,
        latitude: user.latitude,
        sector: newStatus === "AWAKE" ? user.sector : -1,
        avatar: user.avatar,
        avatarLight: user.avatarLight,
        level: user.level,
        villageId: user.villageId,
        battleId: user.battleId,
        username: user.username,
        status: newStatus,
        location: "",
        userId: ctx.userId,
        curHealth: user.curHealth,
        maxHealth: user.maxHealth,
      };
      const pusher = getServerPusher();
      void updateUserOnMap(pusher, user.sector, output);
      // Done
      return {
        success: true,
        message: newStatus === "AWAKE" ? "You have woken up" : "You have gone to sleep",
        newStatus,
      };
    }),

  getUserHome: protectedProcedure.query(async ({ ctx }) => {
    // Query
    const { user } = await fetchUpdatedUser({
      client: ctx.drizzle,
      userId: ctx.userId,
    });
    // Guard
    if (!user) return null;
    // Return
    return {
      homeType: user.homeType,
      regen: HomeTypeDetails[user.homeType].regen,
      storage: HomeTypeDetails[user.homeType].storage,
    };
  }),

  getAvailableUpgrades: protectedProcedure.query(async ({ ctx }) => {
    // Query
    const { user } = await fetchUpdatedUser({
      client: ctx.drizzle,
      userId: ctx.userId,
    });
    // Guard
    if (!user) return [];
    // Derived
    const currentHomeIndex = HomeTypes.indexOf(user.homeType);
    // Return all other home types, with a boolean indicating if it's an upgrade or downgrade
    const upgrades = HomeTypes.map((homeType, i) => ({
      type: homeType,
      ...HomeTypeDetails[homeType],
      isUpgrade: i > currentHomeIndex,
    })).filter((upgrade) => upgrade.type !== user.homeType);
    return upgrades;
  }),

  upgradeHome: protectedProcedure
    .input(z.object({ homeType: z.enum(HomeTypes) }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [useritems, { user }] = await Promise.all([
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
      ]);
      const storedItems = useritems.filter((ui) => ui.storedAtHome);
      // Guard
      if (!user) return errorResponse("User not found");
      if (user.isBanned) return errorResponse("You are banned");
      if (user.homeType === input.homeType)
        return errorResponse("You already own this home type");
      // Derived
      const targetHome = HomeTypeDetails[input.homeType];
      // Upgrading or downgrading
      if (HomeTypes.indexOf(input.homeType) > HomeTypes.indexOf(user.homeType)) {
        if (user.money < targetHome.cost) return errorResponse("Not enough Ryo");
        await ctx.drizzle
          .update(userData)
          .set({
            money: sql`${user.money} - ${targetHome.cost}`,
            homeType: input.homeType,
          })
          .where(eq(userData.userId, ctx.userId));
        return { success: true, message: `Upgraded to ${targetHome.name}` };
      } else {
        const storedNormalItems =
          storedItems.filter((ui) => ui.item.itemType !== "MATERIAL").length || 0;
        const storedMaterialItems =
          storedItems.filter((ui) => ui.item.itemType === "MATERIAL").length || 0;
        if (storedNormalItems > targetHome.storage) {
          return errorResponse(
            `You need to remove some items from storage first (max ${targetHome.storage})`,
          );
        }
        if (storedMaterialItems > calcMaxHouseMaterials(user, targetHome.storage)) {
          return errorResponse(
            `You need to remove some materials from storage first (max ${calcMaxHouseMaterials(user, targetHome.storage)})`,
          );
        }
        await ctx.drizzle
          .update(userData)
          .set({ homeType: input.homeType })
          .where(eq(userData.userId, ctx.userId));
        return { success: true, message: `Downgraded to ${targetHome.name}` };
      }
    }),

  toggleStoreItem: protectedProcedure
    .input(z.object({ userItemId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [useritems, { user }] = await Promise.all([
        fetchUserItems(ctx.drizzle, ctx.userId),
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
      ]);
      const storedItems = useritems.filter((ui) => ui.storedAtHome);
      const nonStoredItems = useritems.filter((ui) => !ui.storedAtHome);
      const userItemResult = useritems.find((ui) => ui.id === input.userItemId);
      // Guard
      if (!user) return errorResponse("User not found");
      if (!userItemResult) return errorResponse("Item not found or is equipped");
      if (!userItemResult.item) return errorResponse("Item data not found");
      if (user.homeType === "NONE") {
        return errorResponse("You need a home to store items");
      }
      if (userItemResult.equipped !== "NONE") {
        return errorResponse("You can't store/retrieve already equipped items");
      }
      // Mutate
      if (userItemResult.storedAtHome) {
        const nonStoredNonMaterials = nonStoredItems.filter(
          (ui) => ui.item.itemType !== "MATERIAL",
        );
        const nRegularItems =
          nonStoredNonMaterials.filter((ui) => !ui.item.isEventItem).length || 0;
        const nEventItems =
          nonStoredNonMaterials.filter((ui) => ui.item.isEventItem).length || 0;
        const nMaterials =
          nonStoredItems.filter((ui) => ui.item.itemType === "MATERIAL").length || 0;
        if (!userItemResult.item.isEventItem && nRegularItems >= calcMaxItems(user)) {
          return errorResponse("Inventory is full");
        }
        if (userItemResult.item.isEventItem && nEventItems >= calcMaxEventItems(user)) {
          return errorResponse("Event item inventory is full");
        }
        if (
          userItemResult.item.itemType === "MATERIAL" &&
          nMaterials >= calcMaxMaterials(user)
        ) {
          return errorResponse("Materials inventory is full");
        }
        await ctx.drizzle
          .update(userItem)
          .set({ storedAtHome: false })
          .where(eq(userItem.id, input.userItemId));
        return { success: true, message: "Item retrieved from your home." };
      } else {
        // Check storage limits based on item type
        if (userItemResult.item.itemType === "MATERIAL") {
          // For materials, check materials storage limit
          const storedMaterials =
            storedItems.filter((ui) => ui.item.itemType === "MATERIAL").length || 0;
          if (
            storedMaterials >=
            calcMaxHouseMaterials(user, HomeTypeDetails[user.homeType].storage)
          ) {
            return errorResponse("Your home materials storage is full");
          }
        } else {
          // For normal items, check normal item storage limit
          const storedNormalItems =
            storedItems.filter((ui) => ui.item.itemType !== "MATERIAL").length || 0;
          if (storedNormalItems >= HomeTypeDetails[user.homeType].storage) {
            return errorResponse("Your home storage is full");
          }
        }
        await ctx.drizzle
          .update(userItem)
          .set({ storedAtHome: true })
          .where(eq(userItem.id, input.userItemId));
        return { success: true, message: "Item stored in your home." };
      }
    }),
});
