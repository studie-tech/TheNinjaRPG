import { z } from "zod";
import {
  MAP_TOTAL_SECTORS,
  OVERWORLD_DEFAULT_WANDER_RADIUS,
  OVERWORLD_MAP_SCALE_RANGE,
  OVERWORLD_MAX_GROUP_SIZE,
  OVERWORLD_MAX_SPAWN_COUNT,
  OVERWORLD_MAX_WANDER_RADIUS,
  OverworldHabitats,
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
    sector: z.coerce
      .number()
      .int()
      .min(0)
      .max(MAP_TOTAL_SECTORS - 1)
      .prefault(0),
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
      .array(
        z.coerce
          .number()
          .int()
          .min(0)
          .max(MAP_TOTAL_SECTORS - 1),
      )
      .prefault([]),
    quests: z
      .array(
        z.object({
          questId: z.string().min(1),
          chance: z.coerce.number().int().min(0).max(100),
        }),
      )
      .prefault([]),
    isActive: z.coerce.boolean().prefault(true),
    wanderRadius: z.coerce
      .number()
      .int()
      .min(0)
      .max(OVERWORLD_MAX_WANDER_RADIUS)
      .prefault(OVERWORLD_DEFAULT_WANDER_RADIUS),
    spawnCount: z.coerce
      .number()
      .int()
      .min(1)
      .max(OVERWORLD_MAX_SPAWN_COUNT)
      .prefault(1),
    groupMin: z.coerce.number().int().min(1).max(OVERWORLD_MAX_GROUP_SIZE).prefault(1),
    groupMax: z.coerce.number().int().min(1).max(OVERWORLD_MAX_GROUP_SIZE).prefault(1),
    habitats: z.array(z.enum(OverworldHabitats)).prefault([]),
    wildOnly: z.coerce.boolean().prefault(false),
    mapScale: z.coerce
      .number()
      .int()
      .min(OVERWORLD_MAP_SCALE_RANGE[0])
      .max(OVERWORLD_MAP_SCALE_RANGE[1])
      .prefault(100),
  })
  .superRefine((val, ctx) => {
    if (val.interactionType !== "FRIENDLY" && val.quests.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: "Only friendly NPC placements can have a quest pool",
        path: ["quests"],
      });
    }
    if (val.sectorType === "from_list" && val.sectorList.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Provide at least one sector when sector mode is 'from_list'",
        path: ["sectorList"],
      });
    }
    if (val.groupMin > val.groupMax) {
      ctx.addIssue({
        code: "custom",
        message: "The smallest group cannot be larger than the largest",
        path: ["groupMin"],
      });
    }
    if (
      val.spawnCount > 1 &&
      val.sectorType === "specific" &&
      val.locationType === "specific"
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Copies need a random sector or a random tile, or they all share one tile",
        path: ["spawnCount"],
      });
    }
    if (val.habitats.length > 0 && val.sectorType !== "random") {
      ctx.addIssue({
        code: "custom",
        message: "Habitats only narrow random sectors",
        path: ["habitats"],
      });
    }
    const ids = val.quests.map((q) => q.questId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Quest pool cannot contain duplicates",
        path: ["quests"],
      });
    }
    const sum = val.quests.reduce((s, q) => s + q.chance, 0);
    if (sum > 100) {
      ctx.addIssue({
        code: "custom",
        message: `Quest chances sum to ${sum}%; must be ≤ 100`,
        path: ["quests"],
      });
    }
  });

export type OverworldPlacementInput = z.input<typeof OverworldPlacementSchema>;
