import { z } from "zod";
import { nanoid } from "nanoid";
import { eq, and, or, desc, asc, like, sql, inArray, gte, lte } from "drizzle-orm";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { errorResponse, baseServerResponse } from "@/server/api/trpc";
import {
  supportTicket,
  supportTicketActivity,
  conversation,
  conversationComment,
  cannedResponse,
} from "@/drizzle/schema";
import {
  createSupportTicketSchema,
  updateSupportTicketSchema,
  supportTicketFilterSchema,
  supportTicketMetricsSchema,
  escalateToGithubSchema,
  type SupportTicketFilteringSchema,
} from "@/validators/support";
import type { SupportTicketActivityAction } from "@/drizzle/constants";
import { anonymizeStaffInfo } from "@/libs/support";
import {
  canViewSupportTicket,
  canEditSupportTicket,
  canDeleteSupportTicket,
  canAssignSupportTicket,
  canViewStaffOnlyComments,
  canTransitionStatus,
  canViewSupportStatistics,
  canEditCannedResponses,
  canEscalateToGithub,
} from "@/utils/permissions";
import { GITHUB_API_ENDPOINT } from "@/drizzle/constants";
import { createConvo } from "@/server/api/routers/comments";
import { reduceByKey } from "@/utils/grouping";
import { fetchUser } from "@/server/api/routers/profile";
import type { UserData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

export const supportRouter = createTRPCRouter({
  // Get all support tickets with filtering
  getTickets: protectedProcedure
    .input(supportTicketFilterSchema)
    .query(async ({ ctx, input }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Pagination handling
      const currentCursor = input.cursor ? input.cursor : 0;
      const limit = input.limit;
      const skip = currentCursor * limit;
      const isStaff = user.role !== "USER";
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

      const nextCursor = tickets.length < limit ? null : currentCursor + 1;

      return { data: processedTickets, nextCursor };
    }),

  // Get a specific support ticket
  getTicket: protectedProcedure
    .input(z.object({ ticketId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);

      const ticket = await getSupportTicketWithRelations(ctx.drizzle, input.ticketId);

      if (!ticket) {
        throw new Error("Ticket not found");
      }

      if (!canViewSupportTicket(ticket, ctx.userId, user.role)) {
        throw new Error("Access denied");
      }

      // Sanitize ticket for public view if user is not staff
      if (!user.role || !["ADMIN", "MODERATOR", "SUPPORTER"].includes(user.role)) {
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
      await Promise.all([
        ctx.drizzle.insert(supportTicket).values({
          id: ticketId,
          title: input.title,
          description: input.description,
          category: input.category,
          priority: input.priority,
          isPublic: input.isPublic,
          tags: input.tags,
          createdByUserId: ctx.userId,
          conversationId: convoId,
        }),
        createConvo({
          client: ctx.drizzle,
          senderUserId: ctx.userId,
          receiverUserIds: [],
          title: input.title,
          content: input.description,
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
    .input(z.object({ ticketId: z.string() }).merge(updateSupportTicketSchema))
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

      // Create activity logs for changed fields
      const activities: Array<{
        action: SupportTicketActivityAction;
        oldValue?: string;
        newValue?: string;
      }> = [];
      if (updateData.status && updateData.status !== ticket.status) {
        activities.push({
          action: "STATUS_CHANGED",
          oldValue: ticket.status,
          newValue: updateData.status,
        });
      }
      if (updateData.priority && updateData.priority !== ticket.priority) {
        activities.push({
          action: "PRIORITY_CHANGED",
          oldValue: ticket.priority,
          newValue: updateData.priority,
        });
      }
      if (updateData.category && updateData.category !== ticket.category) {
        activities.push({
          action: "CATEGORY_CHANGED",
          oldValue: ticket.category,
          newValue: updateData.category,
        });
      }
      if (
        updateData?.assignedToUserId &&
        updateData?.assignedToUserId !== ticket.assignedToUserId
      ) {
        activities.push({
          action:
            updateData.assignedToUserId && !ticket.assignedToUserId
              ? "ASSIGNED"
              : !updateData.assignedToUserId && ticket.assignedToUserId
                ? "UNASSIGNED"
                : "ASSIGNED",
          oldValue: ticket.assignedToUserId || undefined,
          newValue: updateData.assignedToUserId || undefined,
        });
      }
      // Update ticket
      await Promise.all([
        ctx.drizzle
          .update(supportTicket)
          .set({
            ...updateData,
            updatedAt: new Date(),
            closedAt: updateData.status === "RESOLVED" ? new Date() : ticket.closedAt,
          })
          .where(eq(supportTicket.id, ticketId)),
        ...(activities.length > 0
          ? activities.map((activity) =>
              createSupportTicketActivity(
                ctx.drizzle,
                ticketId,
                ctx.userId,
                activity.action,
                activity.oldValue,
                activity.newValue,
              ),
            )
          : []),
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
        ctx.drizzle
          .delete(conversation)
          .where(eq(conversation.id, ticket.conversationId)),
        ctx.drizzle
          .delete(conversationComment)
          .where(eq(conversationComment.conversationId, ticket.conversationId)),
        ctx.drizzle
          .delete(supportTicketActivity)
          .where(eq(supportTicketActivity.ticketId, input.ticketId)),
        ctx.drizzle.delete(supportTicket).where(eq(supportTicket.id, input.ticketId)),
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
        throw new Error("Access denied");
      }
      // Destructure
      const dateFrom = input.dateFrom
        ? new Date(input.dateFrom)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const dateTo = input.dateTo ? new Date(input.dateTo) : new Date();

      /* Build conditions for queries (for re-use) */
      const baseConds = [
        ...(dateFrom ? [gte(supportTicket.createdAt, dateFrom)] : []),
        ...(dateTo ? [lte(supportTicket.createdAt, dateTo)] : []),
        ...(input.assignedToUserId
          ? [eq(supportTicket.assignedToUserId, input.assignedToUserId)]
          : []),
        ...(input.category ? [eq(supportTicket.category, input.category)] : []),
      ];
      const whereClause = baseConds.length > 0 ? and(...baseConds) : undefined;
      // Run queries pass 2 if all guards passed
      const [
        totalResult,
        openResult,
        resolvedResult,
        assignedToCurrentUserResult,
        categoryResult,
        priorityResult,
        statusResult,
        assigneeResult,
        metrics,
      ] = await Promise.all([
        // Total tickets
        ctx.drizzle
          .select({ count: sql<number>`count(*)` })
          .from(supportTicket)
          .where(whereClause),
        // Open tickets
        ctx.drizzle
          .select({ count: sql<number>`count(*)` })
          .from(supportTicket)
          .where(
            and(
              eq(supportTicket.status, "OPEN"),
              ...(baseConds.length > 0 ? [and(...baseConds)] : []),
            ),
          ),
        // Resolved tickets
        ctx.drizzle
          .select({ count: sql<number>`count(*)` })
          .from(supportTicket)
          .where(
            and(
              eq(supportTicket.status, "RESOLVED"),
              ...(baseConds.length > 0 ? [and(...baseConds)] : []),
            ),
          ),
        // Tickets assigned to current user
        ctx.drizzle
          .select({ count: sql<number>`count(*)` })
          .from(supportTicket)
          .where(
            and(
              eq(supportTicket.assignedToUserId, ctx.userId),
              ...(baseConds.length > 0 ? [and(...baseConds)] : []),
            ),
          ),
        // Tickets by category
        ctx.drizzle
          .select({ category: supportTicket.category, count: sql<number>`count(*)` })
          .from(supportTicket)
          .where(whereClause)
          .groupBy(supportTicket.category),
        // Tickets by priority
        ctx.drizzle
          .select({ priority: supportTicket.priority, count: sql<number>`count(*)` })
          .from(supportTicket)
          .where(whereClause)
          .groupBy(supportTicket.priority),
        // Tickets by status
        ctx.drizzle
          .select({ status: supportTicket.status, count: sql<number>`count(*)` })
          .from(supportTicket)
          .where(whereClause)
          .groupBy(supportTicket.status),
        // Tickets by assignee
        ctx.drizzle
          .select({
            assignedToUserId: supportTicket.assignedToUserId,
            count: sql<number>`count(*)`,
          })
          .from(supportTicket)
          .where(whereClause)
          .groupBy(supportTicket.assignedToUserId),
        // Metrics (average response etc.)
        calculateSupportMetrics(ctx.drizzle, dateFrom, dateTo),
      ]);

      /* Transform results */
      const totalTickets = totalResult[0]?.count ?? 0;
      const openTickets = openResult[0]?.count ?? 0;
      const resolvedTickets = resolvedResult[0]?.count ?? 0;
      const assignedToCurrentUser = assignedToCurrentUserResult[0]?.count ?? 0;
      const ticketsByCategory = reduceByKey(categoryResult, "category");
      const ticketsByPriority = reduceByKey(priorityResult, "priority");
      const ticketsByStatus = reduceByKey(statusResult, "status");
      const ticketsByAssignee = reduceByKey(assigneeResult, "assignedToUserId");

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
    const responses = await ctx.drizzle
      .select()
      .from(cannedResponse)
      .orderBy(desc(cannedResponse.createdAt));
    return responses;
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
      await ctx.drizzle.insert(cannedResponse).values({
        id,
        title: input.title,
        description: input.description,
        createdByUserId: ctx.userId,
      });

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
      await ctx.drizzle
        .update(cannedResponse)
        .set({
          title: input.title,
          description: input.description,
          updatedAt: new Date(),
        })
        .where(eq(cannedResponse.id, input.id));

      return { success: true, message: "Canned response updated successfully" };
    }),

  deleteCannedResponse: protectedProcedure
    .input(z.object({ id: z.string() }))
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

      await ctx.drizzle.delete(cannedResponse).where(eq(cannedResponse.id, input.id));

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
      try {
        // Get all conversation comments to include in the GitHub issue
        const comments = await ctx.drizzle.query.conversationComment.findMany({
          where: eq(conversationComment.conversationId, ticket.conversationId),
          with: {
            user: {
              columns: {
                username: true,
                role: true,
              },
            },
          },
          orderBy: asc(conversationComment.createdAt),
        });

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

        // Create GitHub issue
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
              ticket.category.toLowerCase(),
              ticket.priority.toLowerCase(),
            ],
          }),
        });

        if (!githubResponse.ok) {
          const errorData = (await githubResponse.json()) as { message?: string };
          console.error("GitHub API Error:", errorData);
          return errorResponse("Failed to create GitHub issue");
        }

        const githubIssue = (await githubResponse.json()) as {
          html_url: string;
          number: number;
        };
        const githubIssueUrl = githubIssue.html_url;

        // Update ticket with GitHub issue URL
        await Promise.all([
          ctx.drizzle
            .update(supportTicket)
            .set({
              githubIssueUrl,
              updatedAt: new Date(),
            })
            .where(eq(supportTicket.id, ticket.id)),
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
      } catch {
        return errorResponse("Failed to escalate ticket to GitHub");
      }
    }),
});

/**
 * Fetch a canned response
 * @param client - The database client
 * @param id - The ID of the canned response to fetch
 * @returns The canned response
 */
export const fetchCannedResponse = async (client: DrizzleClient, id: string) => {
  return await client.query.cannedResponse.findFirst({
    where: eq(cannedResponse.id, id),
  });
};

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
  const ticket = await client.query.supportTicket.findFirst({
    where: eq(supportTicket.id, ticketId),
    with: {
      createdBy: {
        columns: {
          userId: true,
          username: true,
          avatar: true,
          level: true,
          rank: true,
          isOutlaw: true,
          role: true,
          federalStatus: true,
        },
      },
      assignedTo: {
        columns: {
          userId: true,
          username: true,
          avatar: true,
          level: true,
          rank: true,
          isOutlaw: true,
          role: true,
          federalStatus: true,
        },
      },
      activities: {
        with: {
          author: {
            columns: {
              userId: true,
              username: true,
              avatar: true,
              level: true,
              rank: true,
              isOutlaw: true,
              role: true,
              federalStatus: true,
            },
          },
        },
        orderBy: desc(supportTicketActivity.createdAt),
      },
    },
  });

  return ticket || null;
};
export type SupportTicketWithRelations = Awaited<
  ReturnType<typeof getSupportTicketWithRelations>
>;

/**
 * Get support tickets with relations. Abstracted out in case we need it for AI integration.
 * @param client - The database client
 * @param skip - The number of tickets to skip
 * @param limit - The maximum number of tickets to return
 * @param filters - The filters to apply to the tickets
 * @param isStaff - Whether the user is staff
 * @param userId - The ID of the user
 * @returns The tickets with relations
 */
export const getSupportTicketsWithRelations = async (info: {
  client: DrizzleClient;
  skip: number;
  limit: number;
  filters: SupportTicketFilteringSchema;
  isStaff: boolean;
  userId: string;
}) => {
  const { client, skip, limit, filters, isStaff, userId } = info;
  const tickets = await client.query.supportTicket.findMany({
    where: (() => {
      const conds = [
        ...(filters.status && filters.status.length > 0
          ? [inArray(supportTicket.status, filters.status)]
          : []),
        ...(filters.category && filters.category.length > 0
          ? [inArray(supportTicket.category, filters.category)]
          : []),
        ...(filters.priority && filters.priority.length > 0
          ? [inArray(supportTicket.priority, filters.priority)]
          : []),
        ...(filters.assignedToUserId
          ? [eq(supportTicket.assignedToUserId, filters.assignedToUserId)]
          : []),
        ...(filters.createdByUserId
          ? [eq(supportTicket.createdByUserId, filters.createdByUserId)]
          : []),
        ...(filters.isPublic !== undefined
          ? [eq(supportTicket.isPublic, filters.isPublic)]
          : []),
        ...(filters.search
          ? [
              or(
                like(supportTicket.title, `%${filters.search}%`),
                like(supportTicket.description, `%${filters.search}%`),
              ),
            ]
          : []),
        ...(filters.dateFrom
          ? [gte(supportTicket.createdAt, new Date(filters.dateFrom))]
          : []),
        ...(filters.dateTo
          ? [lte(supportTicket.createdAt, new Date(filters.dateTo))]
          : []),
        ...(filters.tags && filters.tags.length > 0
          ? [
              or(
                ...filters.tags.map(
                  (tag) =>
                    sql`JSON_CONTAINS(${supportTicket.tags}, ${JSON.stringify(tag)})`,
                ),
              ),
            ]
          : []),
        ...(!isStaff
          ? [
              or(
                eq(supportTicket.createdByUserId, userId),
                eq(supportTicket.isPublic, true),
              ),
            ]
          : []),
      ];
      return conds.length > 0 ? and(...conds) : undefined;
    })(),
    with: {
      createdBy: {
        columns: {
          userId: true,
          username: true,
          avatar: true,
          level: true,
          rank: true,
          isOutlaw: true,
          role: true,
          federalStatus: true,
        },
      },
      assignedTo: {
        columns: {
          userId: true,
          username: true,
          avatar: true,
          level: true,
          rank: true,
          isOutlaw: true,
          role: true,
          federalStatus: true,
        },
      },
    },
    orderBy: (() => {
      const orderByField =
        filters.orderBy === "createdAt"
          ? supportTicket.createdAt
          : filters.orderBy === "updatedAt"
            ? supportTicket.updatedAt
            : filters.orderBy === "priority"
              ? supportTicket.priority
              : filters.orderBy === "status"
                ? supportTicket.status
                : supportTicket.createdAt;

      return filters.orderDirection === "asc" ? asc(orderByField) : desc(orderByField);
    })(),
    limit: limit,
    offset: skip,
  });
  return tickets;
};
export type SupportTicketsWithRelations = Awaited<
  ReturnType<typeof getSupportTicketsWithRelations>
>;

/**
 * Create a support ticket activity
 * @param client - The database client
 * @param ticketId - The ID of the ticket
 * @param authorId - The ID of the author
 * @param action - The action to create
 * @param oldValue - The old value
 * @param newValue - The new value
 * @param metadata - The metadata
 */
export const createSupportTicketActivity = async (
  client: DrizzleClient,
  ticketId: string,
  authorId: string,
  action: SupportTicketActivityAction,
  oldValue?: string,
  newValue?: string,
  metadata?: Record<string, any>,
) => {
  await client.insert(supportTicketActivity).values({
    id: nanoid(),
    ticketId,
    authorId,
    action,
    oldValue,
    newValue,
    metadata: metadata || {},
  });
};

/**
 * Calculate support metrics
 * @param client - The database client
 * @param dateFrom - The start date
 * @param dateTo - The end date
 * @returns The support metrics
 */
export const calculateSupportMetrics = async (
  client: DrizzleClient,
  dateFrom: Date,
  dateTo: Date,
) => {
  const tickets = await client.query.supportTicket.findMany({
    where: and(
      gte(supportTicket.createdAt, dateFrom),
      lte(supportTicket.createdAt, dateTo),
    ),
    with: {
      conversation: {
        columns: { id: true },
        with: {
          comments: {
            columns: { id: true, createdAt: true },
            with: {
              user: {
                columns: {
                  role: true,
                },
              },
            },
            orderBy: (table, { asc }) => asc(table.createdAt),
          },
        },
      },
    },
  });

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
  console.log(totalResponseTime);
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
      .map((activity) => ({
        ...activity,
        author: anonymizeStaffInfo(activity.author, viewer),
      }));
  }
  return sanitized;
};
