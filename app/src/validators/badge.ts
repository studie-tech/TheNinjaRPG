import { z } from "zod";

export const BadgeValidator = z.object({
  name: z.string().trim().min(1).max(191),
  image: z.url(),
  description: z.string().min(1).max(512),
});

export type ZodBadgeType = z.infer<typeof BadgeValidator>;
