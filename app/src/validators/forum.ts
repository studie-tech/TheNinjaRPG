import { z } from "zod";

export const forumBoardSchema = z
  .object({
    board_id: z.string(),
    title: z.string().trim().min(10).max(88),
    content: z.string().min(10).max(10000),
    senderId: z.string().optional().nullable(),
  })
  .strict()
  .required();

export type ForumBoardSchema = z.infer<typeof forumBoardSchema>;
