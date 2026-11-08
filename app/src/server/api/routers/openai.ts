import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { txt2imgGPT, txt2imgNanoBanana } from "@/libs/replicate";
import {
  countHistoricalAvatarForCreateImg,
  insertHistoricalAvatarForCreateImg,
} from "@/queries/avatar";
import { fetchUser } from "@/queries/profile";

import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import { canChangeContent } from "@/utils/permissions";
import { contentImageInputSchema } from "@/validators/ai";

export const generativeAiRouter = createTRPCRouter({
  createImg: protectedProcedure
    .input(contentImageInputSchema)
    .output(baseServerResponse.extend({ url: z.url().optional().nullable() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, createdToday] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        countHistoricalAvatarForCreateImg(ctx.drizzle),
      ]);
      // Guard
      if (!canChangeContent(user.role)) {
        return { ...errorResponse("You are not allowed to change content"), url: null };
      }
      if (createdToday > 100) {
        return {
          ...errorResponse("Maximum of 100 creations per day reached"),
          url: null,
        };
      }
      // Create image. nano-banana collapses every upstream Gemini failure (safety
      // refusal, text-instead-of-image, transient model error) into one opaque
      // "Prediction failed", and the full context is already logged server-side in
      // txt2imgNanoBanana. Surface it as a normal failed-mutation toast instead of an
      // unhandled 500; anything else (bad token, Replicate outage) still throws.
      let resultUrls: string[] = [];
      try {
        // Directional furniture edits can opt into OpenAI for camera and object fidelity.
        const generate = input.provider === "OPENAI" ? txt2imgGPT : txt2imgNanoBanana;
        resultUrls = await generate({
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
        const isGenerationFailure =
          cause instanceof Error &&
          (cause.message.includes("Prediction failed") ||
            cause.message.includes("Failed to generate image"));
        if (isGenerationFailure) {
          // "Prediction failed" is raised by the Replicate client for ANY model, so this
          // also catches background-removal and upload failures that nothing else logs.
          Sentry.captureException(cause, {
            level: "warning",
            tags: { source: "generativeAi.createImg" },
          });
          return {
            success: false,
            message: "Image generation failed - try rephrasing the prompt and retry",
            url: null,
          };
        }
        throw cause;
      }
      // Store for future reference
      if (resultUrls.length > 0) {
        await insertHistoricalAvatarForCreateImg(ctx.drizzle, resultUrls, input);
      }
      return { success: true, message: "Image generated", url: resultUrls[0] };
    }),
});
