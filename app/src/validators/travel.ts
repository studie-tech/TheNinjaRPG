import { z } from "zod";
import { XP_BRACKETS } from "@/drizzle/constants";

export const sectorIdSchema = z.coerce.number().int().min(0).max(491);

export const quickTravelSchema = z.object({ sector: sectorIdSchema });
export type QuickTravelSchemaInput = z.input<typeof quickTravelSchema>;
export type QuickTravelSchema = z.infer<typeof quickTravelSchema>;

export const findSectorSchema = z.object({ sector: sectorIdSchema });
export type FindSectorSchemaInput = z.input<typeof findSectorSchema>;
export type FindSectorSchema = z.infer<typeof findSectorSchema>;

export const bracketSliderSchema = z.object({
  // -1 disables the bracket filter; 0–7 select an exact bracket
  value: z.number().min(-1).max(XP_BRACKETS.length),
});
export type BracketSliderSchema = z.infer<typeof bracketSliderSchema>;
