import { nanoid } from "nanoid";
import { z } from "zod";
import { ItemSlots } from "@/drizzle/constants";
import { fittingSlots } from "@/libs/itemsPage";
import {
  claimCosmetic,
  clearCosmeticSlot,
  cosmeticSourceGuard,
  findCosmeticSource,
  listCosmeticSlots,
  listCosmetics,
  listCosmeticUnlocks,
  saveCosmeticSlot,
} from "@/queries/cosmetic";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import { consumeUserItemAtomically } from "@/server/utils/concurrency";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";

export const cosmeticRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const [owned, slots, unlocks] = await Promise.all([
      listCosmetics(ctx.drizzle, ctx.userId),
      listCosmeticSlots(ctx.drizzle, ctx.userId),
      listCosmeticUnlocks(ctx.drizzle, ctx.userId),
    ]);
    return { owned, slots, unlocks };
  }),
  make: protectedProcedure
    .input(z.object({ userItemId: z.string(), expectedQuantity: z.int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const source = await findCosmeticSource(
        ctx.drizzle,
        ctx.userId,
        input.userItemId,
      );
      if (!source || !fittingSlots(source.item).length)
        return errorResponse("Choose equipment to make cosmetic.");
      if (source.imbuements.length)
        return errorResponse("Remove imbuements before making this item cosmetic.");
      const rejected = new Error("COSMETIC_SOURCE_CHANGED");
      try {
        // Ownership requires an INSERT and consumption can DELETE the last copy.
        // MySQL cannot commit both through one guarded UPDATE.
        await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            const claim = await claimCosmetic(tx, ctx.userId, source.itemId, nanoid());
            if (claim.rowsAffected !== 1) throw rejected;
            const consumed = await consumeUserItemAtomically({
              client: tx,
              userId: ctx.userId,
              userItemId: source.id,
              expectedQuantity: input.expectedQuantity,
              where: [cosmeticSourceGuard(ctx.userId, source.itemId)],
            });
            if (!consumed) throw rejected;
          }),
        );
      } catch (error) {
        if (error === rejected)
          return errorResponse(
            "Already unlocked or item unavailable. Refresh your inventory and try again.",
          );
        throw error;
      }
      return {
        success: true,
        message: "Cosmetic unlocked",
        userItemId: source.id,
        quantity: input.expectedQuantity - 1,
      };
    }),
  select: protectedProcedure
    .input(
      z.object({
        slot: z.enum(ItemSlots).exclude(["NONE"]),
        itemId: z.string().nullable(),
        variantId: z.string().nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.itemId) {
        await clearCosmeticSlot(ctx.drizzle, ctx.userId, input.slot);
        return { success: true, message: "Cosmetic removed" };
      }
      const result = await saveCosmeticSlot(
        ctx.drizzle,
        ctx.userId,
        input.slot,
        input.itemId,
        input.variantId,
      );
      if (!result.rowsAffected) {
        const slots = await listCosmeticSlots(ctx.drizzle, ctx.userId);
        if (
          !slots.some(
            (entry) =>
              entry.slot === input.slot &&
              entry.itemId === input.itemId &&
              entry.variantId === input.variantId,
          )
        )
          return errorResponse(
            "Cosmetic unavailable. Finish any battle and refresh your wardrobe.",
          );
      }
      return { success: true, message: "Cosmetic selected" };
    }),
});
