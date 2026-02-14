import { z } from "zod";

export const generateAudioSchema = z.object({
  relationId: z.string(),
  prompt: z.string().min(3, "Enter at least 3 characters"),
  negativePrompt: z.string().optional(),
  secondsTotal: z.coerce.number().int().min(1, "Min 1s").max(5, "Max 5s").prefault(1),
});

export type GenerateAudioInput = z.infer<typeof generateAudioSchema>;
