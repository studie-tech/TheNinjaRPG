import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { IMG_ORIENTATIONS } from "@/drizzle/constants";
import { historicalAvatar } from "@/drizzle/schema";
import { img2model, txt2imgNanoBanana } from "@/libs/replicate";
import { fetchUser } from "@/routers/profile";
import { canChangeContent } from "@/utils/permissions";
import {
  baseServerResponse,
  createTRPCRouter,
  protectedProcedure,
  serverError,
} from "../trpc";

export const generativeAiRouter = createTRPCRouter({
  create3dModel: protectedProcedure
    .input(
      z.object({
        imgUrl: z.url("imgUrl must be a valid http/https URL"),
        field: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) {
        throw serverError("UNAUTHORIZED", "You are not allowed to change content");
      }
      const result = await img2model(input.imgUrl);
      return { replicateId: result.id };
    }),
  createImg: protectedProcedure
    .input(
      z.object({
        preprompt: z.string(),
        prompt: z.string(),
        previousImg: z.string().optional(),
        removeBg: z.boolean(),
        relationId: z.string(),
        size: z.enum(IMG_ORIENTATIONS),
        maxDim: z.number(),
      }),
    )
    .output(baseServerResponse.extend({ url: z.url().optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, historicalToday] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.historicalAvatar.findMany({
          where: and(
            eq(historicalAvatar.status, "content-success"),
            eq(historicalAvatar.done, true),
            gte(historicalAvatar.createdAt, sql`NOW() - INTERVAL 1 DAY`),
          ),
        }),
      ]);
      // Guard
      if (!canChangeContent(user.role)) {
        throw serverError("UNAUTHORIZED", "You are not allowed to change content");
      }
      if (historicalToday.length > 100) {
        throw serverError(
          "TOO_MANY_REQUESTS",
          "Maximum of 100 creations per day reached",
        );
      }
      // Create image. nano-banana collapses every upstream Gemini failure (safety
      // refusal, text-instead-of-image, transient model error) into one opaque
      // "Prediction failed", and the full context is already logged server-side in
      // txt2imgNanoBanana. Surface it as a normal failed-mutation toast instead of an
      // unhandled 500; anything else (bad token, Replicate outage) still throws.
      let resultUrls: string[] = [];
      try {
        resultUrls = await txt2imgNanoBanana({
          preprompt: input.preprompt,
          prompt: input.prompt,
          previousImg: input.previousImg,
          removeBg: input.removeBg,
          userId: ctx.userId,
          width: input.maxDim,
          height: input.maxDim,
          size: input.size,
        });
      } catch (cause) {
        if (cause instanceof Error && cause.message.includes("Prediction failed")) {
          return {
            success: false,
            message: "Image generation failed - try rephrasing the prompt and retry",
            url: null,
          };
        }
        throw cause;
      }
      // Store for future reference
      if (resultUrls && resultUrls.length > 0) {
        await ctx.drizzle.insert(historicalAvatar).values(
          resultUrls.map((url) => ({
            avatar: url,
            userId: input.relationId,
            status: "content-success",
            done: true,
          })),
        );
      }
      return { success: true, message: "Image generated", url: resultUrls?.[0] };
    }),
});
