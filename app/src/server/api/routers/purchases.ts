import { z } from "zod";
import {
  STORE_FEDERAL_PRODUCTS,
  STORE_PLATFORMS,
  STORE_REP_PRODUCTS,
} from "@/drizzle/constants";
import { env } from "@/env/server.mjs";
import { selectStorePurchaseForRecent } from "@/queries/purchases";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { getPurchaseUserUpdate } from "@/server/utils/purchases/cache";

export const purchasesRouter = createTRPCRouter({
  /** Webhooks grant value outside a request; receipts never stand in for current balances. */
  userSnapshot: protectedProcedure.query(async ({ ctx }) => {
    const update = await getPurchaseUserUpdate(ctx.drizzle, ctx.userId);
    return {
      userId: ctx.userId,
      userPatch: update.userPatch ?? null,
      achievementProgress: update.achievementProgress,
    };
  }),
  /**
   * What the app is allowed to sell, and what each product is worth here. Prices come
   * from the store SDK on the device — they are localised and can change without a
   * release, so quoting our own would eventually be wrong.
   */
  catalogue: protectedProcedure
    .output(
      z.object({
        isConfigured: z.boolean(),
        reputation: z.array(
          z.object({
            productId: z.string(),
            usd: z.number(),
            reputationPoints: z.number(),
          }),
        ),
        federal: z.array(
          z.object({
            productId: z.string(),
            androidProductId: z.string(),
            federalStatus: z.string(),
          }),
        ),
      }),
    )
    .query(() => ({
      // Without the webhook secret a purchase would complete on the device and never be
      // credited, so the store is hidden rather than taking money for nothing.
      isConfigured: Boolean(env.REVENUECAT_WEBHOOK_SECRET),
      reputation: STORE_REP_PRODUCTS.map((product) => ({ ...product })),
      federal: STORE_FEDERAL_PRODUCTS.map((product) => ({ ...product })),
    })),

  /** Recent store purchases, so the player can see a grant land. */
  recent: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
        transactionId: z.string().optional(),
        productId: z.string().optional(),
        createdAfter: z.date().optional(),
      }),
    )
    .output(
      z.array(
        z.object({
          id: z.string(),
          transactionId: z.string(),
          productId: z.string(),
          store: z.enum(STORE_PLATFORMS),
          reputationPoints: z.number(),
          federalStatus: z.string().nullable(),
          acceptedAt: z.date().nullable(),
          grantedAt: z.date().nullable(),
          revokedAt: z.date().nullable(),
          expiresAt: z.date().nullable(),
          createdAt: z.date(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const rows = await selectStorePurchaseForRecent(ctx.drizzle, ctx, input);
      return rows;
    }),
});
