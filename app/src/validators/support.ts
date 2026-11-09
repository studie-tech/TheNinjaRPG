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
