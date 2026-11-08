import { z } from "zod";
import { userPatchSchema } from "@/validators/userCache";

/** The healer's row after a hospital heal; the client patches its cached user with it. */
export const healerAfterHealSchema = z.object({
  curHealth: z.number(),
  curChakra: z.number(),
  curStamina: z.number(),
  curEnergy: z.number(),
  maxEnergy: z.number(),
  medicalExperience: z.number(),
  regenAt: z.date(),
  questData: userPatchSchema.shape.questData,
});
