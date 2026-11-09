import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { StaffApprovalGroup } from "@/drizzle/constants";
import {
  StaffApplicationStates,
  StaffApplicationTargetRoles,
  StaffApprovalGroups,
} from "@/drizzle/constants";
import { staffApplication } from "@/drizzle/schema";
import {
  deleteStaffApplicationForDelete,
  fetchApplication,
  findStaffApplicationForDelete,
  insertStaffApplicationApprovalForApprove,
  insertStaffApplicationApprovalForReject,
  insertStaffApplicationForCreate,
  listStaffApplicationApprovalForApprove,
  listStaffApplicationForList,
  selectUserDataForList,
  updateStaffApplicationForApprove,
  updateStaffApplicationForApprove2,
  updateStaffApplicationForReject,
  updateUserDataForApprove,
} from "@/queries/applications";
import { fetchUser } from "@/queries/profile";
import { createConvo } from "@/routers/comments";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import { offsetPage } from "@/server/utils/pagination";
import {
  canDeleteStaffApplication,
  canViewAllApplications,
  getApprovalGroup,
  getBanOrSilenceRestriction,
} from "@/utils/permissions";
import { createApplicationSchema } from "@/validators/applications";
import { idSchema } from "@/validators/misc";

// Infinite filtering for applications list
const listApplicationsInfiniteSchema = z.object({
  cursor: z.number().nullish(),
  limit: z.number().min(1).max(100).prefault(30),
  onlyMine: z.boolean().optional(),
  username: z.string().optional(),
  targetRole: z.enum(StaffApplicationTargetRoles).optional(),
  state: z.enum(StaffApplicationStates).optional(),
});

export const applicationsRouter = createTRPCRouter({
  create: protectedProcedure
    .meta({ mcp: { description: "Create a new staff application" } })
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
      const applicationRestriction = getBanOrSilenceRestriction(user);
      if (applicationRestriction) return errorResponse(applicationRestriction);
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
        insertStaffApplicationForCreate(ctx.drizzle, appid, user, input, convoId),
      ]);
      return { success: true, message: "Application created", id: appid };
    }),

  get: protectedProcedure
    .meta({ mcp: { description: "Get a staff application by ID" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      // Query
      const [user, app] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchApplication({ client: ctx.drizzle, applicationId: input.id }),
      ]);
      // Guards
      if (!app) return null;
      const isOwner = app.applicantUserId === user.userId;
      const canViewAll = canViewAllApplications(user.role);
      if (!isOwner && !canViewAll) return null;
      // Return
      return app;
    }),

  // Infinite list with filters
  list: protectedProcedure
    .meta({
      mcp: { description: "List staff applications with filters" },
    })
    .input(listApplicationsInfiniteSchema)
    .query(async ({ ctx, input }) => {
      const limit = input.limit;
      const { skip, cursorAfter } = offsetPage(input);

      const [user, usernameIds] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        // Resolve username -> userIds
        input.username
          ? selectUserDataForList(ctx.drizzle, { username: input.username }).then(
              (rows) => rows.map((r) => r.userId),
            )
          : Promise.resolve([]),
      ]);
      if (input.username && usernameIds.length === 0) {
        return { data: [], nextCursor: null };
      }
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

      // Fetch with relation and username filter using inArray on applicantUserId
      const results = await listStaffApplicationForList(
        ctx.drizzle,
        baseConds,
        input,
        usernameIds,
        limit,
        skip,
      );

      // Attach current user's vote (if any) to each application
      const enriched = results.map((app) => {
        const myApproval = app.approvals.find((a) => a.approverUserId === user.userId);
        return {
          ...app,
          myVote: myApproval?.state ?? null,
        };
      });

      const nextCursor = cursorAfter(results);
      return { data: enriched, nextCursor };
    }),

  delete: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query: fetch the user and the application in parallel for efficiency
      const [user, app] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findStaffApplicationForDelete(ctx.drizzle, input),
      ]);

      // Guards
      if (!canDeleteStaffApplication(user.role)) return errorResponse("Not allowed");
      if (!app) return errorResponse("Application not found");
      if (app.state !== "PENDING")
        return errorResponse("Only pending applications can be deleted");

      // Mutation: perform deletion
      await deleteStaffApplicationForDelete(ctx.drizzle, input);
      return { success: true, message: "Application deleted" };
    }),

  approve: protectedProcedure
    .input(idSchema)
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
      const approvalGroup = getApprovalGroup(user.role);
      if (!approvalGroup)
        return errorResponse("Only approval staff can approve applications");

      // Update: record approval (upsert)
      await insertStaffApplicationApprovalForApprove(
        ctx.drizzle,
        app,
        user,
        approvalGroup,
      );

      // Query: approvals with APPROVED state
      const decisions = await listStaffApplicationApprovalForApprove(
        ctx.drizzle,
        input,
      );
      const approvals = decisions.filter((d) => d.state === "APPROVED");
      const rejected = decisions.filter((d) => d.state === "REJECTED");
      const approvedGroups = new Set<StaffApprovalGroup>(approvals.map((a) => a.group));
      const done = StaffApprovalGroups.every((g) => approvedGroups.has(g));

      // If all groups are approved, promote user and approve application
      if (done) {
        // Update: promote user and approve application
        const [result] = await Promise.all([
          updateUserDataForApprove(ctx.drizzle, app),
          updateStaffApplicationForApprove(ctx.drizzle, app),
        ]);
        if (result.rowsAffected === 0) return errorResponse("Promotion failed");
        return { success: true, message: "Application approved and user promoted" };
      } else if (rejected.length === 0 && app.state === "REJECTED") {
        await updateStaffApplicationForApprove2(ctx.drizzle, app);
        return {
          success: true,
          message: "Application approved. Reset to pending others.",
        };
      }
      return { success: true, message: "Approval recorded" };
    }),

  reject: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, app] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findStaffApplicationForDelete(ctx.drizzle, input),
      ]);
      // Guards
      if (!app) return errorResponse("No application found");
      const rejectionGroup = getApprovalGroup(user.role);
      if (!rejectionGroup)
        return errorResponse("Only approval staff can reject applications");
      // Mutate: record rejection (upsert)
      await Promise.all([
        insertStaffApplicationApprovalForReject(ctx.drizzle, app, user, rejectionGroup),
        updateStaffApplicationForReject(ctx.drizzle, app),
      ]);

      // Update application state
      return { success: true, message: "Application rejected" };
    }),
});
