import type { inferRouterOutputs } from "@trpc/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { UserAssociation } from "@/drizzle/constants";
import { userAssociation } from "@/drizzle/schema";
import { getServerPusher } from "@/libs/pusher";
import { fetchUser } from "@/routers/profile";
import {
  fetchRequest,
  fetchRequests,
  insertRequest,
  updateRequestState,
} from "@/routers/sparring";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";

const pusher = getServerPusher();

export const marriageRouter = createTRPCRouter({
  createRequest: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Send a marriage proposal to another user" },
    })
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, targetUser, userAssociations] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        fetchAssociations(ctx.drizzle, ctx.userId, ["MARRIAGE"]),
      ]);
      // Guards
      if (
        userAssociations.length > 0 &&
        userAssociations.filter(
          (x) =>
            x.userOne.userId === targetUser.userId ||
            x.userTwo.userId === targetUser.userId,
        ).length > 0
      )
        return errorResponse("You are already married to this user");
      // Mutate
      await insertRequest(ctx.drizzle, user.userId, targetUser.userId, "MARRIAGE");
      void pusher.trigger(targetUser.userId, "event", { type: "marriage" });
      // Create
      return { success: true, message: "You have proposed!" };
    }),
  getRequests: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get pending marriage requests" } })
    .query(async ({ ctx }) => {
      return await fetchRequests(ctx.drizzle, ["MARRIAGE"], 3600 * 12, ctx.userId);
    }),
  rejectRequest: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Reject a marriage proposal" } })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const request = await fetchRequest(ctx.drizzle, input.id, "MARRIAGE");
      if (request.receiverId !== ctx.userId) {
        return errorResponse("You can only reject requests for yourself");
      }
      if (request.status !== "PENDING") {
        return errorResponse("You can only reject pending requests");
      }
      void pusher.trigger(request.senderId, "event", { type: "MARRIAGE" });
      await updateRequestState(ctx.drizzle, input.id, "REJECTED", "MARRIAGE");
      return { success: true, message: "Proposal Rejected" };
    }),
  cancelRequest: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Cancel your marriage proposal" } })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const request = await fetchRequest(ctx.drizzle, input.id, "MARRIAGE");
      if (request.senderId !== ctx.userId) {
        return errorResponse("You can only cancel requests created by you");
      }
      if (request.status !== "PENDING") {
        return errorResponse("You can only cancel pending requests");
      }
      void pusher.trigger(request.receiverId, "event", { type: "MARRIAGE" });
      await updateRequestState(ctx.drizzle, input.id, "CANCELLED", "MARRIAGE");
      return { success: true, message: "Proposal cancelled" };
    }),
  acceptRequest: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Accept a marriage proposal" } })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const request = await fetchRequest(ctx.drizzle, input.id, "MARRIAGE");
      // Secondary fetches
      const [sender, receiver, senderAssociations, receiverAssociations] =
        await Promise.all([
          fetchUser(ctx.drizzle, request.senderId),
          fetchUser(ctx.drizzle, request.receiverId),
          fetchAssociations(ctx.drizzle, request.senderId, ["MARRIAGE"]),
          fetchAssociations(ctx.drizzle, request.receiverId, ["MARRIAGE"]),
        ]);
      // Guards
      if (ctx.userId !== request.receiverId) return errorResponse("Not your request");
      if (sender.marriageSlots <= senderAssociations.length)
        return errorResponse("Sender does not have enough marriage slots");
      if (receiver.marriageSlots <= receiverAssociations.length)
        return errorResponse("Receiver does not have enough marriage slots");
      if (
        senderAssociations.length > 0 &&
        senderAssociations.filter(
          (x) => x.userOne.userId === ctx.userId || x.userTwo.userId === ctx.userId,
        ).length > 0
      )
        return errorResponse("You are already married to this user");
      // Mutate
      await Promise.all([
        updateRequestState(ctx.drizzle, input.id, "ACCEPTED", "MARRIAGE"),
        insertAssociation(
          ctx.drizzle,
          request.senderId,
          request.receiverId,
          "MARRIAGE",
        ),
      ]);
      void pusher.trigger(request.senderId, "event", { type: "MARRIAGE" });
      // Create
      return { success: true, message: "Proposal Accepted" };
    }),
  getMarriedUsers: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get list of married users" } })
    .input(z.object({ id: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const associations = await fetchAssociations(
        ctx.drizzle,
        input.id ?? ctx?.userId ?? "",
        ["MARRIAGE"],
      );
      const marriedUsers = associations.map((x) =>
        x.userOne.userId !== (input.id ?? ctx?.userId) ? x.userOne : x.userTwo,
      );

      return marriedUsers;
    }),
  getDivorcedAssociations: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get divorce history" } })
    .query(async ({ ctx }) => {
      return await fetchAssociations(ctx.drizzle, ctx.userId, ["DIVORCED"]);
    }),
  divorce: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Divorce a married user" } })
    .input(z.object({ userId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const associations = await fetchAssociations(ctx.drizzle, ctx.userId, [
        "MARRIAGE",
        "DIVORCED",
      ]);
      // Derived
      const marriage = associations.find(
        (x) =>
          (x.userOne.userId === input.userId || x.userTwo.userId === input.userId) &&
          x.associationType === "MARRIAGE",
      );
      const prevDivorce = associations.find(
        (x) =>
          (x.userOne.userId === input.userId || x.userTwo.userId === input.userId) &&
          x.associationType === "DIVORCED",
      );
      // Guard
      if (!marriage) return errorResponse("Marriage was unable to be found");
      // Mutate
      if (prevDivorce) {
        await deleteAssociation(ctx.drizzle, marriage.id);
      } else {
        await updateAssociation(ctx.drizzle, marriage.id, "MARRIAGE", "DIVORCED");
      }
      return { success: true, message: "Divorce finalized" };
    }),
});

/**
 * Inserts a new association into the database
 * @param client - The database client
 * @param userOne - The first user in the association
 * @param userTwo - The second user in the association
 * @param associationType - The type of association
 */
export const insertAssociation = async (
  client: DrizzleClient,
  userOne: string,
  userTwo: string,
  associationType: UserAssociation,
) => {
  await client.insert(userAssociation).values({
    id: nanoid(),
    userOne,
    userTwo,
    associationType,
  });
};

/**
 * Updates an existing association in the database
 * @param client - The database client
 * @param associationId - The ID of the association to update
 * @param currentAssociationType - The current type of association
 * @param associationType - The new type of association
 */
export const updateAssociation = async (
  client: DrizzleClient,
  associationId: string,
  currentAssociationType: UserAssociation,
  associationType: UserAssociation,
) => {
  await client
    .update(userAssociation)
    .set({ associationType: associationType })
    .where(
      and(
        eq(userAssociation.id, associationId),
        eq(userAssociation.associationType, currentAssociationType),
      ),
    );
};

/**
 * Deletes an association from the database
 * @param client - The database client
 * @param associationId - The ID of the association to delete
 */
export const deleteAssociation = async (
  client: DrizzleClient,
  associationId: string,
) => {
  await client.delete(userAssociation).where(eq(userAssociation.id, associationId));
};

/**
 * Fetches associations from the database
 * @param client - The database client
 * @param idOne - The ID of the first user in the association
 * @param type - The type of association to fetch
 */
export const fetchAssociations = async (
  client: DrizzleClient,
  idOne?: string,
  types?: UserAssociation[],
) => {
  const results = await client.query.userAssociation.findMany({
    where: and(
      ...(idOne
        ? [or(eq(userAssociation.userOne, idOne), eq(userAssociation.userTwo, idOne))]
        : []),
      ...(types ? [inArray(userAssociation.associationType, types)] : []),
    ),
    with: {
      userOne: { columns: { username: true, userId: true, avatar: true } },
      userTwo: { columns: { username: true, userId: true, avatar: true } },
    },
    orderBy: (table, { asc }) => [asc(table.createdAt)],
  });
  return results.filter((x) => x.userOne && x.userTwo);
};

export type MarriageRouter = inferRouterOutputs<typeof marriageRouter>;
