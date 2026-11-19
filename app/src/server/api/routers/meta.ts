import { z } from "zod";
import { selectMetaConversions } from "@/queries/metaTracking";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import {
  isMetaCapiConfigured,
  saveMetaTracking,
  withdrawMetaTracking,
} from "@/server/utils/metaTracking";
import { metaConsentSchema, metaTrackingSchema } from "@/validators/metaTracking";

export const metaRouter = createTRPCRouter({
  synchronizeConsent: publicProcedure
    .input(
      z.union([
        metaTrackingSchema,
        metaConsentSchema.extend({ granted: z.literal(false) }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      const decidedAt = new Date(input.decidedAt);
      if (
        decidedAt.getTime() > Date.now() ||
        decidedAt.getTime() < Date.now() - 180 * 86_400_000
      )
        return [];
      // Withdrawal remains available even when the delivery switch is disabled.
      if (!input.granted) {
        await withdrawMetaTracking(
          ctx.drizzle,
          { consentId: input.consentId, decidedAt },
          ctx.userId ?? undefined,
        );
        return [];
      }
      if (!ctx.userId || !isMetaCapiConfigured()) return [];
      if (!(await saveMetaTracking(ctx.drizzle, ctx.userId, input, ctx.userAgent)))
        return [];
      const [registrations, tutorials] = await Promise.all([
        selectMetaConversions(ctx.drizzle, "register", {
          userId: ctx.userId,
          limit: 1,
        }),
        selectMetaConversions(ctx.drizzle, "tutorial_complete", {
          userId: ctx.userId,
          limit: 1,
        }),
      ]);
      return [
        ...registrations.map((row) => ({
          event: "register" as const,
          eventId: row.eventId,
        })),
        ...tutorials.map((row) => ({
          event: "tutorial_complete" as const,
          eventId: row.eventId,
        })),
      ];
    }),
});
