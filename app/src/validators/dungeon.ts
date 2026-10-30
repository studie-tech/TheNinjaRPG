import { z } from "zod";
import {
  COMBAT_BIOMES,
  DUNGEON_FLOORS_PER_TIER,
  DUNGEON_MAX_DROPS,
  DUNGEON_MAX_MOBS,
  DUNGEON_MAX_REWARD_AMOUNT,
  DUNGEON_MAX_REWARD_QUANTITY,
  DUNGEON_MAX_TIERS,
  DUNGEON_MAX_WAVES,
  MAP_SECTOR_ID_MAX,
  MAP_SECTOR_ID_MIN,
  MAX_PLAYER_LEVEL,
  RetryQuestDelays,
  SECTOR_HEIGHT,
  SECTOR_WIDTH,
} from "@/drizzle/constants";
import { type CoopRoster, encounterWaveSchema } from "@/validators/coop";
import { mapLocationFields } from "@/validators/mapLocation";
import { RewardPackageValidator } from "@/validators/rewardPackages";
import type { PostProcessedRewards } from "@/validators/rewards";

/** Quest-compatible lifetime attempt caps, calendar cooldowns and completion caps. */
export const dungeonRequirementsSchema = z.object({
  requiredLevel: z.number().int().min(1).max(MAX_PLAYER_LEVEL).prefault(1),
  prerequisiteQuestName: z.string().optional(),
  requiredItemName: z.string().optional(),
  prerequisiteQuestId: z.string().min(1).nullable().prefault(null),
  requiredItemId: z.string().min(1).nullable().prefault(null),
  requiredItemQuantity: z.number().int().min(1).max(9999).prefault(1),
  maxAttempts: z.number().int().min(1).nullable().prefault(null),
  maxCompletes: z.number().int().min(1).nullable().prefault(null),
  attemptDelay: z.enum(RetryQuestDelays).prefault("none"),
  retryDelay: z.enum(RetryQuestDelays).prefault("none"),
});

/** Each member rolls once per drop, receiving its full quantity on success. */
const dungeonDropSchema = z
  .object({
    type: z.enum(["item", "jutsu", "cache", "package"]),
    id: z.string().min(1, "Choose a reward for each drop."),
    chance: z.number().min(1).max(100),
    /** Stop rolling this reward after a successful drop in this dungeon. */
    onlyOnce: z.boolean().optional(),
    quantity: z.number().int().min(1).max(DUNGEON_MAX_REWARD_QUANTITY).prefault(1),
    /** Server copies the approved catalog source at save; clients cannot author this payload. */
    package: RewardPackageValidator.optional(),
  })
  .refine((drop) => drop.type !== "jutsu" || drop.quantity === 1, {
    path: ["quantity"],
    message: "Jutsu rewards can only be learned once.",
  });
/** Enemy templates and the minimum rounds elapsed since the preceding wave began. */
export const dungeonFloorSchema = z.object({
  kind: z.enum(["floor", "mini-boss", "boss"]),
  waves: z
    .array(
      encounterWaveSchema.extend({
        aiIds: encounterWaveSchema.shape.aiIds.max(DUNGEON_MAX_MOBS),
      }),
    )
    .min(1)
    .max(DUNGEON_MAX_WAVES),
});
/** Shared editor/server contract: five floors per tier, immediate first waves and a final boss. */
export const dungeonContentSchema = z
  .object({
    requirements: dungeonRequirementsSchema.prefault({}),
    name: z.string().trim().min(1, "Enter a dungeon name.").max(100),
    description: z.string().max(2000).prefault(""),
    // Empty artwork retains the biome entrance; encounter portraits remain independent.
    structureAssetId: mapLocationFields.structureAssetId,
    structureScale: mapLocationFields.structureScale,
    sector: z.number().int().min(MAP_SECTOR_ID_MIN).max(MAP_SECTOR_ID_MAX),
    longitude: z
      .number()
      .int()
      .min(0)
      .max(SECTOR_WIDTH - 1),
    latitude: z
      .number()
      .int()
      .min(0)
      .max(SECTOR_HEIGHT - 1),
    expiresAt: z.coerce.date().nullable(),
    hidden: z.boolean().prefault(true),
    background: z.enum(COMBAT_BIOMES).prefault("default"),
    tiers: z
      .array(z.array(dungeonFloorSchema).length(DUNGEON_FLOORS_PER_TIER))
      .min(1)
      .max(DUNGEON_MAX_TIERS),
    rewards: z.object({
      money: z.number().min(0).max(DUNGEON_MAX_REWARD_AMOUNT).prefault(0),
      experience: z.number().min(0).max(DUNGEON_MAX_REWARD_AMOUNT).prefault(0),
      tokens: z.number().int().min(0).max(DUNGEON_MAX_REWARD_AMOUNT).prefault(0),
      prestige: z.number().int().min(0).max(DUNGEON_MAX_REWARD_AMOUNT).prefault(0),
      drops: z.array(dungeonDropSchema).max(DUNGEON_MAX_DROPS).prefault([]),
    }),
  })
  .superRefine((content, ctx) => {
    content.tiers.forEach((tier, ti) => {
      tier.forEach((floor, fi) => {
        const last =
          ti === content.tiers.length - 1 && fi === DUNGEON_FLOORS_PER_TIER - 1;
        const expected = last
          ? "boss"
          : fi === DUNGEON_FLOORS_PER_TIER - 1
            ? "mini-boss"
            : "floor";
        if (floor.kind !== expected)
          ctx.addIssue({
            code: "custom",
            path: ["tiers", ti, fi, "kind"],
            message: `This room must be a ${expected}`,
          });
        if (floor.waves[0]?.delayRounds !== 0)
          ctx.addIssue({
            code: "custom",
            path: ["tiers", ti, fi, "waves", 0, "delayRounds"],
            message: "The first wave must start immediately",
          });
      });
    });
  });
/** Omit the ID to create a definition; existing runs keep their captured content snapshot. */
export const saveDungeonSchema = z.object({
  id: z.string().optional(),
  content: dungeonContentSchema,
});
/** Identify a definition for lobby creation or a run for completion claims. */
export const dungeonIdSchema = z.object({ id: z.string().min(1) });
/** Availability is restricted to the authenticated player's current sector by the router. */
export const dungeonSectorSchema = z.object({
  sector: z.number().int().min(MAP_SECTOR_ID_MIN).max(MAP_SECTOR_ID_MAX),
});
/** Party commands; membership, readiness and leader privileges are checked against the saved run. */
export const dungeonActionSchema = z.object({
  id: z.string().min(1),
  action: z.enum([
    "invite",
    "accept",
    "decline",
    "remove",
    "leave",
    "ready",
    "unready",
    "start",
    "pause",
    "resume",
  ]),
  userId: z.string().optional(),
});
/** Validated staff-authored definition copied into a run when its lobby is created. */
export type DungeonContent = z.infer<typeof dungeonContentSchema>;
/** Authored room shared by the editor, run transitions and battle initiation. */
export type DungeonFloor = z.infer<typeof dungeonFloorSchema>;
/** Versioned party progress; floor indexes are zero-based and readiness resets on transitions. */
export type DungeonRunState = CoopRoster & {
  /** Start reservation metadata used to recover an interrupted battle initiation. */
  entryStartedAt?: number;
  /** Committed with the first battle and entry items; absent until a successful admission. */
  entryPaidAt?: number;
  /** Publication commits with the battle; recovery may claim only an unpublished floor. */
  battlePublished?: boolean;
  /** Owned companions reserved by the solo player's queued status throughout the run. */
  pets?: { id: string; name: string; avatar: string | null }[];
  entryPreviousDeadline?: number | null;
  floor: number;
  clearedFloors: number[];
  message: string;
};
/** Persisted completion roll returned by repeat claims without delivering rewards again. */
export type DungeonRewardReceipt = {
  /** Delivered direct drops and successful package rolls, scoped to the dungeon. */
  grantedDrops?: string[];
  claimedAt?: number;
  money: number;
  experience: number;
  tokens: number;
  prestige: number;
  items: string[];
  jutsus: string[];
  /** Complete roll, including package-only reward types; absent on older receipts. */
  rewards?: PostProcessedRewards;
};
