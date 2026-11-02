import type { inferRouterOutputs } from "@trpc/server";
import { z } from "zod";
import { getServerPusher } from "@/libs/pusher";
import {
  deleteAssociation,
  fetchAssociations,
  insertAssociation,
  updateAssociation,
} from "@/queries/marriage";
import { fetchUser } from "@/queries/profile";
import { fetchRequests, insertRequest } from "@/queries/sparring";

import { fetchRequest, updateRequestState } from "@/routers/sparring";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import { idSchema } from "@/validators/misc";

const pusher = getServerPusher();

export const marriageRouter = createTRPCRouter({
  createRequest: protectedProcedure
    .meta({
      mcp: { description: "Send a marriage proposal to another user" },
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
    .meta({ mcp: { description: "Get pending marriage requests" } })
    .query(async ({ ctx }) => {
      return await fetchRequests(ctx.drizzle, ["MARRIAGE"], 3600 * 12, ctx.userId);
    }),
  rejectRequest: protectedProcedure
    .meta({ mcp: { description: "Reject a marriage proposal" } })
    .input(idSchema)
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
    .meta({ mcp: { description: "Cancel your marriage proposal" } })
    .input(idSchema)
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
    .meta({ mcp: { description: "Accept a marriage proposal" } })
    .input(idSchema)
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
      if (request.status !== "PENDING") {
        return errorResponse("You can only accept pending requests");
      }
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
      // Mutate: only the accept that moves the request out of PENDING marries
      const accepted = await updateRequestState(
        ctx.drizzle,
        input.id,
        "ACCEPTED",
        "MARRIAGE",
        undefined,
        "PENDING",
      );
      if (!accepted.success) return accepted;
      await insertAssociation(
        ctx.drizzle,
        request.senderId,
        request.receiverId,
        "MARRIAGE",
      );
      void pusher.trigger(request.senderId, "event", { type: "MARRIAGE" });
      // Create
      return { success: true, message: "Proposal Accepted" };
    }),
  getMarriedUsers: publicProcedure
    .meta({ mcp: { description: "Get list of married users" } })
    .input(z.object({ id: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const targetId = input.id ?? ctx.userId;
      if (!targetId) return [];
      const associations = await fetchAssociations(ctx.drizzle, targetId, ["MARRIAGE"]);
      const marriedUsers = associations.map((x) =>
        x.userOne.userId !== targetId ? x.userOne : x.userTwo,
      );

      return marriedUsers;
    }),
  getDivorcedAssociations: protectedProcedure
    .meta({ mcp: { description: "Get divorce history" } })
    .query(async ({ ctx }) => {
      return await fetchAssociations(ctx.drizzle, ctx.userId, ["DIVORCED"]);
    }),
  divorce: protectedProcedure
    .meta({ mcp: { description: "Divorce a married user" } })
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

export type MarriageRouter = inferRouterOutputs<typeof marriageRouter>;
