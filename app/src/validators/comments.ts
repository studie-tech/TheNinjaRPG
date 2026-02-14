import { z } from "zod";

export const mutateCommentSchema = z
  .strictObject({
    comment: z.string().min(4).max(5000),
    object_id: z.string(),
    quoteIds: z.array(z.string()).optional().nullable(),
    senderId: z.string().optional().nullable(),
  })
  .required();

export type MutateCommentSchema = z.infer<typeof mutateCommentSchema>;

export const deleteCommentSchema = z
  .strictObject({
    id: z.string(),
  })
  .required();

export type DeleteCommentSchema = z.infer<typeof deleteCommentSchema>;

export const createConversationSchema = z
  .strictObject({
    title: z.string().min(4).max(100),
    comment: z.string().min(4).max(5000),
    users: z.array(z.string()).min(1).max(5),
    senderId: z.string().optional().nullable(),
  })
  .required();

export type CreateConversationSchema = z.infer<typeof createConversationSchema>;

export const mutateContentSchema = z
  .strictObject({ content: z.string().min(2).max(10000) })
  .required();

export type MutateContentSchema = z.infer<typeof mutateContentSchema>;
