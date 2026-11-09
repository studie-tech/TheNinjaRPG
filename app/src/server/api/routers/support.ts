import type { SQL } from "drizzle-orm";
import { and, eq, gte, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { SupportTicketCategory, SupportTicketPriority } from "@/drizzle/constants";
import {
  GITHUB_API_ENDPOINT,
  SupportTicketCategories,
  SupportTicketPriorities,
  SupportTicketStatuses,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { supportTicket } from "@/drizzle/schema";
import { anonymizeStaffInfo, getTicketUpdateActivities } from "@/libs/support";
import { fetchUser } from "@/queries/profile";
import {
  createSupportTicketActivity,
  deleteCannedResponseForDeleteCannedResponse,
  deleteConversationCommentForDeleteTicket,
  deleteConversationForDeleteTicket,
  deleteSupportTicketActivityForDeleteTicket,
  deleteSupportTicketForDeleteTicket,
  fetchCannedResponse,
  findSupportTicketForGetSupportTicketWithRelations,
  insertCannedResponseForCreateCannedResponse,
  insertSupportTicketForCreateTicket,
  listConversationCommentForEscalateToGithub,
  listSupportTicketForCalculateSupportMetrics,
  listSupportTicketForGetSupportTicketsWithRelations,
  selectCannedResponseForGetCannedResponses,
  selectSupportTicketForGetStatistics,
  selectSupportTicketForGetStatistics2,
  selectSupportTicketForGetStatistics3,
  selectSupportTicketForGetStatistics4,
  updateCannedResponseForUpdateCannedResponse,
  updateConversationForUpdateTicket,
  updateSupportTicketForEscalateToGithub,
  updateSupportTicketForUpdateTicket,
} from "@/queries/support";
import { createConvo } from "@/server/api/routers/comments";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { offsetPage } from "@/server/utils/pagination";
import { logError } from "@/server/utils/sentry";
import { reduceByKey } from "@/utils/grouping";
import {
  canAssignSupportTicket,
  canDeleteSupportTicket,
  canEditCannedResponses,
  canEditSupportTicket,
  canEscalateToGithub,
  canTransitionStatus,
  canViewStaffOnlyComments,
  canViewSupportStatistics,
  canViewSupportTicket,
} from "@/utils/permissions";
import sanitize from "@/utils/sanitize";
import { idSchema } from "@/validators/misc";
import {
  createSupportTicketSchema,
  updateSupportTicketSchema,
} from "@/validators/support";

// Escalate to GitHub Schema
const escalateToGithubSchema = z.object({
  ticketId: z.string(),
});

// Support Ticket Filter Schema
const supportTicketFilterSchema = z.object({
  status: z.array(z.enum(SupportTicketStatuses)).optional(),
  category: z.array(z.enum(SupportTicketCategories)).optional(),
  priority: z.array(z.enum(SupportTicketPriorities)).optional(),
  assignedToUserId: z.string().nullable().optional(),
  createdByUserId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
  search: z.string().optional(),
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
  cursor: z.number().nullish(),
  limit: z.number().min(1).max(100).prefault(20),
  orderBy: z
    .enum(["createdAt", "updatedAt", "priority", "status"])
    .prefault("createdAt"),
  orderDirection: z.enum(["asc", "desc"]).prefault("desc"),
});

type SupportTicketFilteringSchema = z.infer<typeof supportTicketFilterSchema>;

// Support Ticket Metrics Schema
const supportTicketMetricsSchema = z.object({
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
  category: z.enum(SupportTicketCategories).optional(),
  assignedToUserId: z.string().optional(),
});

export const supportRouter = createTRPCRouter({
  // Get all support tickets with filtering
  getTickets: protectedProcedure
    .input(supportTicketFilterSchema)
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Pagination handling
      const limit = input.limit;
      const { skip, cursorAfter } = offsetPage(input);
      const isStaff = canViewStaffOnlyComments(user.role);
      // Run filtered query
      const tickets = await getSupportTicketsWithRelations({
        client: ctx.drizzle,
        skip,
        limit,
        filters: input,
        isStaff,
        userId: ctx.userId,
      });
      // Process tickets to hide information
      const processedTickets = isStaff
        ? tickets
        : tickets.map((ticket) => sanitizeSupportTicketForPublic(ticket, user));

      const nextCursor = cursorAfter(tickets);

      return { data: processedTickets, nextCursor };
    }),

  // Get a specific support ticket
  getTicket: protectedProcedure
    .input(z.object({ ticketId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [user, ticket] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        getSupportTicketWithRelations(ctx.drizzle, input.ticketId),
      ]);

      if (!ticket) {
        throw serverError("NOT_FOUND", "Ticket not found");
      }

      if (!canViewSupportTicket(ticket, ctx.userId, user.role)) {
        throw serverError("FORBIDDEN", "Access denied");
      }

      // Sanitize ticket for public view if user is not staff
      if (!canViewStaffOnlyComments(user.role)) {
        return sanitizeSupportTicketForPublic(ticket, user);
      }

      return ticket;
    }),

  // Create a new support ticket
  createTicket: protectedProcedure
    .input(createSupportTicketSchema)
    .output(
      baseServerResponse.extend({
        data: z.object({ ticketId: z.string() }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guards
      if (user.isBanned || user.isSilenced) {
        if (input.isPublic || input.category !== "MODERATION_SUPPORT") {
          return errorResponse(
            "You cannot create public tickets while banned or silenced, you can only create private moderation support tickets",
          );
        }
      }
      // Mutate
      const ticketId = nanoid(10);
      const convoId = nanoid();
      const sanitizedDescription = sanitize(input.description);
      await Promise.all([
        insertSupportTicketForCreateTicket(
          ctx.drizzle,
          ticketId,
          input,
          sanitizedDescription,
          ctx,
          convoId,
        ),
        createConvo({
          client: ctx.drizzle,
          authorUserId: ctx.userId,
          senderUserId: ctx.userId,
          receiverUserIds: [],
          title: input.title,
          content: sanitizedDescription,
          isStaffAvailable: true,
          convoId,
          isPublic: input.isPublic,
        }),
        createSupportTicketActivity(ctx.drizzle, ticketId, ctx.userId, "CREATED"),
      ]);
      return {
        success: true,
        message: "Support ticket created successfully",
        data: { ticketId },
      };
    }),

  // Update a support ticket
  updateTicket: protectedProcedure
    .input(z.object({ ticketId: z.string() }).extend(updateSupportTicketSchema.shape))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Destructure
      const { ticketId, ...updateData } = input;
      // Query
      const [user, ticket] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        getSupportTicketWithRelations(ctx.drizzle, input.ticketId),
      ]);
      // Guards
      if (!ticket) {
        return errorResponse("Ticket not found");
      }
      if (!canEditSupportTicket(ticket, ctx.userId, user.role)) {
        return errorResponse("Access denied");
      }
      if (updateData.status && !canTransitionStatus(ticket.status, updateData.status)) {
        return errorResponse(
          `Cannot transition from ${ticket.status} to ${updateData.status}`,
        );
      }
      if (
        updateData?.assignedToUserId &&
        updateData.assignedToUserId !== ticket.assignedToUserId &&
        !canAssignSupportTicket(user.role)
      ) {
        return errorResponse("No permission to assign tickets");
      }

      // Activity log entries for every field that actually changes
      const { description: nextDescription, ...ticketUpdate } = updateData;
      const cleanDescription =
        nextDescription !== undefined ? sanitize(nextDescription) : undefined;
      const activities = getTicketUpdateActivities(ticket, {
        ...updateData,
        description: cleanDescription,
      });
      // Nothing changed: keep updatedAt and skip the write
      if (activities.length === 0) {
        return { success: true, message: "No changes to save" };
      }
      // Update ticket
      const now = new Date();
      await Promise.all([
        updateSupportTicketForUpdateTicket(
          ctx.drizzle,
          ticketUpdate,
          cleanDescription,
          now,
          ticket,
          updateData,
          ticketId,
        ),
        // Sync conversation isPublic flag when ticket isPublic changes
        ...(updateData.isPublic !== undefined && updateData.isPublic !== ticket.isPublic
          ? [
              updateConversationForUpdateTicket(
                ctx.drizzle,
                { isPublic: updateData.isPublic },
                ticket,
              ),
            ]
          : []),
        ...activities.map((activity) =>
          createSupportTicketActivity(
            ctx.drizzle,
            ticketId,
            ctx.userId,
            activity.action,
            activity.oldValue,
            activity.newValue,
            activity.metadata,
          ),
        ),
      ]);

      return {
        success: true,
        message: "Support ticket updated successfully",
      };
    }),

  // Delete a support ticket
  deleteTicket: protectedProcedure
    .input(z.object({ ticketId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, ticket] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        getSupportTicketWithRelations(ctx.drizzle, input.ticketId),
      ]);
      // Guards
      if (!ticket) {
        return errorResponse("Ticket not found");
      }
      if (!canDeleteSupportTicket(ticket, ctx.userId, user.role)) {
        return errorResponse("No permission to delete tickets");
      }
      // Mutate data
      await Promise.all([
        deleteConversationForDeleteTicket(ctx.drizzle, ticket),
        deleteConversationCommentForDeleteTicket(ctx.drizzle, ticket),
        deleteSupportTicketActivityForDeleteTicket(ctx.drizzle, input),
        deleteSupportTicketForDeleteTicket(ctx.drizzle, input),
      ]);
      return {
        success: true,
        message: "Support ticket deleted successfully",
      };
    }),

  // Get support statistics
  getStatistics: protectedProcedure
    .input(supportTicketMetricsSchema)
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guards
      if (!canViewSupportStatistics(user.role)) {
        throw serverError("FORBIDDEN", "Access denied");
      }
      // Destructure
      const dateFrom = input.dateFrom
        ? new Date(input.dateFrom)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const dateTo = input.dateTo ? new Date(input.dateTo) : new Date();

      /* Build conditions for queries (for re-use) */
      const whereClause = and(
        gte(supportTicket.createdAt, dateFrom),
        lte(supportTicket.createdAt, dateTo),
        ...(input.assignedToUserId
          ? [eq(supportTicket.assignedToUserId, input.assignedToUserId)]
          : []),
        ...(input.category ? [eq(supportTicket.category, input.category)] : []),
      );
      // Run queries
      const [categoryResult, priorityResult, statusResult, assigneeResult, metrics] =
        await Promise.all([
          // Tickets by category
          selectSupportTicketForGetStatistics(ctx.drizzle, whereClause),
          // Tickets by priority
          selectSupportTicketForGetStatistics2(ctx.drizzle, whereClause),
          // Tickets by status
          selectSupportTicketForGetStatistics3(ctx.drizzle, whereClause),
          // Tickets by assignee
          selectSupportTicketForGetStatistics4(ctx.drizzle, whereClause),
          // Metrics (average response etc.)
          calculateSupportMetrics(ctx.drizzle, whereClause),
        ]);

      /* Transform results */
      const ticketsByCategory = reduceByKey(categoryResult, "category");
      const ticketsByPriority = reduceByKey(priorityResult, "priority");
      const ticketsByStatus = reduceByKey(statusResult, "status");
      const ticketsByAssignee = reduceByKey(assigneeResult, "assignedToUserId");
      const totalTickets = Object.values(ticketsByStatus).reduce(
        (total, count) => total + count,
        0,
      );
      const openTickets = ticketsByStatus.OPEN ?? 0;
      const resolvedTickets = ticketsByStatus.RESOLVED ?? 0;
      const assignedToCurrentUser = ticketsByAssignee[ctx.userId] ?? 0;

      return {
        totalTickets,
        openTickets,
        resolvedTickets,
        assignedToCurrentUser,
        ticketsByCategory,
        ticketsByPriority,
        ticketsByStatus,
        ticketsByAssignee,
        ...metrics,
      };
    }),

  // Canned responses CRUD operations
  getCannedResponses: protectedProcedure.query(async ({ ctx }) => {
    const [user, responses] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      selectCannedResponseForGetCannedResponses(ctx.drizzle),
    ]);
    // Canned responses are staff drafting material; players get none.
    return canEditCannedResponses(user.role) ? responses : [];
  }),

  createCannedResponse: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(255),
        description: z.string().min(1),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guards
      if (!canEditCannedResponses(user.role)) {
        return errorResponse("You don't have permission to create canned responses");
      }

      const id = nanoid();
      await insertCannedResponseForCreateCannedResponse(ctx.drizzle, id, input, ctx);

      return { success: true, message: "Canned response created successfully" };
    }),

  updateCannedResponse: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(255),
        description: z.string().min(1),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, response] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchCannedResponse(ctx.drizzle, input.id),
      ]);
      // Guards
      if (!canEditCannedResponses(user.role)) {
        return errorResponse("You don't have permission to update canned responses");
      }
      if (!response) {
        return errorResponse("Canned response not found");
      }
      // Update
      await updateCannedResponseForUpdateCannedResponse(ctx.drizzle, input);

      return { success: true, message: "Canned response updated successfully" };
    }),

  deleteCannedResponse: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, response] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchCannedResponse(ctx.drizzle, input.id),
      ]);
      // Guards
      if (!canEditCannedResponses(user.role)) {
        return errorResponse("You don't have permission to delete canned responses");
      }
      if (!response) {
        return errorResponse("Canned response not found");
      }

      await deleteCannedResponseForDeleteCannedResponse(ctx.drizzle, input);

      return { success: true, message: "Canned response deleted successfully" };
    }),

  // Escalate ticket to GitHub
  escalateToGithub: protectedProcedure
    .input(escalateToGithubSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, ticket] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        getSupportTicketWithRelations(ctx.drizzle, input.ticketId),
      ]);

      // Guards
      if (!ticket) {
        return errorResponse("Ticket not found");
      }
      if (!canEscalateToGithub(user.role)) {
        return errorResponse("You don't have permission to escalate tickets to GitHub");
      }
      if (ticket.githubIssueUrl) {
        return errorResponse("Ticket has already been escalated to GitHub");
      }
      const githubToken = process.env.GITHUB_ISSUE_TOKEN;
      if (!githubToken) {
        return errorResponse("GitHub API token is not configured");
      }
      // Get all conversation comments to include in the GitHub issue
      const comments = await listConversationCommentForEscalateToGithub(
        ctx.drizzle,
        ticket,
      );

      // Build the GitHub issue body
      const ticketUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/support/${ticket.id}`;
      let issueBody = `**Original Support Ticket**: ${ticketUrl}\n\n`;
      issueBody += `**Category**: ${ticket.category}\n`;
      issueBody += `**Priority**: ${ticket.priority}\n`;
      issueBody += `**Status**: ${ticket.status}\n`;
      issueBody += `**Created by**: ${ticket.createdBy.username}\n`;
      issueBody += `**Created at**: ${ticket.createdAt.toISOString()}\n\n`;
      issueBody += `**Description**:\n${ticket.description}\n\n`;

      if (comments.length > 0) {
        issueBody += `**Comments**:\n\n`;
        comments.forEach((comment) => {
          const role = comment.user.role !== "USER" ? ` (${comment.user.role})` : "";
          issueBody += `**${comment.user.username}${role}** - ${comment.createdAt.toISOString()}:\n`;
          issueBody += `${comment.content}\n\n`;
        });
      }

      // Create GitHub issue; only the external call is treated as a recoverable failure
      let githubIssue: { html_url: string; number: number };
      try {
        const githubResponse = await fetch(`${GITHUB_API_ENDPOINT}/issues`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            "Content-Type": "application/json",
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            title: `Support Ticket: ${ticket.title}`,
            body: issueBody,
            labels: [
              "support",
              ticketCategoryToGithubLabel(ticket.category),
              ticketPriorityToGithubLabel(ticket.priority),
            ],
            type: ticketCategoryToGithubType(ticket.category),
          }),
        });
        if (!githubResponse.ok) {
          const errorData = (await githubResponse.json()) as { message?: string };
          logError(
            new Error(
              errorData.message ?? `GitHub API returned ${githubResponse.status}`,
            ),
            "GitHub issue creation failed",
            { ticketId: ticket.id, status: githubResponse.status },
          );
          return errorResponse("Failed to create GitHub issue");
        }
        githubIssue = (await githubResponse.json()) as {
          html_url: string;
          number: number;
        };
      } catch (error) {
        logError(error, "GitHub issue creation failed", { ticketId: ticket.id });
        return errorResponse("Failed to create GitHub issue");
      }
      const githubIssueUrl = githubIssue.html_url;

      // Update ticket with GitHub issue URL
      await Promise.all([
        updateSupportTicketForEscalateToGithub(ctx.drizzle, githubIssueUrl, ticket),
        createSupportTicketActivity(
          ctx.drizzle,
          ticket.id,
          ctx.userId,
          "ESCALATED_TO_GITHUB",
          undefined,
          githubIssueUrl,
          { githubIssueNumber: githubIssue.number },
        ),
      ]);

      return {
        success: true,
        message: "Ticket escalated to GitHub successfully",
      };
    }),
});

/**
 * Convert a support ticket category to a GitHub type
 * @param category - The support ticket category
 * @returns The GitHub type
 */
export const ticketCategoryToGithubType = (category: SupportTicketCategory) => {
  switch (category) {
    case "BUG_REPORT":
      return "Bug";
    case "FEATURE_REQUEST":
      return "Feature";
    default:
      return "Task";
  }
};

/**
 * Convert a support ticket category to a GitHub label
 * @param category - The support ticket category
 * @returns The GitHub label
 */
export const ticketCategoryToGithubLabel = (category: SupportTicketCategory) =>
  TICKET_CATEGORY_LABELS[category];

const TICKET_CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  BUG_REPORT: "bug",
  FEATURE_REQUEST: "new feature",
  ACCOUNT_ISSUE: "account issue",
  GAMEPLAY_QUESTION: "question",
  PAYMENT_ISSUE: "payment",
  TECHNICAL_SUPPORT: "technical support",
  MODERATION_SUPPORT: "moderation support",
  OTHER: "other",
};

/**
 * Convert a support ticket priority to a GitHub label
 * @param priority - The support ticket priority
 * @returns The GitHub label
 */
export const ticketPriorityToGithubLabel = (priority: SupportTicketPriority) =>
  priority.toLowerCase();

/**
 * Get a support ticket with relations
 * @param client - The database client
 * @param ticketId - The ID of the ticket to get
 * @returns The ticket with relations
 */
export const getSupportTicketWithRelations = async (
  client: DrizzleClient,
  ticketId: string,
) => {
  const ticket = await findSupportTicketForGetSupportTicketWithRelations(
    client,
    ticketId,
  );

  return ticket || null;
};
export type SupportTicketWithRelations = Awaited<
  ReturnType<typeof getSupportTicketWithRelations>
>;

/** Page through support tickets matching the filters; non-staff viewers only see their own or public tickets. */
export const getSupportTicketsWithRelations = async (info: {
  client: DrizzleClient;
  skip: number;
  limit: number;
  filters: SupportTicketFilteringSchema;
  isStaff: boolean;
  userId: string;
}) => {
  const { client, skip, limit, filters, isStaff, userId } = info;
  const tickets = await listSupportTicketForGetSupportTicketsWithRelations(
    client,
    filters,
    isStaff,
    userId,
    limit,
    skip,
  );
  return tickets;
};
export type SupportTicketsWithRelations = Awaited<
  ReturnType<typeof getSupportTicketsWithRelations>
>;

/**
 * Calculate support metrics
 * @param client - The database client
 * @param whereClause - The same ticket cohort used by the statistics aggregates
 * @returns The support metrics
 */
export const calculateSupportMetrics = async (
  client: DrizzleClient,
  whereClause: SQL | undefined,
) => {
  const tickets = await listSupportTicketForCalculateSupportMetrics(
    client,
    whereClause,
  );

  let totalResponseTime = 0;
  let totalResolutionTime = 0;
  let ticketsWithResponse = 0;
  let resolvedTickets = 0;

  for (const ticket of tickets) {
    // Calculate first response time
    const firstStaffResponse = ticket.conversation?.comments.find(
      (comment) => comment.user && comment.user.role !== "USER",
    );

    if (firstStaffResponse) {
      const responseTime =
        firstStaffResponse.createdAt.getTime() - ticket.createdAt.getTime();
      totalResponseTime += responseTime;
      ticketsWithResponse++;
    }

    // Calculate resolution time
    if (ticket.status === "RESOLVED" && ticket.closedAt) {
      const resolutionTime = ticket.closedAt.getTime() - ticket.createdAt.getTime();
      totalResolutionTime += resolutionTime;
      resolvedTickets++;
    }
  }

  const averageResponseTime =
    ticketsWithResponse > 0 ? totalResponseTime / ticketsWithResponse : 0;
  const averageResolutionTime =
    resolvedTickets > 0 ? totalResolutionTime / resolvedTickets : 0;
  const firstResponseRate =
    tickets.length > 0 ? (ticketsWithResponse / tickets.length) * 100 : 0;
  const resolutionRate =
    tickets.length > 0 ? (resolvedTickets / tickets.length) * 100 : 0;

  return {
    averageResponseTime: Math.round(averageResponseTime / (1000 * 60)), // Convert to minutes
    averageResolutionTime: Math.round(averageResolutionTime / (1000 * 60)), // Convert to minutes
    firstResponseRate: Math.round(firstResponseRate),
    resolutionRate: Math.round(resolutionRate),
  };
};

/**
 * Sanitize a support ticket for public view
 * @param ticket - The ticket to sanitize
 * @param viewer - The viewer of the ticket
 * @returns The sanitized ticket
 */
export const sanitizeSupportTicketForPublic = (
  ticket: SupportTicketsWithRelations[number] | SupportTicketWithRelations,
  viewer: UserData,
) => {
  const sanitized = { ...ticket } as SupportTicketWithRelations;
  if (sanitized?.createdBy) {
    sanitized.createdBy = anonymizeStaffInfo(sanitized.createdBy, viewer);
  }
  if (sanitized?.assignedTo) {
    sanitized.assignedTo = anonymizeStaffInfo(sanitized.assignedTo, viewer);
  }
  if (sanitized?.activities && !canViewStaffOnlyComments(viewer.role)) {
    sanitized.activities = sanitized.activities
      .filter(
        (activity) =>
          !["ASSIGNED", "UNASSIGNED", "TAGGED", "UNTAGGED"].includes(activity.action),
      )
      .filter((activity) => activity.author !== null)
      .map((activity) => ({
        ...activity,
        author: anonymizeStaffInfo(activity.author, viewer),
      }));
  }
  return sanitized;
};
