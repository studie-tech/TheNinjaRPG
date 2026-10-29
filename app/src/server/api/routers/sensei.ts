import { z } from "zod";
import { SENSEI_RANKS } from "@/drizzle/constants";
import { getServerPusher } from "@/libs/pusher";
import { fetchUser } from "@/queries/profile";
import {
  fetchStudents,
  updateUserDataForAcceptRequest,
  updateUserDataForRemoveStudent,
} from "@/queries/sensei";
import { fetchRequests, insertRequest } from "@/queries/sparring";

import { fetchRequest, updateRequestState } from "@/routers/sparring";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import { idSchema } from "@/validators/misc";

const pusher = getServerPusher();

import { userDeltaResponseSchema } from "@/validators/userCache";

export const senseiRouter = createTRPCRouter({
  getStudents: protectedProcedure
    .meta({ mcp: { description: "Get students of a sensei" } })
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await fetchStudents(ctx.drizzle, input.userId);
    }),
  getRequests: protectedProcedure
    .meta({ mcp: { description: "Get pending sensei requests" } })
    .query(async ({ ctx }) => {
      return fetchRequests(ctx.drizzle, ["SENSEI"], 3600 * 24, ctx.userId);
    }),
  createRequest: protectedProcedure
    .meta({
      mcp: { description: "Request to become sensei or student" },
    })
    .input(z.object({ targetId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, target, recent] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.targetId),
        fetchRequests(ctx.drizzle, ["SENSEI"], 10, ctx.userId),
      ]);
      // Guard
      if (recent.length > 0) {
        return errorResponse("Max 1 sensei request per 10 seconds");
      }
      if (target.villageId !== user.villageId) {
        return errorResponse("Sensei must be from same village");
      }
      if (SENSEI_RANKS.includes(user.rank) && target.rank !== "GENIN") {
        return errorResponse("Can only teach Genin");
      }
      if (user.rank === "GENIN" && !SENSEI_RANKS.includes(target.rank)) {
        return errorResponse("Genin can only learn from Jonin and higher");
      }
      // Mutate
      await insertRequest(ctx.drizzle, user.userId, target.userId, "SENSEI");
      void pusher.trigger(input.targetId, "event", {
        type: "userMessage",
        message: "Updates in sensei system",
        route: "/traininggrounds",
        routeText: "To Training Grounds",
      });
      return { success: true, message: "Request created" };
    }),
  rejectRequest: protectedProcedure
    .meta({ mcp: { description: "Reject a sensei request" } })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const request = await fetchRequest(ctx.drizzle, input.id, "SENSEI");
      if (request.receiverId !== ctx.userId) {
        return errorResponse("You can only reject requests for yourself");
      }
      if (request.status !== "PENDING") {
        return errorResponse("You can only reject pending requests");
      }
      void pusher.trigger(request.senderId, "event", {
        type: "userMessage",
        message: "Updates in sensei system",
        route: "/traininggrounds",
        routeText: "To Training Grounds",
      });
      return await updateRequestState(ctx.drizzle, input.id, "REJECTED", "SENSEI");
    }),
  cancelRequest: protectedProcedure
    .meta({ mcp: { description: "Cancel your sensei request" } })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const request = await fetchRequest(ctx.drizzle, input.id, "SENSEI");
      if (request.senderId !== ctx.userId) {
        return errorResponse("You can only cancel requests created by you");
      }
      if (request.status !== "PENDING") {
        return errorResponse("You can only cancel pending requests");
      }
      return await updateRequestState(ctx.drizzle, input.id, "CANCELLED", "SENSEI");
    }),
  acceptRequest: protectedProcedure
    .meta({ mcp: { description: "Accept a sensei request" } })
    .input(idSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [request, user] = await Promise.all([
        fetchRequest(ctx.drizzle, input.id, "SENSEI"),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Derived
      const studentId = user.rank === "GENIN" ? user.userId : request.senderId;
      const senseiId = user.rank === "GENIN" ? request.senderId : user.userId;
      const students = await fetchStudents(ctx.drizzle, senseiId);
      const activeStudents = students.filter((s) => s.rank === "GENIN");
      // Guards
      if (request.receiverId !== ctx.userId) {
        return errorResponse("Not your challenge to accept");
      }
      if (request.status !== "PENDING") {
        return errorResponse("Challenge not pending");
      }
      if (user.rank === "GENIN" && user.senseiId) {
        return errorResponse("You already have a sensei");
      }
      if (activeStudents.length > 3) {
        return errorResponse("Can only have 3 active students");
      }
      // Mutate. If not successfull, assume student already has a sensei
      const result = await updateUserDataForAcceptRequest(
        ctx.drizzle,
        senseiId,
        studentId,
      );
      if (result.rowsAffected !== 0) {
        await updateRequestState(ctx.drizzle, input.id, "ACCEPTED", "SENSEI");
        void pusher.trigger(request.senderId, "event", {
          type: "userMessage",
          message: "Updates in sensei system",
          route: "/traininggrounds",
          routeText: "To Training Grounds",
        });
        return {
          success: true,
          message: "Request accepted",
          userPatch: user.rank === "GENIN" ? { senseiId } : {},
        };
      }
      return errorResponse("Student already has a sensei");
    }),
  removeStudent: protectedProcedure
    .meta({
      mcp: { description: "Remove a student from your training" },
    })
    .input(z.object({ studentId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [student, sensei] = await Promise.all([
        fetchUser(ctx.drizzle, input.studentId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (student.senseiId !== sensei.userId) {
        return errorResponse("Student is not yours");
      }
      if (student.rank !== "GENIN") {
        return errorResponse("Can only remove Genin students");
      }
      // Update
      await updateUserDataForRemoveStudent(ctx.drizzle, student);
      return { success: true, message: "Student removed" };
    }),
  leaveSensei: protectedProcedure
    .meta({ mcp: { description: "Leave your current sensei" } })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!user.senseiId) {
        return errorResponse("You do not have a sensei");
      }
      // Update
      await updateUserDataForRemoveStudent(ctx.drizzle, user);
      return { success: true, message: "Left sensei", userPatch: { senseiId: null } };
    }),
});
