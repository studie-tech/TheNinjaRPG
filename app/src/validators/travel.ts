import { z } from "zod";
import {
  MAP_SECTOR_ID_MAX,
  MAP_SECTOR_ID_MIN,
  MAX_PVP_BRACKET,
  MAX_TRAVEL_PINS,
} from "@/drizzle/constants";

export const sectorIdSchema = z.coerce
  .number()
  .int()
  .min(MAP_SECTOR_ID_MIN)
  .max(MAP_SECTOR_ID_MAX);

/** Accept the departure hint while deriving departure and landing from server state. */
export const startGlobalMoveSchema = z
  .strictObject({ sector: sectorIdSchema, curSector: sectorIdSchema.optional() })
  .transform(({ sector }) => ({ sector }));

export const quickTravelSchema = z.object({ sector: sectorIdSchema });
export type QuickTravelSchemaInput = z.input<typeof quickTravelSchema>;
export type QuickTravelSchema = z.infer<typeof quickTravelSchema>;

export const findSectorSchema = z.object({ sector: sectorIdSchema });
export type FindSectorSchemaInput = z.input<typeof findSectorSchema>;
export type FindSectorSchema = z.infer<typeof findSectorSchema>;

export const bracketSliderSchema = z.object({
  // -1 disables the bracket filter; 0–8 select an exact bracket
  value: z.number().min(-1).max(MAX_PVP_BRACKET),
});
export type BracketSliderSchema = z.infer<typeof bracketSliderSchema>;

/** Coordinates in an authored sector; map bounds and walkability are checked on arrival. */
export const travelLocationSchema = z.object({
  sector: sectorIdSchema,
  longitude: z.coerce.number().int().nonnegative().optional(),
  latitude: z.coerce.number().int().nonnegative().optional(),
});
export type TravelLocation = z.infer<typeof travelLocationSchema>;

export const travelPinSchema = travelLocationSchema.extend({
  longitude: z.number().int().nonnegative(),
  latitude: z.number().int().nonnegative(),
  label: z.string().trim().min(1).max(40),
});
export type TravelPin = z.infer<typeof travelPinSchema>;

/** Reads stored pins one by one, so a single stale or invalid pin does not drop the rest. */
export const parseTravelPins = (stored: unknown): TravelPin[] =>
  (Array.isArray(stored) ? stored : [])
    .flatMap((entry) => {
      const parsed = travelPinSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    })
    .slice(0, MAX_TRAVEL_PINS);
