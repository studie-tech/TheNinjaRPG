import { z } from "zod";
import type { UserRequestState, UserRequestType } from "@/drizzle/constants";
import { RANKED_PVP_STATS } from "@/drizzle/constants";
import type { RankedLoadout, UserRequest } from "@/drizzle/schema";
import { SPAR_EXPIRY_SECONDS } from "@/libs/combat/constants";
import { getServerPusher } from "@/libs/pusher";
import { fetchActionUser } from "@/queries/actionReadiness";
import { fetchJutsuEquipLimits } from "@/queries/jutsuEquipLimit";
import { fetchAllGameSettings, fetchUser } from "@/queries/profile";
import { findRankedLoadoutByUserId } from "@/queries/pvprank";
import {
  fetchRequests,
  findUserRequestForFetchRequest,
  insertRequest,
  updateUserRequestForUpdateRequestState,
} from "@/queries/sparring";
import { initiateBattle } from "@/routers/combat";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { cleanRankedProhibitedSelections } from "@/server/utils/ranked";
import { idSchema } from "@/validators/misc";
import { userDeltaResponseSchema } from "@/validators/userCache";

const pusher = getServerPusher();

export const sparringRouter = createTRPCRouter({
  getUserChallenges: protectedProcedure
    .meta({ mcp: { description: "Get pending sparring challenges" } })
    .query(async ({ ctx }) => {
      return fetchRequests(ctx.drizzle, ["SPAR"], SPAR_EXPIRY_SECONDS * 2, ctx.userId);
    }),
  createChallenge: protectedProcedure
    .meta({ mcp: { description: "Challenge another user to spar" } })
    .input(
      z.object({
        targetId: z.string(),
        useRankedRules: z.boolean().optional().prefault(false),
        spectatable: z.boolean().optional().prefault(false),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, target, recent] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.targetId),
        fetchRequests(ctx.drizzle, ["SPAR"], 10, ctx.userId),
      ]);
      // Guard
      if (recent.length > 0) {
        return errorResponse("Max 1 challenge per 10 seconds");
      }
      // Mutate
      await insertRequest(
        ctx.drizzle,
        user.userId,
        target.userId,
        "SPAR",
        undefined,
        undefined,
        input.useRankedRules,
        input.spectatable,
      );
      void pusher.trigger(input.targetId, "event", {
        type: "userMessage",
        message: "You have been challenged",
        duration: 15_000,
        route: "/battlearena#Sparring",
        routeText: "To Arena",
      });
      return { success: true, message: "Challenge created" };
    }),
  acceptChallenge: protectedProcedure
    .meta({ mcp: { description: "Accept a sparring challenge" } })
    .input(idSchema.extend({ originSocketId: z.string().max(128).optional() }))
    .output(userDeltaResponseSchema.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch
      let [challenge, user, jutsuEquipLimits, settings] = await Promise.all([
        fetchRequest(ctx.drizzle, input.id, "SPAR"),
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchJutsuEquipLimits(ctx.drizzle),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      const readiness = prepareActionReadiness(user, settings);
      if (readiness.error) return errorResponse(readiness.error);
      user = readiness.user;
      // Guards
      if (challenge.receiverId !== ctx.userId) {
        return errorResponse("Not your challenge to accept");
      }
      if (challenge.status !== "PENDING") {
        return errorResponse("Challenge not pending");
      }

      // Determine battle type and setup based on challenge settings
      const useRankedRules = challenge.useRankedRules || false;
      const battleType = useRankedRules ? "RANKED_SPARRING" : "SPARRING";

      // Get ranked loadouts if using ranked rules
      let forceLoadouts: RankedLoadout[] | undefined;
      if (useRankedRules) {
        const [senderLoadout, receiverLoadout] = await Promise.all([
          findRankedLoadoutByUserId(ctx.drizzle, challenge.senderId),
          findRankedLoadoutByUserId(ctx.drizzle, challenge.receiverId),
        ]);

        if (!senderLoadout || !receiverLoadout) {
          return errorResponse(
            "Both players must have ranked loadouts for ranked sparring",
          );
        }

        // Check that both loadouts have at least some items/jutsus equipped
        const hasEffectiveLoadout = (entry: RankedLoadout) =>
          entry.loadout.jutsuIds.length > 0 ||
          entry.loadout.weaponIds.length > 0 ||
          entry.loadout.consumableIds.length > 0;
        if (
          !hasEffectiveLoadout(senderLoadout) ||
          !hasEffectiveLoadout(receiverLoadout)
        ) {
          return errorResponse(
            "Both players must have equipped items in their ranked loadouts for ranked rules sparring",
          );
        }

        const [cleanedSender, cleanedReceiver] = await Promise.all([
          cleanRankedProhibitedSelections(ctx.drizzle, senderLoadout, jutsuEquipLimits),
          cleanRankedProhibitedSelections(
            ctx.drizzle,
            receiverLoadout,
            jutsuEquipLimits,
          ),
        ]);
        if (
          !hasEffectiveLoadout(cleanedSender.loadout) ||
          !hasEffectiveLoadout(cleanedReceiver.loadout)
        ) {
          return errorResponse(
            "A ranked loadout became empty because ranked rules do not allow those selections",
          );
        }
        forceLoadouts = [cleanedSender.loadout, cleanedReceiver.loadout];
      }

      // Mutate
      const result = await initiateBattle(
        {
          sector: user.sector,
          userIds: [challenge.receiverId],
          targetIds: [challenge.senderId],
          client: ctx.drizzle,
          actionUserId: ctx.userId,
          originSocketId: input.originSocketId,
          biome: "arena",
          targetStatDistribution: useRankedRules ? RANKED_PVP_STATS : undefined,
          userStatDistribution: useRankedRules ? RANKED_PVP_STATS : undefined,
          forceLoadouts,
          jutsuEquipLimits,
        },
        battleType,
      );
      if (result.success) {
        await Promise.all([
          updateRequestState(
            ctx.drizzle,
            input.id,
            "ACCEPTED",
            "SPAR",
            result.battleId,
          ),
          pusher.trigger(challenge.senderId, "event", {
            type: "userMessage",
            message: "Your challenge has been accepted",
            route: "/combat",
            routeText: "To Combat",
          }),
        ]);
      }
      return result;
    }),
  rejectChallenge: protectedProcedure
    .meta({ mcp: { description: "Reject a sparring challenge" } })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const challenge = await fetchRequest(ctx.drizzle, input.id, "SPAR");
      if (challenge.receiverId !== ctx.userId) {
        return errorResponse("You can only reject challenge for yourself");
      }
      if (challenge.status !== "PENDING") {
        return errorResponse("Can only reject pending challenges");
      }
      void pusher.trigger(challenge.senderId, "event", {
        type: "userMessage",
        message: "Your challenge has been rejected",
        route: "/battlearena",
        routeText: "To Arena",
      });
      return await updateRequestState(ctx.drizzle, input.id, "REJECTED", "SPAR");
    }),
  cancelChallenge: protectedProcedure
    .meta({ mcp: { description: "Cancel your sparring challenge" } })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const challenge = await fetchRequest(ctx.drizzle, input.id, "SPAR");
      if (challenge.senderId !== ctx.userId) {
        return errorResponse("You can only cancel challenges created by you");
      }
      if (challenge.status !== "PENDING") {
        return errorResponse("Can only cancel pending challenges");
      }
      return await updateRequestState(ctx.drizzle, input.id, "CANCELLED", "SPAR");
    }),
});

/**
 * Fetches a user request from the database based on the request ID and type.
 * @param client - The Drizzle client used to query the database.
 * @param id - The ID of the request to fetch.
 * @param type - The type of the request to fetch.
 * @param options - Allow an absent request when expiry or revocation is an expected outcome.
 * @returns - A promise that resolves to the fetched user request.
 * @throws {ServerError} - If the request is not found and allowMissing is not set.
 */
export function fetchRequest(
  client: DrizzleClient,
  id: string,
  type: UserRequestType,
): Promise<UserRequest>;
export function fetchRequest(
  client: DrizzleClient,
  id: string,
  type: UserRequestType,
  options: { allowMissing: true },
): Promise<UserRequest | undefined>;
export async function fetchRequest(
  client: DrizzleClient,
  id: string,
  type: UserRequestType,
  options?: { allowMissing: true },
) {
  const result = await findUserRequestForFetchRequest(client, id, type);
  if (!result && !options?.allowMissing)
    throw serverError("NOT_FOUND", "Request not found");
  return result;
}

/**
 * Updates the state of a user request in the database.
 *
 * @param client - The DrizzleClient instance used to interact with the database.
 * @param challengeId - The ID of the challenge.
 * @param status - The new state of the user request.
 * @param type - The type of the user request.
 * @param relatedId - Optional related entity ID to store on the request.
 * @param expectedStatus - Optional CAS guard for revocable requests whose status must not be overwritten.
 * @returns An object indicating the success of the update operation.
 */
export const updateRequestState = async (
  client: DrizzleClient,
  challengeId: string,
  status: UserRequestState,
  type: UserRequestType,
  relatedId?: string,
  expectedStatus?: UserRequestState,
) => {
  const result = await updateUserRequestForUpdateRequestState(
    client,
    status,
    relatedId,
    challengeId,
    type,
    expectedStatus,
  );
  if (expectedStatus && !result.rowsAffected)
    return errorResponse("Request changed. Refresh and try again");
  return { success: true, message: "Challenge state updated" };
};
