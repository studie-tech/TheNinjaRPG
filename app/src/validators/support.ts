import { z } from "zod";
import {
  SupportTicketCategories,
  SupportTicketPriorities,
  SupportTicketStatuses,
} from "@/drizzle/constants";

// Create Support Ticket Schema
export const createSupportTicketSchema = z.object({
  title: z
    .string()
    .min(10, "Title must be at least 10 characters")
    .max(255, "Title cannot exceed 255 characters"),
  description: z
    .string()
    .min(50, "Description must be at least 50 characters")
    .max(5000, "Description cannot exceed 5000 characters"),
  category: z.enum(SupportTicketCategories),
  priority: z.enum(SupportTicketPriorities).prefault("MEDIUM"),
  isPublic: z.boolean().prefault(false),
  tags: z.array(z.string()).prefault([]),
});

// Update Support Ticket Schema (staff only)
export const updateSupportTicketSchema = z.object({
  category: z.enum(SupportTicketCategories).optional(),
  priority: z.enum(SupportTicketPriorities).optional(),
  status: z.enum(SupportTicketStatuses).optional(),
  isPublic: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  assignedToUserId: z.string().optional(),
});

// Escalate to GitHub Schema
export const escalateToGithubSchema = z.object({
  ticketId: z.string(),
});

// Create Support Ticket Comment Schema
export const createSupportTicketCommentSchema = z.object({
  content: z
    .string()
    .min(1, "Comment cannot be empty")
    .max(5000, "Comment cannot exceed 5000 characters"),
  isStaffOnly: z.boolean().prefault(false),
  isResolution: z.boolean().prefault(false),
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
  offset: z.number().min(0).prefault(0),
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
  groupBy: z.enum(["day", "week", "month"]).prefault("day"),
  category: z.enum(SupportTicketCategories).optional(),
  assignedToUserId: z.string().optional(),
});
