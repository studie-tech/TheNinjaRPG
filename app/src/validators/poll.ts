import { z } from "zod";

// Schema for poll option
export const pollOptionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("user"),
    userId: z.string(),
    username: z.string(),
  }),
]);

export type PollOptionSchema = z.infer<typeof pollOptionSchema>;

// Schema for creating a new poll
export const createPollSchema = z.object({
  title: z.string().min(3).max(255),
  description: z.string().min(3).max(10000),
  options: z.array(pollOptionSchema).min(2),
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

// Schema for voting in a poll
export const votePollSchema = z.object({
  pollId: z.string(),
  optionId: z.string(),
});

export type VotePollSchema = z.infer<typeof votePollSchema>;

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

// Schema for getting polls with pagination
export const getPollsSchema = z.object({
  cursor: z.number().nullish(),
  limit: z.number().min(1).max(100).prefault(10),
  includeInactive: z.boolean().prefault(false),
});

export type GetPollsSchema = z.infer<typeof getPollsSchema>;

// Schema for retracting a vote from a poll
export const retractVoteSchema = z.object({
  pollId: z.string(),
});

export type RetractVoteSchema = z.infer<typeof retractVoteSchema>;

// Schema for closing a poll
export const closePollSchema = z.object({
  id: z.string(),
  isActive: z.boolean(),
});

export type ClosePollSchema = z.infer<typeof closePollSchema>;

// Schema for deleting a poll option
export const deletePollOptionSchema = z.object({
  pollId: z.string(),
  optionId: z.string(),
});

export type DeletePollOptionSchema = z.infer<typeof deletePollOptionSchema>;
