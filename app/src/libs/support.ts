import type {
  SupportTicketActivityAction,
  SupportTicketCategory,
  SupportTicketPriority,
  SupportTicketStatus,
} from "@/drizzle/constants";
import { IMG_AVATAR_DEFAULT, SUPPORT_TICKET_COLORS } from "@/drizzle/constants";
import type { SupportTicket, UserData } from "@/drizzle/schema";
import type { UserCard } from "@/queries/userColumns";
import type { UpdateSupportTicketSchema } from "@/validators/support";

/** Hide staff identity from regular users. */
export const anonymizeStaffInfo = (user: UserCard, viewer: UserData) => {
  if (viewer.role === "USER" && user.role !== "USER") {
    return {
      userId: user.userId,
      username: "Staff Member",
      avatar: IMG_AVATAR_DEFAULT,
      role: "USER" as const,
      level: 1,
      rank: "STUDENT" as const,
      isOutlaw: false,
      federalStatus: "NONE" as const,
    };
  }
  return user;
};

/** Resolve a validated ticket priority to its configured display colour. */
export const getPriorityColor = (priority: SupportTicketPriority) => {
  return SUPPORT_TICKET_COLORS.PRIORITY[priority];
};

/** Resolve a validated ticket category to its configured display colour. */
export const getCategoryColor = (category: SupportTicketCategory) => {
  return SUPPORT_TICKET_COLORS.CATEGORY[category];
};

/** Resolve a validated ticket status to its configured display colour. */
export const getStatusColor = (status: SupportTicketStatus) => {
  return SUPPORT_TICKET_COLORS.STATUS[status];
};

/** Statuses in which a ticket counts as closed */
const CLOSED_TICKET_STATUSES: SupportTicketStatus[] = ["RESOLVED", "CLOSED"];

/**
 * The ticket's closedAt after a status change: stamped when it first resolves or closes,
 * kept when it moves between RESOLVED and CLOSED, cleared when it is reopened.
 */
export const getNextClosedAt = (
  fromStatus: SupportTicketStatus,
  toStatus: SupportTicketStatus | undefined,
  closedAt: Date | null,
  now: Date,
): Date | null => {
  if (!toStatus || toStatus === fromStatus) return closedAt;
  if (!CLOSED_TICKET_STATUSES.includes(toStatus)) return null;
  return CLOSED_TICKET_STATUSES.includes(fromStatus) && closedAt ? closedAt : now;
};

/**
 * The status a support ticket moves to after a comment, or undefined to keep it.
 * A staff reply (from anyone but the creator) puts an active ticket in progress. A
 * creator reply hands a ticket staff already picked up back to them; an OPEN ticket
 * stays OPEN so it still reads as unanswered. Resolved and closed tickets never move.
 */
export const getStatusAfterComment = (
  status: SupportTicketStatus,
  commenter: { isCreator: boolean; isStaff: boolean },
): SupportTicketStatus | undefined => {
  if (CLOSED_TICKET_STATUSES.includes(status)) return undefined;
  if (commenter.isCreator) {
    return status === "IN_PROGRESS" || status === "WAITING_FOR_USER"
      ? "WAITING_FOR_STAFF"
      : undefined;
  }
  if (commenter.isStaff && status !== "IN_PROGRESS") return "IN_PROGRESS";
  return undefined;
};

export type SupportTicketActivityEntry = {
  action: SupportTicketActivityAction;
  oldValue?: string;
  newValue?: string;
  metadata?: Record<string, string>;
};

/**
 * Activity log entries for every field a ticket update actually changes
 */
export const getTicketUpdateActivities = (
  ticket: Pick<
    SupportTicket,
    | "status"
    | "priority"
    | "category"
    | "assignedToUserId"
    | "isPublic"
    | "tags"
    | "description"
  >,
  update: UpdateSupportTicketSchema,
): SupportTicketActivityEntry[] => {
  const activities: SupportTicketActivityEntry[] = [];
  if (update.status && update.status !== ticket.status) {
    activities.push({
      action: "STATUS_CHANGED",
      oldValue: ticket.status,
      newValue: update.status,
    });
  }
  if (update.priority && update.priority !== ticket.priority) {
    activities.push({
      action: "PRIORITY_CHANGED",
      oldValue: ticket.priority,
      newValue: update.priority,
    });
  }
  if (update.category && update.category !== ticket.category) {
    activities.push({
      action: "CATEGORY_CHANGED",
      oldValue: ticket.category,
      newValue: update.category,
    });
  }
  if (update.assignedToUserId && update.assignedToUserId !== ticket.assignedToUserId) {
    activities.push({
      action: "ASSIGNED",
      oldValue: ticket.assignedToUserId || undefined,
      newValue: update.assignedToUserId,
    });
  }
  if (update.isPublic !== undefined && update.isPublic !== ticket.isPublic) {
    activities.push({
      action: "UPDATED",
      oldValue: ticket.isPublic ? "public" : "private",
      newValue: update.isPublic ? "public" : "private",
      metadata: { field: "isPublic" },
    });
  }
  if (update.tags) {
    const before = new Set(ticket.tags);
    const after = new Set(update.tags);
    for (const tag of after) {
      if (!before.has(tag)) activities.push({ action: "TAGGED", newValue: tag });
    }
    for (const tag of before) {
      if (!after.has(tag)) activities.push({ action: "UNTAGGED", oldValue: tag });
    }
  }
  if (update.description !== undefined && update.description !== ticket.description) {
    activities.push({ action: "UPDATED", metadata: { field: "description" } });
  }
  return activities;
};
