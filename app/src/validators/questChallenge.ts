import { z } from "zod";

/** Which quest objective a minigame challenge run is started for. */
export const questChallengeRequestSchema = z.object({
  questId: z.string().max(191),
  objectiveId: z.string().max(191),
});
export type QuestChallengeRequest = z.infer<typeof questChallengeRequestSchema>;
