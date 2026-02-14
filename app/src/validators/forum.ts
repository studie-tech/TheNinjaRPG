import { z } from "zod";

export const forumBoardSchema = z
  .strictObject({
    board_id: z.string(),
    title: z.string().trim().min(10).max(88),
    content: z.string().min(10).max(10000),
    image: z.url().optional().nullable(),
    senderId: z.string().optional().nullable(),
  })
  .required();

export type ForumBoardSchema = z.infer<typeof forumBoardSchema>;
