import { z } from "zod";
import { SHRINE_BOOST_TYPES } from "@/drizzle/constants";

export const boostTemplateEntrySchema = z.object({
  boostType: z.enum(SHRINE_BOOST_TYPES),
  dayOfWeek: z.number().int().min(0).max(6), // 0 = Sunday (UTC)
  slotIndex: z.number().int().min(0).max(11), // 0 = 00:00 UTC
});

export type BoostTemplateEntry = z.infer<typeof boostTemplateEntrySchema>;

export const boostTemplateSchema = z
  .array(boostTemplateEntrySchema)
  .max(168, "Template cannot exceed 168 entries")
  .refine(
    (entries) => {
      const keys = entries.map((e) => `${e.boostType}:${e.dayOfWeek}:${e.slotIndex}`);
      return keys.length === new Set(keys).size;
    },
    {
      message:
        "Duplicate (boostType, dayOfWeek, slotIndex) combinations are not allowed",
    },
  );
