import { z } from "zod";
import { MAP_SECTOR_ID_MAX, MAP_SECTOR_ID_MIN, XP_BRACKETS } from "@/drizzle/constants";

export const sectorIdSchema = z.coerce
  .number()
  .int()
  .min(MAP_SECTOR_ID_MIN)
  .max(MAP_SECTOR_ID_MAX);

/**
 * Global travel accepts the target sector and tolerates the previous client's
 * current-sector hint during rolling deployments. The transform discards the
 * hint, while strict mode still rejects client-supplied landing coordinates;
 * the server derives departure and landing state itself.
 */
export const startGlobalMoveSchema = z
  .object({
    sector: sectorIdSchema,
    curSector: sectorIdSchema.optional(),
  })
  .strict()
  .transform(({ sector }) => ({ sector }));

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
