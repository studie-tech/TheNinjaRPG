import { z } from "zod";

// Schema for poll option
export const pollOptionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string().trim().max(255),
  }),
  z.object({
    type: z.literal("user"),
    userId: z.string().trim().min(1, "Select a user"),
    username: z.string().trim().min(1, "Select a user").max(255),
  }),
]);

export type PollOptionSchema = z.infer<typeof pollOptionSchema>;

// Schema for creating a new poll
export const createPollSchema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().min(3).max(10000),
  options: z
    .array(pollOptionSchema)
    .transform((options) =>
      options.filter((option) => option.type === "user" || option.text.length > 0),
    )
    .pipe(z.array(pollOptionSchema).min(2, "Add at least two non-empty poll options")),
  allowCustomOptions: z.boolean().prefault(false),
  endDate: z.date().optional(),
});

export type CreatePollSchema = z.infer<typeof createPollSchema>;

// Schema for updating a poll
export const updatePollSchema = z.object({
  id: z.string(),
  title: z.string().min(3).max(255).optional(),
  description: z.string().min(3).max(10000).optional(),
  allowCustomOptions: z.boolean().optional(),
  isActive: z.boolean().optional(),
  endDate: z.date().optional().nullable(),
});

export type UpdatePollSchema = z.infer<typeof updatePollSchema>;

// Schema for adding a custom option to a poll
export const addPollOptionSchema = z.discriminatedUnion("type", [
  z.object({
    pollId: z.string(),
    type: z.literal("text"),
    text: z.string().min(1).max(255),
  }),
  z.object({
    pollId: z.string(),
    type: z.literal("user"),
    userId: z.string(),
    username: z.string(),
  }),
]);

export type AddPollOptionSchema = z.infer<typeof addPollOptionSchema>;
