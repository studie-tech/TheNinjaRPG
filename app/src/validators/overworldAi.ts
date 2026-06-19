import { z } from "zod";
import {
  MAP_TOTAL_SECTORS,
  OverworldInteractionTypes,
  OverworldLocationTypes,
  OverworldSectorTypes,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
} from "@/drizzle/constants";

export const OverworldPlacementSchema = z
  .object({
    aiTemplateUserId: z.string().min(1),
    interactionType: z.enum(OverworldInteractionTypes),
    sectorType: z.enum(OverworldSectorTypes).prefault("specific"),
    locationType: z.enum(OverworldLocationTypes).prefault("specific"),
    sector: z.coerce.number().int().min(0).max(MAP_TOTAL_SECTORS).prefault(0),
    longitude: z.coerce
      .number()
      .int()
      .min(0)
      .max(SECTOR_WIDTH - 1)
      .prefault(0),
    latitude: z.coerce
      .number()
      .int()
      .min(0)
      .max(SECTOR_HEIGHT - 1)
      .prefault(0),
    sectorList: z
      .array(z.coerce.number().int().min(0).max(MAP_TOTAL_SECTORS))
      .prefault([]),
    questGiveChance: z.coerce.number().int().min(0).max(100).prefault(0),
    questIds: z.array(z.string()).prefault([]),
    isActive: z.coerce.boolean().prefault(true),
  })
  .superRefine((val, ctx) => {
    if (val.sectorType === "from_list" && val.sectorList.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Provide at least one sector when sector mode is 'from_list'",
        path: ["sectorList"],
      });
    }
    if (new Set(val.questIds).size !== val.questIds.length) {
      ctx.addIssue({
        code: "custom",
        message: "Quest pool cannot contain duplicates",
        path: ["questIds"],
      });
    }
  });

export type OverworldPlacementInput = z.input<typeof OverworldPlacementSchema>;
export type OverworldPlacementType = z.output<typeof OverworldPlacementSchema>;
