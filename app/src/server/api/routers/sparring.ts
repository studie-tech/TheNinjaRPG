import { and, eq, gt, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { UserRequestState, UserRequestType } from "@/drizzle/constants";
import { RANKED_PVP_STATS } from "@/drizzle/constants";
import type { RankedLoadout } from "@/drizzle/schema";
import { rankedLoadout, userRequest } from "@/drizzle/schema";
import { SPAR_EXPIRY_SECONDS } from "@/libs/combat/constants";
import { getServerPusher } from "@/libs/pusher";
import { initiateBattle } from "@/routers/combat";
import { fetchUser } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { secondsFromNow } from "@/utils/time";

const pusher = getServerPusher();

export const sparringRouter = createTRPCRouter({
  getUserChallenges: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get pending sparring challenges" } })
    .query(async ({ ctx }) => {
      return fetchRequests(ctx.drizzle, ["SPAR"], SPAR_EXPIRY_SECONDS * 2, ctx.userId);
    }),
  createChallenge: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Challenge another user to spar" } })
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
        route: "/battlearena#Sparring",
        routeText: "To Arena",
      });
      return { success: true, message: "Challenge created" };
    }),
  acceptChallenge: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Accept a sparring challenge" } })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [challenge, user] = await Promise.all([
        fetchRequest(ctx.drizzle, input.id, "SPAR"),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
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
          ctx.drizzle.query.rankedLoadout.findFirst({
            where: eq(rankedLoadout.userId, challenge.senderId),
          }),
          ctx.drizzle.query.rankedLoadout.findFirst({
            where: eq(rankedLoadout.userId, challenge.receiverId),
          }),
        ]);

        if (!senderLoadout || !receiverLoadout) {
          return errorResponse(
            "Both players must have ranked loadouts for ranked sparring",
          );
        }

        // Check that both loadouts have at least some items/jutsus equipped
        const senderHasLoadout =
          senderLoadout.loadout.jutsuIds.length > 0 ||
          senderLoadout.loadout.weaponIds.length > 0 ||
          senderLoadout.loadout.consumableIds.length > 0;
        const receiverHasLoadout =
          receiverLoadout.loadout.jutsuIds.length > 0 ||
          receiverLoadout.loadout.weaponIds.length > 0 ||
          receiverLoadout.loadout.consumableIds.length > 0;

        if (!senderHasLoadout || !receiverHasLoadout) {
          return errorResponse(
            "Both players must have equipped items in their ranked loadouts for ranked rules sparring",
          );
        }

        forceLoadouts = [senderLoadout, receiverLoadout];
      }

      // Mutate
      const result = await initiateBattle(
        {
          sector: user.sector,
          userIds: [challenge.receiverId],
          targetIds: [challenge.senderId],
          client: ctx.drizzle,
          biome: "arena",
          targetStatDistribution: useRankedRules ? RANKED_PVP_STATS : undefined,
          userStatDistribution: useRankedRules ? RANKED_PVP_STATS : undefined,
          forceLoadouts,
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
    .meta({ mcp: { enabled: true, description: "Reject a sparring challenge" } })
    .input(z.object({ id: z.string() }))
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
    .meta({ mcp: { enabled: true, description: "Cancel your sparring challenge" } })
    .input(z.object({ id: z.string() }))
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
 * Fetches user requests based on the specified criteria.
 * @param client - The DrizzleClient instance used for querying the database.
 * @param types - An array of user request types to fetch.
 * @param [secondsBack] - Optional. The number of seconds in the past to consider when fetching requests.
 * @param [id] - Optional. The ID of the user to filter requests by.
 * @returns - A Promise that resolves to an array of user requests matching the specified criteria.
 */
export const fetchRequests = async (
  client: DrizzleClient,
  types: UserRequestType[],
  secondsBack?: number,
  id?: string,
) => {
  return await client.query.userRequest.findMany({
    where: and(
      ...(id ? [or(eq(userRequest.senderId, id), eq(userRequest.receiverId, id))] : []),
      ...(secondsBack ? [gt(userRequest.createdAt, secondsFromNow(-secondsBack))] : []),
      inArray(userRequest.type, types),
    ),
    with: {
      sender: {
        columns: { username: true, level: true, rank: true },
        with: { village: { columns: { name: true } } },
      },
      receiver: {
        columns: { username: true, level: true, rank: true },
        with: { village: { columns: { name: true } } },
      },
    },
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });
};

/**
 * Fetches a user request from the database based on the request ID and type.
 * @param client - The Drizzle client used to query the database.
 * @param id - The ID of the request to fetch.
 * @param type - The type of the request to fetch.
 * @returns - A promise that resolves to the fetched user request.
 * @throws {ServerError} - If the request is not found in the database.
 */
export const fetchRequest = async (
  client: DrizzleClient,
  id: string,
  type: UserRequestType,
) => {
  const result = await client.query.userRequest.findFirst({
    where: and(eq(userRequest.id, id), eq(userRequest.type, type)),
  });
  if (!result) throw serverError("NOT_FOUND", "Request not found");
  return result;
};

/**
 * Updates the state of a user request in the database.
 *
 * @param client - The DrizzleClient instance used to interact with the database.
 * @param challengeId - The ID of the challenge.
 * @param status - The new state of the user request.
 * @param type - The type of the user request.
 * @returns An object indicating the success of the update operation.
 */
export const updateRequestState = async (
  client: DrizzleClient,
  challengeId: string,
  status: UserRequestState,
  type: UserRequestType,
  relatedId?: string,
) => {
  await client
    .update(userRequest)
    .set({
      status,
      ...(relatedId && { relatedId }),
    })
    .where(and(eq(userRequest.id, challengeId), eq(userRequest.type, type)));
  return { success: true, message: "Challenge state updated" };
};

/**
 * Inserts a new request into the database.
 *
 * @param client - The DrizzleClient instance used to interact with the database.
 * @param senderId - The ID of the sender.
 * @param receiverId - The ID of the receiver.
 * @param senderVillageId - The ID of the sender's village.
 * @param receiverVillageId - The ID of the receiver's village.
 * @param type - The type of the user request.
 * @returns A Promise that resolves when the request is successfully inserted.
 */
export const insertRequest = async (
  client: DrizzleClient,
  senderId: string,
  receiverId: string,
  type: UserRequestType,
  value?: number,
  relatedId?: string,
  useRankedRules?: boolean,
  spectatable?: boolean,
) => {
  await client.insert(userRequest).values({
    id: nanoid(),
    senderId,
    receiverId,
    status: "PENDING",
    type,
    value: value || null,
    relatedId: relatedId || null,
    useRankedRules: useRankedRules || false,
    spectatable: spectatable || false,
  });
};
