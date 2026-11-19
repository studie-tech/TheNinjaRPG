import { z } from "zod";
import { outdateProposalsFor } from "@/libs/contentReview/outdate";
import { DEFAULT_SPLASH, isSplashActive, SPLASH_ID } from "@/libs/splash";
import { fetchUser } from "@/queries/profile";
import { findSplash, logSplashUpdate, saveSplash } from "@/queries/splash";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import { canChangeContent } from "@/utils/permissions";
import { splashSchema } from "@/validators/splash";

export const splashRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const content = (await findSplash(ctx.drizzle))?.content ?? DEFAULT_SPLASH;
    const now = new Date();
    return {
      content: isSplashActive(content, now) ? content : null,
      nextChangeAt: content.enabled
        ? ([content.startsAt, content.endsAt]
            .filter((date): date is string => !!date && new Date(date) > now)
            .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null)
        : null,
      fetchedAt: now,
    };
  }),
  getForEdit: protectedProcedure.query(async ({ ctx }) => {
    const [user, row] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      findSplash(ctx.drizzle),
    ]);
    if (!canChangeContent(user.role))
      throw serverError("FORBIDDEN", "Only content staff can edit the welcome board");
    return row?.content ?? DEFAULT_SPLASH;
  }),
  update: protectedProcedure
    .input(z.object({ id: z.literal(SPLASH_ID), data: splashSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, row] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findSplash(ctx.drizzle),
      ]);
      if (user.isBanned || !canChangeContent(user.role))
        return errorResponse("Only content staff can edit the welcome board");
      await saveSplash(ctx.drizzle, input.data);
      await Promise.all([
        logSplashUpdate(
          ctx.drizzle,
          ctx.userId,
          row?.content ?? DEFAULT_SPLASH,
          input.data,
        ),
        outdateProposalsFor(ctx.drizzle, "SPLASH", [SPLASH_ID], "Welcome board edited"),
      ]);
      return { success: true, message: "Welcome board saved" };
    }),
});
