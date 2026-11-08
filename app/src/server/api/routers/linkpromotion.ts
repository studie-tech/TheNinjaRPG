import { z } from "zod";
import {
  findLinkPromotionForReviewLinkPromotion,
  findLinkPromotionForSubmitLinkPromotion,
  insertLinkPromotionForSubmitLinkPromotion,
  listLinkPromotionForGetLinkPromotions,
  updateLinkPromotionForReviewLinkPromotion,
  updateUserDataForReviewLinkPromotion,
} from "@/queries/linkpromotion";
import { fetchUser } from "@/queries/profile";

import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import { offsetPage } from "@/server/utils/pagination";
import { canReviewLinkPromotions } from "@/utils/permissions";
import {
  linkPromotionReviewSchema,
  linkPromotionSchema,
} from "@/validators/linkPromotion";

export const linkPromotionRouter = createTRPCRouter({
  getLinkPromotions: protectedProcedure
    .input(
      z.object({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query 1
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Query 2
      const { skip, cursorAfter } = offsetPage(input);
      const results = await listLinkPromotionForGetLinkPromotions(
        ctx.drizzle,
        user,
        { userId: ctx.userId, limit: input.limit },
        skip,
      );
      const nextCursor = cursorAfter(results);
      return { data: results, nextCursor };
    }),

  submitLinkPromotion: protectedProcedure
    .input(linkPromotionSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const result = await findLinkPromotionForSubmitLinkPromotion(ctx.drizzle, input);
      // Guard
      if (result) return errorResponse("URL already submitted");
      // A trailing DNS root dot still names the same own-site host.
      const hostname = new URL(input.url).hostname.replace(/\.$/, "");
      if (hostname === "theninja-rpg.com" || hostname.endsWith(".theninja-rpg.com")) {
        return errorResponse("Cannot submit link to TNR");
      }
      // Mutate
      await insertLinkPromotionForSubmitLinkPromotion(ctx.drizzle, ctx, input);
      return { success: true, message: "Summitted link" };
    }),

  reviewLinkPromotion: protectedProcedure
    .input(linkPromotionReviewSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, promotion] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findLinkPromotionForReviewLinkPromotion(ctx.drizzle, input),
      ]);
      // Guard
      if (!promotion) return errorResponse("Could not find link");
      if (promotion.reviewed) return errorResponse("Already reviewed");
      if (!canReviewLinkPromotions(user.role)) {
        return errorResponse("Cannot review promotion links");
      }
      // Mutate: claim the review first so the reward is granted once
      const review = await updateLinkPromotionForReviewLinkPromotion(
        ctx.drizzle,
        input,
        ctx,
      );
      if (review.rowsAffected !== 1) return errorResponse("Already reviewed");
      if (input.points > 0) {
        await updateUserDataForReviewLinkPromotion(ctx.drizzle, input, promotion);
      }
      return { success: true, message: `Reward for ${promotion.url}` };
    }),
});
