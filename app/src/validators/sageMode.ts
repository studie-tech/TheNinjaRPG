import { z } from "zod";
import { LetterRanks, SAGE_MODE_MAX_LEVEL } from "@/drizzle/constants";

export const sageModeFilteringSchema = z.object({
  name: z.string().min(0).max(256).optional(),
  village: z.string().optional(),
  rank: z.enum(LetterRanks).optional(),
  level: z.coerce.number().min(1).max(SAGE_MODE_MAX_LEVEL).optional(),
  hidden: z.boolean().optional(),
});

export type SageModeFilteringSchema = z.infer<typeof sageModeFilteringSchema>;
