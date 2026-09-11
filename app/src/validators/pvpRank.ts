import { z } from "zod";
import { RANKED_RANKS } from "@/drizzle/constants";
import { rewardFields } from "./rewards";

// Possible rewards are the same as for objectives, so that we can re-use code
export const rewardSchema = z.object(rewardFields);
export type RankedSeasonReward = z.infer<typeof rewardSchema>;
export type RankedSeasonRewardInput = z.input<typeof rewardSchema>;

export const writableSeasonRewardSchema = rewardSchema.superRefine((reward, ctx) => {
  for (const [field, value] of Object.entries(reward)) {
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: "Season reward amounts must be non-negative finite numbers",
      });
    }

    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      if (value.some((entry) => entry.trim().length === 0)) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Season reward IDs cannot be empty",
        });
      }
      if (new Set(value).size !== value.length) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Season reward IDs must be unique",
        });
      }
    }
  }

  reward.reward_items.forEach((entry, index) => {
    if (!Number.isFinite(entry.number) || entry.number < 0 || entry.number > 100) {
      ctx.addIssue({
        code: "custom",
        path: ["reward_items", index, "number"],
        message: "Item drop chance must be between 0 and 100",
      });
    }
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["reward_items", index, "quantity"],
        message: "Item reward quantity must be a positive integer",
      });
    }
    if (
      entry.ids.some((id) => id.trim().length === 0) ||
      new Set(entry.ids).size !== entry.ids.length
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reward_items", index, "ids"],
        message: "Item reward IDs must be non-empty and unique",
      });
    }
  });
});

export const divisionRewardSchema = z.object({
  division: z.string(),
  rewards: rewardSchema,
});
export type RankedSeasonDivisionReward = z.infer<typeof divisionRewardSchema>;

export const rankedSeasonSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  startDate: z.date(),
  endDate: z.date(),
  rewards: z.array(divisionRewardSchema),
  paused: z.boolean().prefault(false),
});
export type RankedSeason = z.infer<typeof rankedSeasonSchema>;
export type RankedSeasonInput = z.input<typeof rankedSeasonSchema>;

/** Creation-only guards. Existing legacy seasons remain editable by updateSeason. */
export const createRankedSeasonDetailsSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(191),
    description: z.string().trim().min(1, "Description is required").max(20_000),
    startDate: z.date(),
    endDate: z.date(),
    rewards: z
      .array(
        z.object({
          division: z.enum(RANKED_RANKS),
          rewards: writableSeasonRewardSchema,
        }),
      )
      .max(RANKED_RANKS.length),
    paused: z.boolean().prefault(false),
  })
  .superRefine((season, ctx) => {
    if (season.endDate <= season.startDate) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must be after the start date",
      });
    }
    const divisions = season.rewards.map((reward) => reward.division);
    if (new Set(divisions).size !== divisions.length) {
      ctx.addIssue({
        code: "custom",
        path: ["rewards"],
        message: "Each ranked division can only have one reward entry",
      });
    }
  });

export const createRankedSeasonSchema = createRankedSeasonDetailsSchema.extend({
  requestId: z.string().uuid(),
});
export type CreateRankedSeason = z.infer<typeof createRankedSeasonSchema>;

export const writableSeasonDivisionRewardSchema = z.object({
  division: z.enum(RANKED_RANKS),
  rewards: writableSeasonRewardSchema,
});

export const updateRankedSeasonSchema = rankedSeasonSchema.extend({
  id: z.string().min(1),
  expectedUpdatedAt: z.date(),
  requestId: z.string().uuid(),
});
export type UpdateRankedSeason = z.infer<typeof updateRankedSeasonSchema>;

export const deleteRankedSeasonSnapshotSchema = rankedSeasonSchema.extend({
  id: z.string().min(1),
  ended: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type DeleteRankedSeasonSnapshot = z.infer<
  typeof deleteRankedSeasonSnapshotSchema
>;

export const deleteRankedSeasonSchema = z
  .object({
    id: z.string().min(1),
    expectedUpdatedAt: z.date(),
    expectedSeason: deleteRankedSeasonSnapshotSchema,
    requestId: z.string().uuid(),
  })
  .superRefine((request, ctx) => {
    if (request.id !== request.expectedSeason.id) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedSeason", "id"],
        message: "Season snapshot does not match the requested season",
      });
    }
    if (
      request.expectedUpdatedAt.getTime() !== request.expectedSeason.updatedAt.getTime()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedSeason", "updatedAt"],
        message: "Season snapshot does not match the requested revision",
      });
    }
  });
export type DeleteRankedSeason = z.infer<typeof deleteRankedSeasonSchema>;

/**
 * Ending a season distributes irreversible rewards, so the confirmation carries the
 * complete season document and its revision rather than only a mutable row ID.
 */
export const endRankedSeasonSchema = z
  .object({
    id: z.string().min(1),
    expectedUpdatedAt: z.date(),
    expectedSeason: deleteRankedSeasonSnapshotSchema,
    requestId: z.string().uuid(),
  })
  .superRefine((request, ctx) => {
    if (request.id !== request.expectedSeason.id) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedSeason", "id"],
        message: "Season snapshot does not match the requested season",
      });
    }
    if (
      request.expectedUpdatedAt.getTime() !== request.expectedSeason.updatedAt.getTime()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedSeason", "updatedAt"],
        message: "Season snapshot does not match the requested revision",
      });
    }
  });
export type EndRankedSeason = z.infer<typeof endRankedSeasonSchema>;

export const rankedLoadoutSchema = z.object({
  jutsuIds: z.array(z.string()),
  weaponIds: z.array(z.string()),
  consumableIds: z.array(z.string()),
  favoriteJutsuIds: z.array(z.string()).optional(),
  favoriteWeaponIds: z.array(z.string()).optional(),
  favoriteConsumableIds: z.array(z.string()).optional(),
});
export type RankedLoadoutSchema = z.infer<typeof rankedLoadoutSchema>;

/**
 * A ranked loadout is stored as one JSON document. Supplying the row identity and
 * revision prevents two editors from replacing one another with stale full snapshots.
 */
export const updateRankedLoadoutSchema = rankedLoadoutSchema.extend({
  expectedLoadoutId: z.string().min(1),
  expectedUpdatedAt: z.date(),
});
export type UpdateRankedLoadoutSchema = z.infer<typeof updateRankedLoadoutSchema>;
