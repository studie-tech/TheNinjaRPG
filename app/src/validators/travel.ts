import { z } from "zod";

export const sectorIdSchema = z.coerce.number().int().min(0).max(491);

export const quickTravelSchema = z.object({ sector: sectorIdSchema });
export type QuickTravelSchemaInput = z.input<typeof quickTravelSchema>;
export type QuickTravelSchema = z.infer<typeof quickTravelSchema>;

export const findSectorSchema = z.object({ sector: sectorIdSchema });
export type FindSectorSchemaInput = z.input<typeof findSectorSchema>;
export type FindSectorSchema = z.infer<typeof findSectorSchema>;

export const levelSliderSchema = z.object({ value: z.number().min(0).max(100) });
export type LevelSliderSchema = z.infer<typeof levelSliderSchema>;
