import { clerkClient } from "@clerk/nextjs/server";
import {
  createTRPCRouter,
  errorResponse,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import { nativeAuthStore } from "@/server/utils/nativeAuth";
import {
  nativeAuthExchangeSchema,
  nativeAuthFlowSchema,
  nativeAuthStartSchema,
} from "@/validators/nativeAuth";

export const nativeAuthRouter = createTRPCRouter({
  start: publicProcedure.input(nativeAuthStartSchema).mutation(async ({ input }) => ({
    flowId: await nativeAuthStore().start(input.provider, input.challenge),
  })),
  describe: publicProcedure.input(nativeAuthFlowSchema).query(async ({ input }) => {
    const flow = await nativeAuthStore().describe(input.flowId);
    if (!flow) throw serverError("BAD_REQUEST", EXPIRED_MESSAGE);
    return flow;
  }),
  // Use the rate-limited procedure here as well: issuing app sessions is not a game action.
  approve: publicProcedure
    .input(nativeAuthFlowSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.userId) throw serverError("UNAUTHORIZED", "Sign in first.");
      const code = await nativeAuthStore().approve(input.flowId, ctx.userId);
      if (!code) return errorResponse(EXPIRED_MESSAGE);
      return {
        success: true as const,
        message: "Sign-in approved",
        callbackUrl: `tnr://oauth-callback?flow=${input.flowId}&code=${code}`,
      };
    }),
  exchange: publicProcedure
    .input(nativeAuthExchangeSchema)
    .mutation(async ({ input }) => {
      const userId = await nativeAuthStore().redeem(
        input.flowId,
        input.verifier,
        input.code,
      );
      if (!userId) return errorResponse(EXPIRED_MESSAGE);
      // No ticket crosses the browser/deep-link boundary. Only the initiating shell can
      // redeem the proof, and Clerk's short-lived ticket can be consumed only once.
      const clerk = await clerkClient();
      const token = await clerk.signInTokens.createSignInToken({
        userId,
        expiresInSeconds: 60,
      });
      return { success: true as const, message: "Sign-in ready", ticket: token.token };
    }),
});

const EXPIRED_MESSAGE =
  "Sign-in expired or was already used. Return to the app and try again.";
