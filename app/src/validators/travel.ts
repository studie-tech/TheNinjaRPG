import { z } from "zod";
import {
  MAP_SECTOR_ID_MAX,
  MAP_SECTOR_ID_MIN,
  MAX_TRAVEL_PIN_LABEL_LENGTH,
  MAX_TRAVEL_PINS,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
} from "@/drizzle/constants";

export const sectorIdSchema = z.coerce
  .number()
  .int()
  .min(MAP_SECTOR_ID_MIN)
  .max(MAP_SECTOR_ID_MAX);

/** A tile column inside a sector. */
export const sectorLongitudeSchema = z
  .int()
  .min(0)
  .max(SECTOR_WIDTH - 1);
/** A tile row inside a sector. */
export const sectorLatitudeSchema = z
  .int()
  .min(0)
  .max(SECTOR_HEIGHT - 1);

/** Accept the departure hint while deriving departure and landing from server state. */
export const startGlobalMoveSchema = z
  .strictObject({ sector: sectorIdSchema, curSector: sectorIdSchema.optional() })
  .transform(({ sector }) => ({ sector }));

/** Sector picker shared by the quick-travel and find-sector forms. */
export const sectorFormSchema = z.object({ sector: sectorIdSchema });
export type SectorFormInput = z.input<typeof sectorFormSchema>;
export type SectorForm = z.infer<typeof sectorFormSchema>;

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
  label: z.string().trim().min(1).max(MAX_TRAVEL_PIN_LABEL_LENGTH),
});
export type TravelPin = z.infer<typeof travelPinSchema>;

/** Browser presentation metadata; the matching profile deadline remains authoritative. */
export const globeJourneySchema = z.object({
  userId: z.string().min(1),
  fromSector: sectorIdSchema,
  toSector: sectorIdSchema,
  finishAt: z.number().int().positive(),
  durationMs: z.number().int().nonnegative(),
});
export type GlobeJourney = z.infer<typeof globeJourneySchema>;

/** Reads stored pins one by one, so a single stale or invalid pin does not drop the rest. */
export const parseTravelPins = (stored: unknown): TravelPin[] =>
  (Array.isArray(stored) ? stored : [])
    .flatMap((entry) => {
      const parsed = travelPinSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    })
    .slice(0, MAX_TRAVEL_PINS);
