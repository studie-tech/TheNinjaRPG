import { z } from "zod";
import {
  SUPPORT_TICKET_LIMITS,
  SupportTicketCategories,
  SupportTicketPriorities,
  SupportTicketStatuses,
} from "@/drizzle/constants";

const {
  TITLE_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  MAX_TAGS,
} = SUPPORT_TICKET_LIMITS;

const ticketDescription = z
  .string()
  .min(
    DESCRIPTION_MIN_LENGTH,
    `Description must be at least ${DESCRIPTION_MIN_LENGTH} characters`,
  )
  .max(
    DESCRIPTION_MAX_LENGTH,
    `Description cannot exceed ${DESCRIPTION_MAX_LENGTH} characters`,
  );

// Create Support Ticket Schema
export const createSupportTicketSchema = z.object({
  title: z
    .string()
    .min(TITLE_MIN_LENGTH, `Title must be at least ${TITLE_MIN_LENGTH} characters`)
    .max(TITLE_MAX_LENGTH, `Title cannot exceed ${TITLE_MAX_LENGTH} characters`),
  description: ticketDescription,
  category: z.enum(SupportTicketCategories),
  priority: z.enum(SupportTicketPriorities).prefault("MEDIUM"),
  isPublic: z.boolean().prefault(false),
  tags: z.array(z.string()).max(MAX_TAGS).prefault([]),
});

// Update Support Ticket Schema (staff only)
export const updateSupportTicketSchema = z.object({
  category: z.enum(SupportTicketCategories).optional(),
  priority: z.enum(SupportTicketPriorities).optional(),
  status: z.enum(SupportTicketStatuses).optional(),
  isPublic: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  assignedToUserId: z.string().optional(),
  description: ticketDescription.optional(),
});

export type UpdateSupportTicketSchema = z.infer<typeof updateSupportTicketSchema>;

// Escalate to GitHub Schema
export const escalateToGithubSchema = z.object({
  ticketId: z.string(),
});

// Support Ticket Filter Schema
export const supportTicketFilterSchema = z.object({
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
export type SupportTicketFilteringSchema = z.infer<typeof supportTicketFilterSchema>;

// Support Ticket Metrics Schema
export const supportTicketMetricsSchema = z.object({
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
  category: z.enum(SupportTicketCategories).optional(),
  assignedToUserId: z.string().optional(),
});
