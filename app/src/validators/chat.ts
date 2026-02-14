import { z } from "zod";

export const chatMessageSchema = z.object({ message: z.string() });
export type ChatMessageSchema = z.infer<typeof chatMessageSchema>;

export const searchFormSchema = z.object({ searchTerm: z.string() });
export type SearchFormSchema = z.infer<typeof searchFormSchema>;
