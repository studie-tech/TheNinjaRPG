import { z } from "zod";
import { baseServerResponse } from "@/validators/base";

export const challengeAvailabilitySchema = z.object({
  id: z.string(),
  openForChallenges: z.boolean(),
  openForChallengesAt: z.date(),
});

export const challengeAvailabilityOutputSchema = baseServerResponse.extend({
  data: challengeAvailabilitySchema.optional(),
});
