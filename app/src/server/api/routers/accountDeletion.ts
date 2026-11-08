import { auth, reverificationError } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { after } from "next/server";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import {
  findAccountDeletionForRequest,
  insertAccountDeletionForRequest,
} from "@/queries/accountDeletion";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import { prepareAppleDeletion } from "@/server/utils/accountDeletion/apple";
import { processAccountDeletions } from "@/server/utils/accountDeletion/process";
import {
  ACCOUNT_DELETION_REVERIFICATION,
  accountDeletionSchema,
} from "@/validators/accountDeletion";

export const accountDeletionRouter = createTRPCRouter({
  request: protectedProcedure
    .input(accountDeletionSchema)
    .mutation(async ({ ctx, input }) => {
      // The shell marker selects the supported UI; authentication still comes from Clerk.
      if (!isNativeUserAgent(ctx.userAgent)) {
        return errorResponse("Use the native app to request account deletion.");
      }
      const session = await auth();
      if (!session.userId || session.userId !== ctx.userId) {
        return errorResponse("Your session changed. Sign in again to continue.");
      }
      if (input.expectedUserId !== ctx.userId) {
        return errorResponse(
          "Your signed-in account changed. Close this dialog and start again.",
        );
      }
      // Clerk's hook recognizes this hint after tRPC deserializes it, verifies the
      // session and retries this mutation. No deletion is queued before verification.
      if (!session.has({ reverification: ACCOUNT_DELETION_REVERIFICATION })) {
        return reverificationError(ACCOUNT_DELETION_REVERIFICATION);
      }
      if (
        !process.env.CRON_SECRET ||
        process.env.NATIVE_ACCOUNT_DELETION_ENABLED !== "true"
      ) {
        return errorResponse(
          "Account deletion is temporarily unavailable. Please try again later.",
        );
      }
      try {
        const existing = await findAccountDeletionForRequest(ctx.drizzle, ctx);
        if (existing) {
          after(() => processAccountDeletions(ctx.userId));
          return { success: true, message: "Your deletion request is already saved." };
        }
        const apple = await prepareAppleDeletion(
          ctx.userId,
          input.appleAuthorizationCode,
        );
        if (apple.error) return errorResponse(apple.error);
        // Duplicate clicks and lost responses cannot reset a partially processed request.
        await insertAccountDeletionForRequest(ctx.drizzle, ctx, apple);
        // Next keeps this work alive after the response, even if the app closes.
        // Only this account is eligible; the cleaner recovers interrupted attempts.
        after(() => processAccountDeletions(ctx.userId));
        return {
          success: true,
          message:
            "Your permanent account deletion request has been accepted. You will be signed out. Cleanup runs in the background.",
        };
      } catch (error) {
        // The player sees a retryable message; the cause goes to Sentry.
        Sentry.captureException(error, { tags: { task: "account-deletion-request" } });
        return errorResponse(
          "We could not save your request. Nothing has been confirmed; please try again.",
        );
      }
    }),
});
