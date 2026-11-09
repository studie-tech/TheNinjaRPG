import { z } from "zod";
import { tagTypes } from "@/validators/combat";

export const equipLimitCategories = [
  ...tagTypes,
  "residual",
  "event",
  "forbidden",
  "40 AP",
];
export const equipLimitCategorySchema = z
  .string()
  .refine(
    (value) => equipLimitCategories.includes(value),
    "Choose a combat tag or category",
  );
export const jutsuEquipLimitSchema = z.object({
  category: equipLimitCategorySchema,
  unrankedMaxEquipped: z.number().int().min(0).max(2147483647).nullable(),
  rankedMaxEquipped: z.number().int().min(0).max(2147483647).nullable(),
});
export type JutsuEquipLimit = z.infer<typeof jutsuEquipLimitSchema>;
