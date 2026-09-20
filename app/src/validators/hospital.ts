import { z } from "zod";

/** The healer's row after a hospital heal; the client patches its cached user with it. */
export const healerAfterHealSchema = z.object({
  curHealth: z.number(),
  curChakra: z.number(),
  curStamina: z.number(),
  medicalExperience: z.number(),
  regenAt: z.date(),
});

export type HealerAfterHeal = z.infer<typeof healerAfterHealSchema>;
