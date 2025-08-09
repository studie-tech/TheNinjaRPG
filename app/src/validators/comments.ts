import { z } from "zod";

export const mutateCommentSchema = z
  .object({
    comment: z.string().min(4).max(5000),
    object_id: z.string(),
    quoteIds: z.array(z.string()).optional().nullable(),
    senderId: z.string().optional().nullable(),
  })
  .strict()
  .required();

export type MutateCommentSchema = z.infer<typeof mutateCommentSchema>;

export const deleteCommentSchema = z
  .object({
    id: z.string(),
  })
  .strict()
  .required();

export type DeleteCommentSchema = z.infer<typeof deleteCommentSchema>;

export const createConversationSchema = z
  .object({
    title: z.string().min(4).max(100),
    comment: z.string().min(4).max(5000),
    users: z.array(z.string()).min(1).max(5),
    senderId: z.string().optional().nullable(),
  })
  .strict()
  .required();

export type CreateConversationSchema = z.infer<typeof createConversationSchema>;

export const mutateContentSchema = z
  .object({ content: z.string().min(2).max(10000) })
  .strict()
  .required();

export type MutateContentSchema = z.infer<typeof mutateContentSchema>;
