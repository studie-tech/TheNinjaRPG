/**
 * Database access for support; authorization and transaction scopes stay in callers.
 */

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  like,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  MAX_DAILY_AI_CALLS,
  type SupportTicketActivityAction,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "@/drizzle/constants";
import {
  cannedResponse,
  conversation,
  conversationComment,
  supportTicket,
  supportTicketActivity,
  userData,
} from "@/drizzle/schema";
import { getNextClosedAt } from "@/libs/support";
import { userCardColumns } from "@/queries/userColumns";
import type { DrizzleClient } from "@/server/db";

/** Build the `userData` update for `POST`, setting `aiCalls`, using predicates on `userId` and `aiCalls`. */
export const updateUserDataForPOST = (
  client: Pick<DrizzleClient, "update">,
  userId: string,
) =>
  client
    .update(userData)
    .set({
      aiCalls: sql`${userData.aiCalls} + 1`,
    })
    .where(and(eq(userData.userId, userId), lte(userData.aiCalls, MAX_DAILY_AI_CALLS)));

/** Build the `supportTicket` lookup for `handleIssueClosed`, using predicates on `githubIssueUrl`. */
export const findSupportTicketForHandleIssueClosed = (
  client: Pick<DrizzleClient, "query">,
  issueUrl: string,
) =>
  client.query.supportTicket.findFirst({
    where: eq(supportTicket.githubIssueUrl, issueUrl),
  });

/** Build the `supportTicket` update for `handleIssueClosed`, using predicates on `id`. */
export const updateSupportTicketForHandleIssueClosed = (
  client: Pick<DrizzleClient, "update">,
  ticket: { id: string },
) =>
  client
    .update(supportTicket)
    .set({
      status: "RESOLVED",
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(supportTicket.id, ticket.id));

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

/** Build the `supportTicket` insert for `createTicket`. */
export const insertSupportTicketForCreateTicket = (
  client: Pick<DrizzleClient, "insert">,
  ticketId: string,
  input: {
    title: string;
    category: SupportTicketCategory;
    priority: SupportTicketPriority;
    isPublic: false | true;
    tags: string[];
  },
  sanitizedDescription: string,
  ctx: { userId: string },
  convoId: string,
) =>
  client.insert(supportTicket).values({
    id: ticketId,
    title: input.title,
    description: sanitizedDescription,
    category: input.category,
    priority: input.priority,
    isPublic: input.isPublic,
    tags: input.tags,
    createdByUserId: ctx.userId,
    conversationId: convoId,
  });

/** Build the `supportTicket` update for `updateTicket`, setting `updatedAt` and `closedAt`, using predicates on `id`. */
export const updateSupportTicketForUpdateTicket = (
  client: Pick<DrizzleClient, "update">,
  ticketUpdate: {
    category?: SupportTicketCategory | undefined;
    priority?: SupportTicketPriority | undefined;
    status?: SupportTicketStatus | undefined;
    isPublic?: undefined | false | true;
    tags?: undefined | string[];
    assignedToUserId?: undefined | string;
  },
  cleanDescription: undefined | string,
  now: Date,
  ticket: {
    status: SupportTicketStatus;
    closedAt: null | Date;
  },
  updateData: {
    status?: SupportTicketStatus | undefined;
  },
  ticketId: string,
) =>
  client
    .update(supportTicket)
    .set({
      ...ticketUpdate,
      ...(cleanDescription !== undefined ? { description: cleanDescription } : {}),
      updatedAt: now,
      closedAt: getNextClosedAt(ticket.status, updateData.status, ticket.closedAt, now),
    })
    .where(eq(supportTicket.id, ticketId));

/** Build the `conversation` update for `updateTicket`, setting `isPublic`, using predicates on `id`. */
export const updateConversationForUpdateTicket = (
  client: Pick<DrizzleClient, "update">,
  updateData: { isPublic: false | true },
  ticket: { conversationId: string },
) =>
  client
    .update(conversation)
    .set({ isPublic: updateData.isPublic })
    .where(eq(conversation.id, ticket.conversationId));

/** Build the `conversation` deletion for `deleteTicket`, using predicates on `id`. */
export const deleteConversationForDeleteTicket = (
  client: Pick<DrizzleClient, "delete">,
  ticket: { conversationId: string },
) => client.delete(conversation).where(eq(conversation.id, ticket.conversationId));

/** Build the `conversationComment` deletion for `deleteTicket`, using predicates on `conversationId`. */
export const deleteConversationCommentForDeleteTicket = (
  client: Pick<DrizzleClient, "delete">,
  ticket: { conversationId: string },
) =>
  client
    .delete(conversationComment)
    .where(eq(conversationComment.conversationId, ticket.conversationId));

/** Build the `supportTicketActivity` deletion for `deleteTicket`, using predicates on `ticketId`. */
export const deleteSupportTicketActivityForDeleteTicket = (
  client: Pick<DrizzleClient, "delete">,
  input: { ticketId: string },
) =>
  client
    .delete(supportTicketActivity)
    .where(eq(supportTicketActivity.ticketId, input.ticketId));

/** Build the `supportTicket` deletion for `deleteTicket`, using predicates on `id`. */
export const deleteSupportTicketForDeleteTicket = (
  client: Pick<DrizzleClient, "delete">,
  input: { ticketId: string },
) => client.delete(supportTicket).where(eq(supportTicket.id, input.ticketId));

/** Build the `supportTicket` selection for `getStatistics`, using the configured predicates. */
export const selectSupportTicketForGetStatistics = (
  client: Pick<DrizzleClient, "select">,
  whereClause: undefined | SQL<unknown>,
) =>
  client
    .select({ category: supportTicket.category, count: count() })
    .from(supportTicket)
    .where(whereClause)
    .groupBy(supportTicket.category);

/** Build the `supportTicket` selection for `getStatistics`, using the configured predicates. */
export const selectSupportTicketForGetStatistics2 = (
  client: Pick<DrizzleClient, "select">,
  whereClause: undefined | SQL<unknown>,
) =>
  client
    .select({ priority: supportTicket.priority, count: count() })
    .from(supportTicket)
    .where(whereClause)
    .groupBy(supportTicket.priority);

/** Build the `supportTicket` selection for `getStatistics`, using the configured predicates. */
export const selectSupportTicketForGetStatistics3 = (
  client: Pick<DrizzleClient, "select">,
  whereClause: undefined | SQL<unknown>,
) =>
  client
    .select({ status: supportTicket.status, count: count() })
    .from(supportTicket)
    .where(whereClause)
    .groupBy(supportTicket.status);

/** Build the `supportTicket` selection for `getStatistics`, using the configured predicates. */
export const selectSupportTicketForGetStatistics4 = (
  client: Pick<DrizzleClient, "select">,
  whereClause: undefined | SQL<unknown>,
) =>
  client
    .select({
      assignedToUserId: supportTicket.assignedToUserId,
      count: count(),
    })
    .from(supportTicket)
    .where(whereClause)
    .groupBy(supportTicket.assignedToUserId);

/** Build the `cannedResponse` selection for `getCannedResponses`. */
export const selectCannedResponseForGetCannedResponses = (
  client: Pick<DrizzleClient, "select">,
) => client.select().from(cannedResponse).orderBy(desc(cannedResponse.createdAt));

/** Build the `cannedResponse` insert for `createCannedResponse`. */
export const insertCannedResponseForCreateCannedResponse = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  input: { title: string; description: string },
  ctx: { userId: string },
) =>
  client.insert(cannedResponse).values({
    id,
    title: input.title,
    description: input.description,
    createdByUserId: ctx.userId,
  });

/** Build the `cannedResponse` update for `updateCannedResponse`, using predicates on `id`. */
export const updateCannedResponseForUpdateCannedResponse = (
  client: Pick<DrizzleClient, "update">,
  input: { title: string; description: string; id: string },
) =>
  client
    .update(cannedResponse)
    .set({
      title: input.title,
      description: input.description,
      updatedAt: new Date(),
    })
    .where(eq(cannedResponse.id, input.id));

/** Build the `cannedResponse` deletion for `deleteCannedResponse`, using predicates on `id`. */
export const deleteCannedResponseForDeleteCannedResponse = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(cannedResponse).where(eq(cannedResponse.id, input.id));

/** Build the `conversationComment` listing for `escalateToGithub`, using predicates on `conversationId`. */
export const listConversationCommentForEscalateToGithub = (
  client: Pick<DrizzleClient, "query">,
  ticket: { conversationId: string },
) =>
  client.query.conversationComment.findMany({
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

/**
 * Build the `supportTicket` update for `escalateToGithub`, setting `githubIssueUrl`
 * and `updatedAt`, using predicates on `id`.
 */
export const updateSupportTicketForEscalateToGithub = (
  client: Pick<DrizzleClient, "update">,
  githubIssueUrl: string,
  ticket: { id: string },
) =>
  client
    .update(supportTicket)
    .set({
      githubIssueUrl,
      updatedAt: new Date(),
    })
    .where(eq(supportTicket.id, ticket.id));

/** Build the `supportTicket` lookup for `getSupportTicketWithRelations`, using predicates on `id`. */
export const findSupportTicketForGetSupportTicketWithRelations = (
  client: Pick<DrizzleClient, "query">,
  ticketId: string,
) =>
  client.query.supportTicket.findFirst({
    where: eq(supportTicket.id, ticketId),
    with: {
      createdBy: {
        columns: userCardColumns,
      },
      assignedTo: {
        columns: userCardColumns,
      },
      activities: {
        with: {
          author: {
            columns: userCardColumns,
          },
        },
        orderBy: desc(supportTicketActivity.createdAt),
      },
    },
  });

/**
 * Build the `supportTicket` listing for `getSupportTicketsWithRelations`, including
 * predicates on `status`, `category`, `priority`.
 */
export const listSupportTicketForGetSupportTicketsWithRelations = (
  client: Pick<DrizzleClient, "query">,
  filters: {
    status?: undefined | SupportTicketStatus[];
    category?: undefined | SupportTicketCategory[];
    priority?: undefined | SupportTicketPriority[];
    assignedToUserId?: undefined | null | string;
    createdByUserId?: undefined | string;
    isPublic?: undefined | false | true;
    search?: undefined | string;
    dateFrom?: undefined | string;
    dateTo?: undefined | string;
    tags?: undefined | string[];
    orderBy: "status" | "createdAt" | "updatedAt" | "priority";
    orderDirection: "desc" | "asc";
  },
  isStaff: false | true,
  userId: string,
  limit: number,
  skip: number,
) =>
  client.query.supportTicket.findMany({
    where: and(
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
    ),
    with: {
      createdBy: {
        columns: userCardColumns,
      },
      assignedTo: {
        columns: userCardColumns,
      },
    },
    orderBy: (filters.orderDirection === "asc" ? asc : desc)(
      supportTicket[filters.orderBy],
    ),
    limit: limit,
    offset: skip,
  });

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

/** Build the `supportTicket` listing for `calculateSupportMetrics`, using the configured predicates. */
export const listSupportTicketForCalculateSupportMetrics = (
  client: Pick<DrizzleClient, "query">,
  whereClause: undefined | SQL<unknown>,
) =>
  client.query.supportTicket.findMany({
    where: whereClause,
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
