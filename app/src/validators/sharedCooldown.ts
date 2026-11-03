import { z } from "zod";
import { tagTypes } from "@/validators/combat";

export const sharedCooldownTagSchema = z
  .string()
  .refine((tag) => tagTypes.includes(tag), {
    message: "Choose a combat tag",
  });
export const sharedCooldownSchema = z.object({
  tag: sharedCooldownTagSchema,
  rounds: z.number().int().min(1).max(2147483647),
});
