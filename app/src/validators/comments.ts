import { z } from "zod";
import {
  COMMENT_MAX_LENGTH,
  COMMENT_MIN_LENGTH,
  CONVERSATION_MAX_USERS,
} from "@/drizzle/constants";

export const mutateCommentSchema = z
  .strictObject({
    comment: z.string().min(COMMENT_MIN_LENGTH).max(COMMENT_MAX_LENGTH),
    object_id: z.string(),
    quoteIds: z.array(z.string()).optional().nullable(),
    senderId: z.string().optional().nullable(),
  })
  .required();

export type MutateCommentSchema = z.infer<typeof mutateCommentSchema>;

export const deleteCommentSchema = z.strictObject({
  id: z.string(),
});

export type DeleteCommentSchema = z.infer<typeof deleteCommentSchema>;

export const createConversationSchema = z
  .strictObject({
    title: z.string().min(4).max(100),
    comment: z.string().min(COMMENT_MIN_LENGTH).max(COMMENT_MAX_LENGTH),
    users: z.array(z.string()).min(1).max(CONVERSATION_MAX_USERS),
    senderId: z.string().optional().nullable(),
  })
  .required();

export type CreateConversationSchema = z.infer<typeof createConversationSchema>;

export const mutateContentSchema = z.strictObject({
  content: z.string().min(2).max(10000),
});

export type MutateContentSchema = z.infer<typeof mutateContentSchema>;
