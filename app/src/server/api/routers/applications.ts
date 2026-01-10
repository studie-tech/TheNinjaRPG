import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { baseServerResponse, errorResponse } from "@/server/api/trpc";
import { z } from "zod";
import { nanoid } from "nanoid";
import { eq, and, desc, inArray, like } from "drizzle-orm";
import { userData, staffApplication, staffApplicationApproval } from "@/drizzle/schema";
import { StaffApplicationTargetRoles } from "@/drizzle/constants";
import type { StaffApprovalGroup } from "@/drizzle/constants";
import {
  createApplicationSchema,
  listApplicationsInfiniteSchema,
} from "@/validators/applications";
import type { StaffApplicationState } from "@/drizzle/constants";
import type { DrizzleClient } from "@/server/db";
import { StaffApprovalGroups } from "@/drizzle/constants";
import { createConvo } from "@/routers/comments";
import { fetchUser } from "@/routers/profile";
import {
  canDeleteStaffApplication,
  canViewAllApplications,
  canApproveApplications,
  getApprovalGroup,
} from "@/utils/permissions";

export const applicationsRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createApplicationSchema)
    .output(baseServerResponse.extend({ id: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, existingRow] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchApplication({
          client: ctx.drizzle,
          userId: ctx.userId,
          status: "PENDING",
        }),
      ]);
      // Guards
      if (!StaffApplicationTargetRoles.includes(input.targetRole)) {
        return errorResponse("Invalid target role");
      }
      if (existingRow) {
        return errorResponse("Application already pending");
      }
      // Update
      const appid = nanoid();
      const convoId = nanoid();
      await Promise.all([
        createConvo({
          client: ctx.drizzle,
          authorUserId: user.userId,
          senderUserId: user.userId,
          receiverUserIds: [],
          title: `Staff Application: ${user.username}`,
          content: input.motivation,
          isStaffAvailable: true,
          convoId,
        }),
        ctx.drizzle.insert(staffApplication).values({
          id: appid,
          applicantUserId: user.userId,
          targetRole: input.targetRole,
          state: "PENDING",
          conversationId: convoId,
          motivation: input.motivation,
        }),
      ]);
      return { success: true, message: "Application created", id: appid };
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [user, app] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchApplication({ client: ctx.drizzle, applicationId: input.id }),
      ]);
      // Guards
      if (!user || !app) return null;
      const isOwner = app.applicantUserId === user.userId;
      const canViewAll = canViewAllApplications(user.role);
      if (!isOwner && !canViewAll) return null;
      // Return
      return app;
    }),

  // Infinite list with filters
  list: protectedProcedure
    .input(listApplicationsInfiniteSchema)
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ?? 0;
      const limit = input.limit ?? 30;
      const skip = currentCursor * limit;

      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const canViewAll = canViewAllApplications(user.role);

      // If onlyMine or user cannot view all applications, constrain to self
      const baseConds = [
        ...(input.onlyMine || !canViewAll
          ? [eq(staffApplication.applicantUserId, user.userId)]
          : []),
        ...(input.state ? [eq(staffApplication.state, input.state)] : []),
        ...(input.targetRole
          ? [eq(staffApplication.targetRole, input.targetRole)]
          : []),
      ];

      // Resolve username -> userIds
      const usernameIds = input.username
        ? (
            await ctx.drizzle
              .select({ userId: userData.userId })
              .from(userData)
              .where(like(userData.username, `%${input.username}%`))
              .limit(10)
          ).map((r) => r.userId)
        : [];

      // Fetch with relation and username filter using inArray on applicantUserId
      const results = await ctx.drizzle.query.staffApplication.findMany({
        where: and(
          ...baseConds,
          ...(input.username && usernameIds.length > 0
            ? [inArray(staffApplication.applicantUserId, usernameIds)]
            : input.username
              ? [eq(staffApplication.applicantUserId, "__none__")] // force no results
              : []),
        ),
        with: {
          applicant: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
              level: true,
              rank: true,
            },
            with: { village: { columns: { name: true } } },
          },
          approvals: {
            with: {
              approver: { columns: { userId: true, username: true, avatar: true } },
            },
          },
        },
        orderBy: [desc(staffApplication.createdAt)],
        limit,
        offset: skip,
      });

      // Attach current user's vote (if any) to each application
      const enriched = results.map((app) => {
        const myApproval = Array.isArray(app.approvals)
          ? app.approvals.find((a) => a.approverUserId === user.userId)
          : undefined;
        return {
          ...app,
          myVote: myApproval?.state ?? null,
        };
      });

      const nextCursor = results.length < limit ? null : currentCursor + 1;
      return { data: enriched, nextCursor };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query: fetch the user and the application in parallel for efficiency
      const [user, app] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.staffApplication.findFirst({
          where: eq(staffApplication.id, input.id),
        }),
      ]);

      // Guards
      if (!user) return errorResponse("Not allowed");
      if (!canDeleteStaffApplication(user.role)) return errorResponse("Not allowed");
      if (!app) return errorResponse("Application not found");
      if (app.state !== "PENDING")
        return errorResponse("Only pending applications can be deleted");

      // Mutation: perform deletion
      await ctx.drizzle
        .delete(staffApplication)
        .where(eq(staffApplication.id, input.id));
      return { success: true, message: "Application deleted" };
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, app] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchApplication({
          client: ctx.drizzle,
          applicationId: input.id,
        }),
      ]);
      // Guards
      if (!app) return errorResponse("No application found");
      if (app.state === "APPROVED")
        return errorResponse("Application already approved");
      if (!canApproveApplications(user.role))
        return errorResponse("Only admins and coders can approve applications");

      // Update: record approval (upsert)
      const approvalGroup = getApprovalGroup(user.role);
      if (!approvalGroup) return errorResponse("No approval group found for user role");
      await ctx.drizzle
        .insert(staffApplicationApproval)
        .values({
          id: nanoid(),
          applicationId: app.id,
          approverUserId: user.userId,
          group: approvalGroup,
          state: "APPROVED",
        })
        .onDuplicateKeyUpdate({
          set: {
            state: "APPROVED",
            approverUserId: user.userId,
            group: approvalGroup,
          },
        });

      // Query: approvals with APPROVED state
      const decisions = await ctx.drizzle.query.staffApplicationApproval.findMany({
        where: eq(staffApplicationApproval.applicationId, input.id),
      });
      const approvals = decisions.filter((d) => d.state === "APPROVED");
      const rejected = decisions.filter((d) => d.state === "REJECTED");
      const approvedGroups = new Set<StaffApprovalGroup>(approvals.map((a) => a.group));
      const done = StaffApprovalGroups.every((g) => approvedGroups.has(g));

      // If all groups are approved, promote user and approve application
      if (done) {
        // Update: promote user and approve application
        const [result] = await Promise.all([
          ctx.drizzle
            .update(userData)
            .set({ role: app.targetRole })
            .where(eq(userData.userId, app.applicantUserId)),
          ctx.drizzle
            .update(staffApplication)
            .set({ state: "APPROVED", updatedAt: new Date() })
            .where(eq(staffApplication.id, app.id)),
        ]);
        if (result.rowsAffected === 0) return errorResponse("Promotion failed");
        return { success: true, message: "Application approved and user promoted" };
      } else if (rejected.length === 0 && app.state === "REJECTED") {
        await ctx.drizzle
          .update(staffApplication)
          .set({ state: "PENDING", updatedAt: new Date() })
          .where(eq(staffApplication.id, app.id));
        return {
          success: true,
          message: "Application approved. Reset to pending others.",
        };
      }
      return { success: true, message: "Approval recorded" };
    }),

  reject: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        reason: z.string().min(1).max(2000).optional(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, app] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.staffApplication.findFirst({
          where: eq(staffApplication.id, input.id),
        }),
      ]);
      // Guards
      if (!app) return errorResponse("No application found");
      if (!canApproveApplications(user.role))
        return errorResponse("Only admins and coders can reject applications");
      // Mutate: record rejection (upsert)
      const rejectionGroup = getApprovalGroup(user.role);
      if (!rejectionGroup)
        return errorResponse("No approval group found for user role");
      await Promise.all([
        ctx.drizzle
          .insert(staffApplicationApproval)
          .values({
            id: nanoid(),
            applicationId: app.id,
            approverUserId: user.userId,
            group: rejectionGroup,
            state: "REJECTED",
          })
          .onDuplicateKeyUpdate({
            set: {
              state: "REJECTED",
              approverUserId: user.userId,
              group: rejectionGroup,
            },
          }),
        ctx.drizzle
          .update(staffApplication)
          .set({ state: "REJECTED", updatedAt: new Date() })
          .where(eq(staffApplication.id, app.id)),
      ]);

      // Update application state
      return { success: true, message: "Application rejected" };
    }),
});

/**
 * Fetch an application by user ID and status.
 * @param client - The DrizzleClient instance used for database operations.
 * @param userId - The ID of the user to fetch the application for.
 * @param status - The status of the application to fetch.
 * @returns The application if found, otherwise null.
 */
export const fetchApplication = async (info: {
  client: DrizzleClient;
  userId?: string;
  applicationId?: string;
  status?: StaffApplicationState;
}) => {
  const { client, userId, applicationId, status } = info;
  return await client.query.staffApplication.findFirst({
    where: and(
      ...(userId ? [eq(staffApplication.applicantUserId, userId)] : []),
      ...(applicationId ? [eq(staffApplication.id, applicationId)] : []),
      ...(status ? [eq(staffApplication.state, status)] : []),
    ),
    with: {
      applicant: {
        columns: {
          userId: true,
          username: true,
          avatar: true,
          level: true,
          rank: true,
        },
        with: { village: { columns: { name: true } } },
      },
      approvals: {
        with: {
          approver: { columns: { userId: true, username: true, avatar: true } },
        },
      },
    },
  });
};
