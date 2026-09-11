import { TRPCError } from "@trpc/server";
import { and, asc, eq, gt, gte, inArray, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  RANKED_ENTRY_COST,
  RANKED_LEGEND_LP_REQUIREMENT,
  RANKED_PVP_STATS,
  RANKED_RANKS,
  RANKED_REQUIRED_RANK,
  RANKED_SANNIN_TOP_PLAYERS,
} from "@/drizzle/constants";
import {
  actionLog,
  item,
  jutsu,
  logQueueLengths,
  logRankedPicks,
  rankedLoadout,
  rankedPvpQueue,
  rankedSeason,
  rankedUserRewards,
  userData,
} from "@/drizzle/schema";
import { collapseRewards, postProcessRewards } from "@/libs/quest";
import {
  getRankedRadius,
  getRankedRank,
  validateItemLoadout,
  validateJutsuLoadout,
} from "@/libs/ranked_pvp";
import { hasRequiredRank } from "@/libs/train";
import { initiateBattle } from "@/routers/combat";
import { fetchUser } from "@/routers/profile";
import { updateRewards } from "@/server/api/routers/quests";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { fetchSanninRankedPlayers } from "@/server/utils/ranked";
import { canAwardReputation, canChangeContent } from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { secondsPassed } from "@/utils/time";
import { idSchema } from "@/validators/misc";
import {
  createRankedSeasonSchema,
  deleteRankedSeasonSchema,
  deleteRankedSeasonSnapshotSchema,
  endRankedSeasonSchema,
  rankedLoadoutSchema,
  rankedSeasonSchema,
  updateRankedLoadoutSchema,
  updateRankedSeasonSchema,
  writableSeasonDivisionRewardSchema,
} from "@/validators/pvpRank";

const createdSeasonResponseSchema = z.object({
  id: z.string().min(1),
  ...rankedSeasonSchema.shape,
});

const createSeasonResponseSchema = baseServerResponse.extend({
  requestId: z.string().uuid().optional(),
  submittedSeason: rankedSeasonSchema.optional(),
  createdSeason: createdSeasonResponseSchema.optional(),
});

type SeasonSnapshot = {
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  rewards: z.infer<typeof rankedSeasonSchema>["rewards"];
  paused: boolean;
};

type CreateSeasonReceipt = {
  requestId: string;
  submittedSeason: SeasonSnapshot;
  createdSeason: SeasonSnapshot & { id: string };
};

const seasonSnapshotSchema = z.object({
  name: z.string(),
  description: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  rewards: rankedSeasonSchema.shape.rewards,
  paused: z.boolean(),
});

const createSeasonReceiptSchema = z.object({
  requestId: z.string().uuid(),
  submittedSeason: seasonSnapshotSchema,
  createdSeason: seasonSnapshotSchema.extend({ id: z.string().min(1) }),
});

const seasonSnapshot = (season: {
  name: string;
  description: string;
  startDate: Date;
  endDate: Date;
  rewards: z.infer<typeof rankedSeasonSchema>["rewards"];
  paused: boolean;
}): SeasonSnapshot => ({
  name: season.name,
  description: season.description,
  startDate: season.startDate.toISOString(),
  endDate: season.endDate.toISOString(),
  rewards: season.rewards,
  paused: season.paused,
});

const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
};

const snapshotsMatch = (left: SeasonSnapshot, right: SeasonSnapshot) =>
  JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));

type VersionedSeasonSnapshot = SeasonSnapshot & {
  id: string;
  updatedAt: string;
};

type UpdateSeasonReceipt = {
  requestId: string;
  seasonId: string;
  expectedUpdatedAt: string;
  submittedSeason: SeasonSnapshot;
  previousSeason: VersionedSeasonSnapshot;
  committedSeason: VersionedSeasonSnapshot;
};

const versionedSeasonSnapshotSchema = seasonSnapshotSchema.extend({
  id: z.string().min(1),
  updatedAt: z.string(),
});

const updateSeasonReceiptSchema = z.object({
  requestId: z.string().uuid(),
  seasonId: z.string().min(1),
  expectedUpdatedAt: z.string(),
  submittedSeason: seasonSnapshotSchema,
  previousSeason: versionedSeasonSnapshotSchema,
  committedSeason: versionedSeasonSnapshotSchema,
});

const updateSeasonResponseSchema = baseServerResponse.extend({
  requestId: z.string().uuid().optional(),
  seasonId: z.string().min(1).optional(),
  expectedUpdatedAt: z.date().optional(),
  submittedSeason: rankedSeasonSchema.optional(),
  previousSeason: createdSeasonResponseSchema
    .extend({ updatedAt: z.date() })
    .optional(),
  committedSeason: createdSeasonResponseSchema
    .extend({ updatedAt: z.date() })
    .optional(),
});

const deleteSeasonResponseSchema = baseServerResponse.extend({
  requestId: z.string().uuid().optional(),
  seasonId: z.string().min(1).optional(),
  expectedUpdatedAt: z.date().optional(),
  expectedSeason: deleteRankedSeasonSnapshotSchema.optional(),
  deletedSeason: deleteRankedSeasonSnapshotSchema.optional(),
  deletedUnclaimedRewardIds: z.array(z.string()).optional(),
  deletedUnclaimedRewardCount: z.number().int().nonnegative().optional(),
  deleted: z.literal(true).optional(),
});

type DeleteSeasonSnapshot = Omit<
  z.infer<typeof deleteRankedSeasonSnapshotSchema>,
  "startDate" | "endDate" | "createdAt" | "updatedAt"
> & {
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
};

type DeleteSeasonReceipt = {
  requestId: string;
  seasonId: string;
  expectedUpdatedAt: string;
  expectedSeason: DeleteSeasonSnapshot;
  deletedSeason: DeleteSeasonSnapshot;
  deletedUnclaimedRewardIds: string[];
};

const deleteSeasonSnapshotSchema = seasonSnapshotSchema.extend({
  id: z.string().min(1),
  ended: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const deleteSeasonReceiptSchema = z.object({
  requestId: z.string().uuid(),
  seasonId: z.string().min(1),
  expectedUpdatedAt: z.string(),
  expectedSeason: deleteSeasonSnapshotSchema,
  deletedSeason: deleteSeasonSnapshotSchema,
  deletedUnclaimedRewardIds: z.array(z.string()),
});

const deleteSeasonSnapshot = (season: {
  id: string;
  name: string;
  description: string;
  startDate: Date;
  endDate: Date;
  rewards: z.infer<typeof rankedSeasonSchema>["rewards"];
  ended: boolean;
  paused: boolean;
  createdAt: Date;
  updatedAt: Date;
}): DeleteSeasonSnapshot => ({
  id: season.id,
  name: season.name,
  description: season.description,
  startDate: season.startDate.toISOString(),
  endDate: season.endDate.toISOString(),
  rewards: season.rewards,
  ended: season.ended,
  paused: season.paused,
  createdAt: season.createdAt.toISOString(),
  updatedAt: season.updatedAt.toISOString(),
});

const deleteSeasonResponse = (season: DeleteSeasonSnapshot) => ({
  ...season,
  startDate: new Date(season.startDate),
  endDate: new Date(season.endDate),
  createdAt: new Date(season.createdAt),
  updatedAt: new Date(season.updatedAt),
});

type EndSeasonRewardReceipt = {
  id: string;
  userId: string;
  division: (typeof rankedUserRewards.$inferSelect)["division"];
};

type EndSeasonReceipt = {
  requestId: string;
  seasonId: string;
  expectedUpdatedAt: string;
  expectedSeason: DeleteSeasonSnapshot;
  previousSeason: DeleteSeasonSnapshot;
  committedSeason: DeleteSeasonSnapshot;
  rewards: EndSeasonRewardReceipt[];
  insertedRewardIds: string[];
  resetUserIds: string[];
  clearedQueueUserIds: string[];
};

const endSeasonRewardReceiptSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  division: z.enum(RANKED_RANKS),
});

const endSeasonReceiptSchema = z.object({
  requestId: z.string().uuid(),
  seasonId: z.string().min(1),
  expectedUpdatedAt: z.string(),
  expectedSeason: deleteSeasonSnapshotSchema,
  previousSeason: deleteSeasonSnapshotSchema,
  committedSeason: deleteSeasonSnapshotSchema,
  rewards: z.array(endSeasonRewardReceiptSchema),
  insertedRewardIds: z.array(z.string()),
  resetUserIds: z.array(z.string()),
  clearedQueueUserIds: z.array(z.string()),
});

const endSeasonResponseSchema = baseServerResponse.extend({
  requestId: z.string().uuid().optional(),
  seasonId: z.string().min(1).optional(),
  expectedUpdatedAt: z.date().optional(),
  expectedSeason: deleteRankedSeasonSnapshotSchema.optional(),
  previousSeason: deleteRankedSeasonSnapshotSchema.optional(),
  committedSeason: deleteRankedSeasonSnapshotSchema.optional(),
  rewards: z.array(endSeasonRewardReceiptSchema).optional(),
  rewardCount: z.number().int().nonnegative().optional(),
  insertedRewardIds: z.array(z.string()).optional(),
  resetUserIds: z.array(z.string()).optional(),
  resetUserCount: z.number().int().nonnegative().optional(),
  clearedQueueUserIds: z.array(z.string()).optional(),
  clearedQueueCount: z.number().int().nonnegative().optional(),
  ended: z.literal(true).optional(),
});

const versionedSeasonSnapshot = (season: {
  id: string;
  name: string;
  description: string;
  startDate: Date;
  endDate: Date;
  rewards: z.infer<typeof rankedSeasonSchema>["rewards"];
  paused: boolean;
  updatedAt: Date;
}): VersionedSeasonSnapshot => ({
  id: season.id,
  ...seasonSnapshot(season),
  updatedAt: season.updatedAt.toISOString(),
});

const seasonResponse = (season: VersionedSeasonSnapshot) => ({
  id: season.id,
  name: season.name,
  description: season.description,
  startDate: new Date(season.startDate),
  endDate: new Date(season.endDate),
  rewards: season.rewards,
  paused: season.paused,
  updatedAt: new Date(season.updatedAt),
});

const valuesMatch = (left: unknown, right: unknown) =>
  JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));

const affectedRows = (result: unknown) => {
  if (result && typeof result === "object" && "rowsAffected" in result) {
    return Number(result.rowsAffected);
  }
  if (
    Array.isArray(result) &&
    result[0] &&
    typeof result[0] === "object" &&
    "affectedRows" in result[0]
  ) {
    return Number(result[0].affectedRows);
  }
  return 0;
};

/**
 * Existing invalid legacy reward entries may be kept or removed. Any entry that is new or
 * materially changed must meet today's write rules, and edits may not introduce duplicate
 * divisions. This avoids making an unrelated text/date repair impossible on a legacy season.
 */
const validateSeasonRewardUpdate = (
  existingRewards: SeasonSnapshot["rewards"],
  submittedRewards: SeasonSnapshot["rewards"],
) => {
  if (valuesMatch(existingRewards, submittedRewards)) return undefined;

  const divisions = submittedRewards.map((entry) =>
    entry && typeof entry === "object" && "division" in entry
      ? (entry as { division: unknown }).division
      : undefined,
  );
  if (new Set(divisions).size !== divisions.length) {
    return "Each ranked division can only have one reward entry";
  }

  for (const submittedEntry of submittedRewards) {
    const isUnchangedLegacyEntry = existingRewards.some((existingEntry) =>
      valuesMatch(existingEntry, submittedEntry),
    );
    if (isUnchangedLegacyEntry) continue;

    const parsed = writableSeasonDivisionRewardSchema.safeParse(submittedEntry);
    if (!parsed.success) {
      return parsed.error.issues[0]?.message ?? "Invalid ranked season reward";
    }
  }
  return undefined;
};

export const pvpRankRouter = createTRPCRouter({
  // Get the user's season rewards
  getUnclaimedUserSeasonRewards: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get unclaimed ranked season rewards" },
    })
    .query(async ({ ctx }) => {
      return await getUnclaimedUserSeasonRewards(ctx.drizzle, ctx.userId);
    }),

  // Claim the user's season rewards
  claimSeasonRewards: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Claim ranked season rewards" } })
    .mutation(async ({ ctx }) => {
      // Fetch unclaimed rewards for the user
      const [rewards, user] = await Promise.all([
        getUnclaimedUserSeasonRewards(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (!user) {
        return errorResponse("User not found");
      }
      if (rewards.length === 0) {
        return errorResponse("No unclaimed season rewards");
      }
      const rewardIds = rewards.map((reward) => reward.id);
      const claimResult = await ctx.drizzle
        .update(rankedUserRewards)
        .set({ claimed: true, claimedAt: new Date() })
        .where(
          and(
            eq(rankedUserRewards.userId, ctx.userId),
            inArray(rankedUserRewards.id, rewardIds),
            eq(rankedUserRewards.claimed, false),
          ),
        );
      if (claimResult.rowsAffected !== rewardIds.length) {
        return errorResponse("Season rewards already claimed");
      }
      // Collect rewards from each entry
      const collapsedRewards = collapseRewards(
        rewards
          .map((r) => r.seasonRewards)
          .filter((r): r is NonNullable<typeof r> => r !== undefined && r !== null),
      );
      const processedRewards = postProcessRewards(collapsedRewards);
      await updateRewards({
        client: ctx.drizzle,
        user,
        rewards: processedRewards,
        reason: "RANKED_REWARDS",
      });

      return {
        success: true,
        message: "Season rewards claimed successfully",
        rewards: processedRewards,
      };
    }),

  // Get all ranked seasons
  getSeasons: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get all ranked PvP seasons" } })
    .query(async ({ ctx }) => {
      const seasons = await fetchAllSeasons(ctx.drizzle);
      return seasons;
    }),

  // Get a specific season
  getSeason: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get a specific ranked season" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const season = await ctx.drizzle.query.rankedSeason.findFirst({
        where: eq(rankedSeason.id, input.id),
      });
      if (!season) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Season not found" });
      }
      return season;
    }),

  // Get the current season
  getCurrentSeason: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get the current active ranked season" },
    })
    .query(async ({ ctx }) => {
      return await fetchCurrentSeason(ctx.drizzle);
    }),

  // Get the current season
  getCurrentTopPlayers: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Get LP values of the top Legend players used for Sannin rank",
      },
    })
    .query(async ({ ctx }) => {
      return await fetchSanninRankedPlayers(ctx.drizzle);
    }),

  // Create a new season
  createSeason: protectedProcedure
    .input(createRankedSeasonSchema)
    .output(createSeasonResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const { requestId, ...submittedSeason } = input;
      const submittedSnapshot = seasonSnapshot(submittedSeason);
      const receiptId = `create-ranked-season:${requestId}`;

      return retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          // Re-read authorization under a lock so a role/ban change cannot race this write.
          await tx.execute(
            sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} = ${ctx.userId} FOR UPDATE`,
          );
          // This locking read serializes checks against a newly-active season, including the
          // supremum gap when no season rows exist. Keep every statement on this PlanetScale
          // transaction connection sequential.
          await tx.execute(
            sql`SELECT ${rankedSeason.id} FROM ${rankedSeason} ORDER BY ${rankedSeason.id} FOR UPDATE`,
          );

          const user = await tx.query.userData.findFirst({
            where: eq(userData.userId, ctx.userId),
          });
          const previousRequest = await tx.query.actionLog.findFirst({
            where: eq(actionLog.id, receiptId),
          });

          if (!user) return errorResponse("Creating user not found");
          if (user.isBanned) {
            return errorResponse("You are banned and cannot create ranked seasons");
          }
          if (!canChangeContent(user.role)) {
            return errorResponse("You don't have permission to create ranked seasons");
          }

          if (previousRequest) {
            const parsedReceipt = createSeasonReceiptSchema.safeParse(
              previousRequest.changes,
            );
            if (!parsedReceipt.success) {
              return errorResponse("Invalid ranked season creation request ID");
            }
            const receipt = parsedReceipt.data;
            const existingSeason = previousRequest.relatedId
              ? await tx.query.rankedSeason.findFirst({
                  where: eq(rankedSeason.id, previousRequest.relatedId),
                })
              : undefined;
            const existingSnapshot = existingSeason
              ? seasonSnapshot(existingSeason)
              : undefined;
            const { id: receiptSeasonId, ...receiptSeasonSnapshot } =
              receipt.createdSeason;
            const isExactReplay =
              previousRequest.userId === user.userId &&
              previousRequest.tableName === "RankedSeason" &&
              receipt.requestId === requestId &&
              snapshotsMatch(receipt.submittedSeason, submittedSnapshot) &&
              receiptSeasonId === previousRequest.relatedId &&
              existingSnapshot !== undefined &&
              snapshotsMatch(receiptSeasonSnapshot, existingSnapshot);
            if (!isExactReplay || !existingSeason) {
              return errorResponse("Invalid ranked season creation request ID");
            }

            return {
              success: true,
              message: "Season was already created",
              requestId,
              submittedSeason,
              createdSeason: {
                id: existingSeason.id,
                name: existingSeason.name,
                description: existingSeason.description,
                startDate: existingSeason.startDate,
                endDate: existingSeason.endDate,
                rewards: existingSeason.rewards,
                paused: existingSeason.paused,
              },
            };
          }

          const currentSeason = await fetchCurrentSeason(tx);
          if (currentSeason) {
            return errorResponse("A season is already active");
          }

          // A caller without reputation permission cannot smuggle reputation through a crafted
          // client request. The submitted snapshot remains in the receipt for exact replay checks.
          const seasonData = {
            ...submittedSeason,
            rewards: canAwardReputation(user.role)
              ? submittedSeason.rewards
              : submittedSeason.rewards.map((divisionReward) => ({
                  ...divisionReward,
                  rewards: {
                    ...divisionReward.rewards,
                    reward_reputation: 0,
                  },
                })),
          };
          const id = nanoid();
          const createdSnapshot = { id, ...seasonSnapshot(seasonData) };

          await tx.insert(rankedSeason).values({ id, ...seasonData });
          await tx.insert(actionLog).values({
            id: receiptId,
            userId: user.userId,
            tableName: "RankedSeason",
            changes: {
              requestId,
              submittedSeason: submittedSnapshot,
              createdSeason: createdSnapshot,
            } satisfies CreateSeasonReceipt,
            relatedId: id,
            relatedMsg: "Created ranked season",
          });

          return {
            success: true,
            message: "Season created successfully",
            requestId,
            submittedSeason,
            createdSeason: { id, ...seasonData },
          };
        }),
      );
    }),

  // Update an existing season
  updateSeason: protectedProcedure
    .input(updateRankedSeasonSchema)
    .output(updateSeasonResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        id: seasonId,
        requestId,
        expectedUpdatedAt,
        ...rawSubmittedSeason
      } = input;
      const submittedSnapshot = seasonSnapshot(rawSubmittedSeason);
      const receiptId = `update-ranked-season:${requestId}`;

      return retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          // Match createSeason's lock order and keep all statements on this transaction
          // connection sequential. The full season-range lock serializes active-season checks.
          await tx.execute(
            sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} = ${ctx.userId} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT ${rankedSeason.id} FROM ${rankedSeason} ORDER BY ${rankedSeason.id} FOR UPDATE`,
          );

          const user = await tx.query.userData.findFirst({
            where: eq(userData.userId, ctx.userId),
          });
          const existingSeason = await tx.query.rankedSeason.findFirst({
            where: eq(rankedSeason.id, seasonId),
          });
          const previousRequest = await tx.query.actionLog.findFirst({
            where: eq(actionLog.id, receiptId),
          });

          if (!user) return errorResponse("Updating user not found");
          if (user.isBanned) {
            return errorResponse("You are banned and cannot update ranked seasons");
          }
          if (!canChangeContent(user.role)) {
            return errorResponse("You don't have permission to update ranked seasons");
          }

          if (previousRequest) {
            const parsedReceipt = updateSeasonReceiptSchema.safeParse(
              previousRequest.changes,
            );
            if (!parsedReceipt.success) {
              return errorResponse("Invalid ranked season update request ID");
            }
            const receipt = parsedReceipt.data;
            const currentSnapshot = existingSeason
              ? versionedSeasonSnapshot(existingSeason)
              : undefined;
            const exactReplay =
              previousRequest.userId === user.userId &&
              previousRequest.tableName === "RankedSeason" &&
              previousRequest.relatedId === seasonId &&
              receipt.requestId === requestId &&
              receipt.seasonId === seasonId &&
              receipt.expectedUpdatedAt === expectedUpdatedAt.toISOString() &&
              snapshotsMatch(receipt.submittedSeason, submittedSnapshot) &&
              currentSnapshot !== undefined &&
              valuesMatch(receipt.committedSeason, currentSnapshot);
            if (!exactReplay) {
              return errorResponse("Invalid ranked season update request ID");
            }

            return {
              success: true,
              message: "Season update was already saved",
              requestId,
              seasonId,
              expectedUpdatedAt,
              submittedSeason: rawSubmittedSeason,
              previousSeason: seasonResponse(receipt.previousSeason),
              committedSeason: seasonResponse(receipt.committedSeason),
            };
          }

          if (!existingSeason) return errorResponse("Season not found");
          if (existingSeason.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
            return errorResponse(
              "This season changed after the editor opened. Refresh it before saving.",
            );
          }

          const data = {
            ...rawSubmittedSeason,
            rewards: rawSubmittedSeason.rewards,
          };
          if (!canAwardReputation(user.role)) {
            data.rewards = data.rewards.map((divisionReward) => {
              const existingDivisionReward = existingSeason.rewards.find(
                (reward) => reward.division === divisionReward.division,
              );
              return {
                ...divisionReward,
                rewards: {
                  ...divisionReward.rewards,
                  reward_reputation:
                    existingDivisionReward?.rewards.reward_reputation ?? 0,
                },
              };
            });
          }

          const datesChanged =
            data.startDate.getTime() !== existingSeason.startDate.getTime() ||
            data.endDate.getTime() !== existingSeason.endDate.getTime();
          if (datesChanged && data.endDate <= data.startDate) {
            return errorResponse("End date must be after the start date");
          }
          const rewardError = validateSeasonRewardUpdate(
            existingSeason.rewards,
            data.rewards,
          );
          if (rewardError) return errorResponse(rewardError);

          const currentSeason = await fetchCurrentSeason(tx);
          if (
            currentSeason &&
            currentSeason.id !== seasonId &&
            data.endDate >= new Date()
          ) {
            return errorResponse("Another season is active, cannot update this season");
          }

          const previousSnapshot = versionedSeasonSnapshot(existingSeason);
          const nextUpdatedAt = new Date(
            Math.max(Date.now(), existingSeason.updatedAt.getTime() + 1),
          );
          const updateResult = await tx
            .update(rankedSeason)
            .set({ ...data, updatedAt: nextUpdatedAt })
            .where(
              and(
                eq(rankedSeason.id, seasonId),
                eq(rankedSeason.updatedAt, expectedUpdatedAt),
              ),
            );
          if (affectedRows(updateResult) !== 1) {
            return errorResponse(
              "This season changed while it was being saved. Refresh it before retrying.",
            );
          }

          const committedSnapshot: VersionedSeasonSnapshot = {
            id: seasonId,
            ...seasonSnapshot(data),
            updatedAt: nextUpdatedAt.toISOString(),
          };
          await tx.insert(actionLog).values({
            id: receiptId,
            userId: user.userId,
            tableName: "RankedSeason",
            changes: {
              requestId,
              seasonId,
              expectedUpdatedAt: expectedUpdatedAt.toISOString(),
              submittedSeason: submittedSnapshot,
              previousSeason: previousSnapshot,
              committedSeason: committedSnapshot,
            } satisfies UpdateSeasonReceipt,
            relatedId: seasonId,
            relatedMsg: "Updated ranked season",
          });

          return {
            success: true,
            message: "Season updated successfully",
            requestId,
            seasonId,
            expectedUpdatedAt,
            submittedSeason: rawSubmittedSeason,
            previousSeason: seasonResponse(previousSnapshot),
            committedSeason: seasonResponse(committedSnapshot),
          };
        }),
      );
    }),

  // Delete a season
  deleteSeason: protectedProcedure
    .input(deleteRankedSeasonSchema)
    .output(deleteSeasonResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const { id: seasonId, requestId, expectedUpdatedAt, expectedSeason } = input;
      const submittedSnapshot = deleteSeasonSnapshot(expectedSeason);
      const receiptId = `delete-ranked-season:${requestId}`;

      return retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          // Keep the same lock order as ranked-season create/update. The full season range
          // serializes delete against those full-document writes, while the reward-range lock
          // serializes the unclaimed-only cleanup against a reward claim.
          await tx.execute(
            sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} = ${ctx.userId} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT ${rankedSeason.id} FROM ${rankedSeason} ORDER BY ${rankedSeason.id} FOR UPDATE`,
          );
          await tx.execute(
            sql`SELECT ${rankedUserRewards.id} FROM ${rankedUserRewards} WHERE ${rankedUserRewards.seasonId} = ${seasonId} ORDER BY ${rankedUserRewards.id} FOR UPDATE`,
          );

          const user = await tx.query.userData.findFirst({
            where: eq(userData.userId, ctx.userId),
          });
          const season = await tx.query.rankedSeason.findFirst({
            where: eq(rankedSeason.id, seasonId),
          });
          const previousRequest = await tx.query.actionLog.findFirst({
            where: eq(actionLog.id, receiptId),
          });

          if (!user) return errorResponse("Deleting user not found");
          if (user.isBanned) {
            return errorResponse("You are banned and cannot delete ranked seasons");
          }
          if (!canChangeContent(user.role)) {
            return errorResponse("You don't have permission to delete ranked seasons");
          }

          if (previousRequest) {
            const parsedReceipt = deleteSeasonReceiptSchema.safeParse(
              previousRequest.changes,
            );
            if (!parsedReceipt.success) {
              return errorResponse("Invalid ranked season deletion request ID");
            }
            const receipt = parsedReceipt.data;
            const remainingUnclaimedReward = await tx.query.rankedUserRewards.findFirst(
              {
                where: and(
                  eq(rankedUserRewards.seasonId, seasonId),
                  eq(rankedUserRewards.claimed, false),
                ),
              },
            );
            const exactReplay =
              previousRequest.userId === user.userId &&
              previousRequest.tableName === "RankedSeason" &&
              previousRequest.relatedId === seasonId &&
              receipt.requestId === requestId &&
              receipt.seasonId === seasonId &&
              receipt.expectedUpdatedAt === expectedUpdatedAt.toISOString() &&
              valuesMatch(receipt.expectedSeason, submittedSnapshot) &&
              valuesMatch(receipt.deletedSeason, submittedSnapshot) &&
              season === undefined &&
              remainingUnclaimedReward === undefined;
            if (!exactReplay) {
              return errorResponse("Invalid ranked season deletion request ID");
            }

            return {
              success: true,
              message: "Season was already deleted",
              requestId,
              seasonId,
              expectedUpdatedAt,
              expectedSeason,
              deletedSeason: deleteSeasonResponse(receipt.deletedSeason),
              deletedUnclaimedRewardIds: receipt.deletedUnclaimedRewardIds,
              deletedUnclaimedRewardCount: receipt.deletedUnclaimedRewardIds.length,
              deleted: true as const,
            };
          }

          if (!season) return errorResponse("Season not found");
          const currentSnapshot = deleteSeasonSnapshot(season);
          if (
            season.updatedAt.getTime() !== expectedUpdatedAt.getTime() ||
            !valuesMatch(currentSnapshot, submittedSnapshot)
          ) {
            return errorResponse(
              "This season changed after the confirmation opened. Refresh it before deleting.",
            );
          }
          const unclaimedRewards = await tx.query.rankedUserRewards.findMany({
            where: and(
              eq(rankedUserRewards.seasonId, seasonId),
              eq(rankedUserRewards.claimed, false),
            ),
            columns: { id: true },
          });
          const deletedUnclaimedRewardIds = unclaimedRewards
            .map((reward) => reward.id)
            .sort();

          if (deletedUnclaimedRewardIds.length > 0) {
            const rewardDelete = await tx
              .delete(rankedUserRewards)
              .where(
                and(
                  eq(rankedUserRewards.seasonId, seasonId),
                  eq(rankedUserRewards.claimed, false),
                ),
              );
            if (affectedRows(rewardDelete) !== deletedUnclaimedRewardIds.length) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Season rewards changed while the season was being deleted",
              });
            }
          }

          const seasonDelete = await tx
            .delete(rankedSeason)
            .where(
              and(
                eq(rankedSeason.id, seasonId),
                eq(rankedSeason.updatedAt, expectedUpdatedAt),
              ),
            );
          if (affectedRows(seasonDelete) !== 1) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Season changed while it was being deleted",
            });
          }

          await tx.insert(actionLog).values({
            id: receiptId,
            userId: user.userId,
            tableName: "RankedSeason",
            changes: {
              requestId,
              seasonId,
              expectedUpdatedAt: expectedUpdatedAt.toISOString(),
              expectedSeason: submittedSnapshot,
              deletedSeason: currentSnapshot,
              deletedUnclaimedRewardIds,
            } satisfies DeleteSeasonReceipt,
            relatedId: seasonId,
            relatedMsg: "Deleted ranked season",
          });

          return {
            success: true,
            message: "Season deleted successfully",
            requestId,
            seasonId,
            expectedUpdatedAt,
            expectedSeason,
            deletedSeason: deleteSeasonResponse(currentSnapshot),
            deletedUnclaimedRewardIds,
            deletedUnclaimedRewardCount: deletedUnclaimedRewardIds.length,
            deleted: true as const,
          };
        }),
      );
    }),

  // End a season manually
  endSeason: protectedProcedure
    .input(endRankedSeasonSchema)
    .output(endSeasonResponseSchema)
    .mutation(async ({ ctx, input }) => {
      return await endRankedSeason(ctx.drizzle, input.id, {
        actorUserId: ctx.userId,
        request: input,
      });
    }),

  // Get the ranked loadout
  getRankedLoadout: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get user's ranked PvP loadout" } })
    .query(async ({ ctx }) => {
      let loadout = await ctx.drizzle.query.rankedLoadout.findFirst({
        where: eq(rankedLoadout.userId, ctx.userId),
      });
      if (!loadout) {
        loadout = {
          id: nanoid(),
          userId: ctx.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
          loadout: {
            jutsuIds: [],
            weaponIds: [],
            consumableIds: [],
            favoriteJutsuIds: [],
            favoriteWeaponIds: [],
            favoriteConsumableIds: [],
          },
        };
        await ctx.drizzle.insert(rankedLoadout).values(loadout);
      }
      return loadout;
    }),

  // Get the ranked PvP queue
  getRankedPvpQueue: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get user's ranked PvP queue status" } })
    .query(async ({ ctx }) => {
      // Query
      const [user, queueEntry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserRankedQueue(ctx.drizzle, ctx.userId),
      ]);
      // Cleanups ub case of bad queuing state
      if (user.status !== "QUEUED" && queueEntry) {
        await deleteUserRankedQueueRow(ctx.drizzle, ctx.userId);
      } else if (user.status === "QUEUED" && !queueEntry) {
        await ctx.drizzle
          .update(userData)
          .set({ status: "ASLEEP" })
          .where(eq(userData.userId, ctx.userId));
      }
      // Get the queue count
      const queueCount = await ctx.drizzle
        .select({ count: sql<number>`count(*)` })
        .from(rankedPvpQueue)
        .then((result) => result[0]?.count ?? 0);

      return {
        inQueue: !!queueEntry,
        createdAt: queueEntry?.queueStartTime,
        queueCount,
      };
    }),

  // Update the ranked loadout
  updateRankedLoadout: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Update user's ranked PvP loadout" } })
    .input(updateRankedLoadoutSchema)
    .output(
      baseServerResponse.extend({
        committed: z
          .object({
            userId: z.string(),
            loadoutId: z.string(),
            previousUpdatedAt: z.date(),
            updatedAt: z.date(),
            loadout: rankedLoadoutSchema,
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const {
        expectedLoadoutId,
        expectedUpdatedAt,
        jutsuIds,
        weaponIds,
        consumableIds,
        favoriteJutsuIds = [],
        favoriteWeaponIds = [],
        favoriteConsumableIds = [],
      } = input;
      const nextLoadout = {
        jutsuIds,
        weaponIds,
        consumableIds,
        favoriteJutsuIds,
        favoriteWeaponIds,
        favoriteConsumableIds,
      };
      const itemIds = [
        ...new Set([
          ...weaponIds,
          ...consumableIds,
          ...favoriteWeaponIds,
          ...favoriteConsumableIds,
        ]),
      ];
      const allJutsuIds = [...new Set([...jutsuIds, ...favoriteJutsuIds])];
      const allIdLists = [
        jutsuIds,
        weaponIds,
        consumableIds,
        favoriteJutsuIds,
        favoriteWeaponIds,
        favoriteConsumableIds,
      ];
      if (allIdLists.some((ids) => new Set(ids).size !== ids.length)) {
        return errorResponse("A ranked loadout cannot contain duplicate selections");
      }

      // Ranked loadouts use the public, free catalog rather than owned inventory. Keep the
      // server's selectable set identical to the editor instead of trusting client-supplied IDs.
      const [user, items, jutsus, currentLoadout] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        itemIds.length > 0
          ? ctx.drizzle.query.item.findMany({
              where: inArray(item.id, itemIds),
            })
          : [],
        allJutsuIds.length > 0
          ? ctx.drizzle.query.jutsu.findMany({
              where: inArray(jutsu.id, allJutsuIds),
            })
          : [],
        ctx.drizzle.query.rankedLoadout.findFirst({
          where: and(
            eq(rankedLoadout.id, expectedLoadoutId),
            eq(rankedLoadout.userId, ctx.userId),
          ),
        }),
      ]);
      if (user.isBanned) {
        return errorResponse("You are banned and cannot update a ranked loadout");
      }
      if (!currentLoadout) {
        return errorResponse(
          "This ranked loadout is no longer available; refresh and try again",
        );
      }
      const itemById = new Map(items.map((entry) => [entry.id, entry]));
      const jutsuById = new Map(jutsus.map((entry) => [entry.id, entry]));
      const newFavoriteWeaponIds = favoriteWeaponIds.filter(
        (id) => !(currentLoadout.loadout.favoriteWeaponIds ?? []).includes(id),
      );
      const newFavoriteConsumableIds = favoriteConsumableIds.filter(
        (id) => !(currentLoadout.loadout.favoriteConsumableIds ?? []).includes(id),
      );
      const newFavoriteJutsuIds = favoriteJutsuIds.filter(
        (id) => !(currentLoadout.loadout.favoriteJutsuIds ?? []).includes(id),
      );
      const selectableItem = (id: string, expectedType: "WEAPON" | "CONSUMABLE") => {
        const entry = itemById.get(id);
        return (
          entry?.itemType === expectedType &&
          entry.inShop &&
          !entry.hidden &&
          !entry.isEventItem &&
          entry.repsCost === 0 &&
          entry.seichiSilverCost === 0
        );
      };
      if (
        !weaponIds.every((id) => selectableItem(id, "WEAPON")) ||
        !newFavoriteWeaponIds.every((id) => selectableItem(id, "WEAPON")) ||
        !consumableIds.every((id) => selectableItem(id, "CONSUMABLE")) ||
        !newFavoriteConsumableIds.every((id) => selectableItem(id, "CONSUMABLE"))
      ) {
        return errorResponse("Some items are not selectable for a ranked loadout");
      }
      const selectableJutsu = (id: string) => {
        const entry = jutsuById.get(id);
        return (
          entry?.jutsuType === "NORMAL" &&
          !entry.hidden &&
          !entry.effects.some((effect) => effect.type === "summon")
        );
      };
      if (
        !jutsuIds.every(selectableJutsu) ||
        !newFavoriteJutsuIds.every(selectableJutsu)
      ) {
        return errorResponse("Some jutsus are not selectable for a ranked loadout");
      }

      // Check loadout
      const equippedJutsus = jutsuIds.flatMap((id) => {
        const entry = jutsuById.get(id);
        return entry ? [entry] : [];
      });
      const equippedItems = [...weaponIds, ...consumableIds].flatMap((id) => {
        const entry = itemById.get(id);
        return entry ? [entry] : [];
      });
      const jutsuCheck = validateJutsuLoadout(equippedJutsus);
      const itemCheck = validateItemLoadout(equippedItems);
      if (!jutsuCheck.check || !itemCheck.check) {
        return errorResponse(jutsuCheck.message || itemCheck.message);
      }

      if (currentLoadout.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        const currentSnapshot = {
          jutsuIds: currentLoadout.loadout.jutsuIds,
          weaponIds: currentLoadout.loadout.weaponIds,
          consumableIds: currentLoadout.loadout.consumableIds,
          favoriteJutsuIds: currentLoadout.loadout.favoriteJutsuIds ?? [],
          favoriteWeaponIds: currentLoadout.loadout.favoriteWeaponIds ?? [],
          favoriteConsumableIds: currentLoadout.loadout.favoriteConsumableIds ?? [],
        };
        // Replaying a full setter after its response was lost is safe and should report the
        // already-committed value rather than making the user guess whether the save landed.
        if (JSON.stringify(currentSnapshot) === JSON.stringify(nextLoadout)) {
          return {
            success: true,
            message: "Ranked loadout already saved",
            committed: {
              userId: ctx.userId,
              loadoutId: currentLoadout.id,
              previousUpdatedAt: expectedUpdatedAt,
              updatedAt: currentLoadout.updatedAt,
              loadout: currentSnapshot,
            },
          };
        }
        return errorResponse(
          "This ranked loadout changed elsewhere; refresh before saving again",
        );
      }

      // Always advance the millisecond revision, even when two saves land within one clock tick.
      const updatedAt = new Date(
        Math.max(Date.now(), currentLoadout.updatedAt.getTime() + 1),
      );
      const updateResult = await ctx.drizzle
        .update(rankedLoadout)
        .set({ loadout: nextLoadout, updatedAt })
        .where(
          and(
            eq(rankedLoadout.id, currentLoadout.id),
            eq(rankedLoadout.userId, ctx.userId),
            eq(rankedLoadout.updatedAt, expectedUpdatedAt),
          ),
        );
      if (updateResult.rowsAffected !== 1) {
        const latest = await ctx.drizzle.query.rankedLoadout.findFirst({
          where: and(
            eq(rankedLoadout.id, currentLoadout.id),
            eq(rankedLoadout.userId, ctx.userId),
          ),
        });
        const latestSnapshot = latest
          ? {
              jutsuIds: latest.loadout.jutsuIds,
              weaponIds: latest.loadout.weaponIds,
              consumableIds: latest.loadout.consumableIds,
              favoriteJutsuIds: latest.loadout.favoriteJutsuIds ?? [],
              favoriteWeaponIds: latest.loadout.favoriteWeaponIds ?? [],
              favoriteConsumableIds: latest.loadout.favoriteConsumableIds ?? [],
            }
          : null;
        if (
          latest &&
          latestSnapshot &&
          JSON.stringify(latestSnapshot) === JSON.stringify(nextLoadout)
        ) {
          return {
            success: true,
            message: "Ranked loadout already saved",
            committed: {
              userId: ctx.userId,
              loadoutId: latest.id,
              previousUpdatedAt: expectedUpdatedAt,
              updatedAt: latest.updatedAt,
              loadout: latestSnapshot,
            },
          };
        }
        return errorResponse(
          "This ranked loadout changed elsewhere; refresh before saving again",
        );
      }
      return {
        success: true,
        message: "Ranked loadout updated successfully",
        committed: {
          userId: ctx.userId,
          loadoutId: currentLoadout.id,
          previousUpdatedAt: expectedUpdatedAt,
          updatedAt,
          loadout: nextLoadout,
        },
      };
    }),

  // Enter the ranked season
  enterRankedSeason: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Enter the current ranked season" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (!hasRequiredRank(user.rank, RANKED_REQUIRED_RANK)) {
        return errorResponse(
          `You need to be a ${capitalizeFirstLetter(RANKED_REQUIRED_RANK)} to enter the ranked season`,
        );
      }
      if (user.rankedLp > 0) {
        return errorResponse("You have already entered the ranked season");
      }
      if (user.villagePrestige < RANKED_ENTRY_COST) {
        return errorResponse(
          `You need to have ${RANKED_ENTRY_COST} village prestige to enter the ranked season`,
        );
      }
      // Mutation
      await ctx.drizzle
        .update(userData)
        .set({
          rankedLp: 150,
          villagePrestige: user.villagePrestige - RANKED_ENTRY_COST,
        })
        .where(eq(userData.userId, ctx.userId));
      return { success: true, message: "Ranked season entered successfully" };
    }),

  // Queue for ranked PVP battle
  queueForRankedPvp: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Join the ranked PvP matchmaking queue" },
    })
    .output(
      baseServerResponse.extend({
        battleId: z.string().optional(),
        removedJutsuIds: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx }) => {
      // Query
      const [existingQueue, user, currentLoadout, currentSeason] = await Promise.all([
        fetchUserRankedQueue(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.rankedLoadout.findFirst({
          where: eq(rankedLoadout.userId, ctx.userId),
        }),
        fetchCurrentSeason(ctx.drizzle),
      ]);
      // Guard
      if (existingQueue) {
        return errorResponse("Already in queue");
      }
      if (!hasRequiredRank(user.rank, RANKED_REQUIRED_RANK)) {
        return errorResponse(
          `You need to be a ${capitalizeFirstLetter(RANKED_REQUIRED_RANK)} to queue`,
        );
      }
      if (user.rankedLp < 1) {
        return errorResponse(
          "You need to have entered into the ranked season before you can queue",
        );
      }

      // Check if current season is paused
      if (currentSeason?.paused) {
        return errorResponse("Ranked season is currently paused");
      }

      // Validate loadout for residual jutsu limit
      if (
        currentLoadout?.loadout.jutsuIds.length ||
        currentLoadout?.loadout.weaponIds.length ||
        currentLoadout?.loadout.consumableIds.length
      ) {
        const [jutsus, items] = await Promise.all([
          currentLoadout.loadout.jutsuIds.length > 0
            ? ctx.drizzle.query.jutsu.findMany({
                where: inArray(jutsu.id, currentLoadout.loadout.jutsuIds),
              })
            : [],
          currentLoadout.loadout.weaponIds.length > 0 ||
          currentLoadout.loadout.consumableIds.length > 0
            ? ctx.drizzle.query.item.findMany({
                where: inArray(item.id, [
                  ...currentLoadout.loadout.weaponIds,
                  ...currentLoadout.loadout.consumableIds,
                ]),
              })
            : [],
        ]);

        // Check loadout
        const jutsuCheck = validateJutsuLoadout(jutsus);
        const itemCheck = validateItemLoadout(items);
        if (!jutsuCheck.check || !itemCheck.check) {
          return errorResponse(jutsuCheck.message || itemCheck.message);
        }
      }

      const result = await ctx.drizzle
        .update(userData)
        .set({ status: "QUEUED" })
        .where(and(eq(userData.userId, user.userId), eq(userData.status, "AWAKE")));
      if (result.rowsAffected === 0) return errorResponse("Need to be awake to queue");

      // Add to queue
      await ctx.drizzle.insert(rankedPvpQueue).values({
        id: nanoid(),
        userId: ctx.userId,
        rankedLp: user.rankedLp,
        queueStartTime: new Date(),
        createdAt: new Date(),
      });
      return { success: true, message: "Queued for ranked PvP" };
    }),

  // Leave the ranked PvP queue
  leaveRankedPvpQueue: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Leave the ranked PvP matchmaking queue" },
    })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      // Guard
      if (user.status !== "QUEUED") {
        return errorResponse("Not in the queue");
      }
      // Mutation. Capture the CAS result: if a concurrent match claimed us into a
      // battle between the guard read above and this update, the QUEUED-guarded
      // status update matches no rows.
      const [, leaveResult] = await Promise.all([
        deleteUserRankedQueueRow(ctx.drizzle, ctx.userId),
        // Guard on QUEUED so a concurrent match that already claimed us into a
        // battle (status BATTLE) is not clobbered back to AWAKE.
        ctx.drizzle
          .update(userData)
          .set({ status: "AWAKE" })
          .where(and(eq(userData.userId, ctx.userId), eq(userData.status, "QUEUED"))),
      ]);
      // No row matched: status changed between the guard read and this update.
      // That can mean a concurrent match claimed us into a battle, OR a failed
      // match rolled us back to AWAKE. The queue row is already deleted, so we are
      // out of the queue either way; re-read battleId (cold path) to report
      // accurately rather than assume a battle.
      if (leaveResult.rowsAffected === 0) {
        const current = await ctx.drizzle.query.userData.findFirst({
          columns: { battleId: true },
          where: eq(userData.userId, ctx.userId),
        });
        if (current?.battleId) {
          return errorResponse("You've been matched into a ranked battle");
        }
      }
      return { success: true, message: "Left ranked PvP queue" };
    }),

  // Check for ranked PvP matches
  checkRankedPvpMatches: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Check for available ranked PvP matches" },
    })
    .output(baseServerResponse.extend({ battleId: z.string().optional() }))
    .mutation(async ({ ctx }) => {
      // Get all queued players
      const [queuedPlayers, topPlayersLP] = await Promise.all([
        ctx.drizzle.query.rankedPvpQueue.findMany({
          with: { user: { columns: { status: true }, with: { rankedLoadout: true } } },
          orderBy: asc(rankedPvpQueue.queueStartTime),
        }),
        fetchSanninRankedPlayers(ctx.drizzle),
      ]);

      const userEntry = queuedPlayers.find((p) => p.userId === ctx.userId);
      // Guards
      if (!userEntry) {
        return { success: false, message: "", battleId: undefined };
      }
      // If we hold a queue row but are no longer QUEUED, the row is stale — e.g.
      // a crash between a successful match start and the queue cleanup left it
      // behind and our battle has since ended. Remove it and stop: otherwise
      // inQueue stays true (the client keeps polling) and the lost-claim restore
      // below would re-QUEUE us into unwanted matches.
      if (userEntry.user?.status !== "QUEUED") {
        await deleteUserRankedQueueRow(ctx.drizzle, ctx.userId);
        return { success: false, message: "", battleId: undefined };
      }
      // Derived
      const secondsInQueue = secondsPassed(userEntry.queueStartTime);
      const rankedRank = getRankedRank(userEntry.rankedLp, topPlayersLP);
      const lpRadius = getRankedRadius(secondsInQueue);
      const opponentEntry = queuedPlayers.find((opponent) => {
        if (opponent.userId === ctx.userId) return false;
        // Skip opponents that are no longer QUEUED: a crash between a successful
        // match and the queue-row delete can leave a BATTLE player with a
        // lingering queue row. This filter, with the QUEUED-only claim in
        // initiateBattle, keeps such a stale row from being matched (our own
        // stale row is removed by the caller-status guard above).
        if (opponent.user?.status !== "QUEUED") return false;
        return Math.abs(opponent.rankedLp - userEntry.rankedLp) <= lpRadius;
      });
      // Guard
      if (!opponentEntry) {
        return { success: false, message: "", battleId: undefined };
      }
      if (!userEntry.user.rankedLoadout || !opponentEntry.user.rankedLoadout) {
        return { success: false, message: "No loadout found", battleId: undefined };
      }
      // The atomic claim is inside initiateBattle: it transitions both
      // participants QUEUED -> BATTLE in one guarded UPDATE and rolls back
      // (resetting only the rows it touched to AWAKE) if it cannot claim both.
      // That userData status-CAS — not the queue table — is the single-winner
      // mutex, so we call it first and gate all cleanup on its success.
      const result = await initiateBattle(
        {
          userIds: [userEntry.userId],
          targetIds: [opponentEntry.userId],
          client: ctx.drizzle,
          biome: "arena",
          targetStatDistribution: RANKED_PVP_STATS,
          userStatDistribution: RANKED_PVP_STATS,
          forceLoadouts: [
            userEntry.user.rankedLoadout,
            opponentEntry.user.rankedLoadout,
          ],
          topPlayersLP,
        },
        "RANKED_PVP",
      );

      if (result.success && result.battleId) {
        const rankedPickRows = [
          ...userEntry.user.rankedLoadout.loadout.jutsuIds.map((jutsuId) => ({
            type: "jutsu" as const,
            contentId: jutsuId,
            battleType: "RANKED_PVP" as const,
            count: 1,
          })),
          ...userEntry.user.rankedLoadout.loadout.weaponIds.map((weaponId) => ({
            type: "item" as const,
            contentId: weaponId,
            battleType: "RANKED_PVP" as const,
            count: 1,
          })),
          ...userEntry.user.rankedLoadout.loadout.consumableIds.map((consumableId) => ({
            type: "consumable" as const,
            contentId: consumableId,
            battleType: "RANKED_PVP" as const,
            count: 1,
          })),
          ...opponentEntry.user.rankedLoadout.loadout.jutsuIds.map((jutsuId) => ({
            type: "jutsu" as const,
            contentId: jutsuId,
            battleType: "RANKED_PVP" as const,
            count: 1,
          })),
          ...opponentEntry.user.rankedLoadout.loadout.weaponIds.map((weaponId) => ({
            type: "item" as const,
            contentId: weaponId,
            battleType: "RANKED_PVP" as const,
            count: 1,
          })),
          ...opponentEntry.user.rankedLoadout.loadout.consumableIds.map(
            (consumableId) => ({
              type: "consumable" as const,
              contentId: consumableId,
              battleType: "RANKED_PVP" as const,
              count: 1,
            }),
          ),
        ];
        const postMatchTasks: PromiseLike<unknown>[] = [
          ctx.drizzle
            .delete(rankedPvpQueue)
            .where(inArray(rankedPvpQueue.userId, [ctx.userId, opponentEntry.userId])),
          ctx.drizzle
            .insert(logQueueLengths)
            .values({
              rankedRank: rankedRank,
              ceiledMinutes: Math.ceil(secondsInQueue / 60),
              count: 1,
            })
            .onDuplicateKeyUpdate({
              set: { count: sql`${logQueueLengths.count} + 1` },
            }),
        ];
        if (rankedPickRows.length > 0) {
          postMatchTasks.push(
            ctx.drizzle
              .insert(logRankedPicks)
              .values(rankedPickRows)
              .onDuplicateKeyUpdate({
                set: { count: sql`${logRankedPicks.count} + 1` },
              }),
          );
        }
        // Winner path only: remove both players from the queue and write match
        // logs. Gating these on success stops a losing poll from deleting queue
        // rows it never matched.
        await Promise.all(postMatchTasks);
        return { success: true, message: "Match found!", battleId: result.battleId };
      }

      // Lost the claim (opponent taken first, the caller already left, or both
      // already gone). Ranked rollback in initiateBattle restores any
      // temporarily claimed queue rows, so the next 5s poll can rematch.
      return { success: false, message: "", battleId: undefined };
    }),
});

/**
 * Fetch the user's ranked PvP queue
 * @param client - The Drizzle client
 * @param userId - The user's ID
 * @returns The queue entry
 */
export const fetchUserRankedQueue = async (client: DrizzleClient, userId: string) => {
  return await client.query.rankedPvpQueue.findFirst({
    where: and(eq(rankedPvpQueue.userId, userId)),
    columns: {
      queueStartTime: true,
    },
  });
};

/**
 * Delete a user's ranked PvP queue row. Reconciles a stale/orphaned row (one
 * that outlived its owner's QUEUED status) and backs leaving the queue.
 * @param client - The Drizzle client
 * @param userId - The user's ID
 */
export const deleteUserRankedQueueRow = (client: DrizzleClient, userId: string) =>
  client.delete(rankedPvpQueue).where(eq(rankedPvpQueue.userId, userId));

/**
 * Fetch all ranked seasons
 * @param client - The Drizzle client
 * @returns All ranked seasons
 */
export const fetchAllSeasons = async (client: DrizzleClient) => {
  return await client.query.rankedSeason.findMany({
    orderBy: (season, { desc }) => [desc(season.startDate)],
  });
};

/**
 * Fetch the current ranked season
 * @param client - The Drizzle client
 * @returns The current ranked season
 */
export const fetchCurrentSeason = async (client: DrizzleClient) => {
  const now = new Date();
  const season = await client.query.rankedSeason.findFirst({
    where: and(
      lte(rankedSeason.startDate, now),
      gte(rankedSeason.endDate, now),
      eq(rankedSeason.ended, false),
    ),
  });
  return season || null;
};

/**
 * Get the unclaimed season rewards for a user
 * @param client - The Drizzle client
 * @param userId - The user's ID
 * @returns The unclaimed season rewards
 */
export const getUnclaimedUserSeasonRewards = async (
  client: DrizzleClient,
  userId: string,
) => {
  const joinedResults = await client
    .select({
      id: rankedUserRewards.id,
      seasonId: rankedSeason.id,
      seasonName: rankedSeason.name,
      division: rankedUserRewards.division,
      claimed: rankedUserRewards.claimed,
      seasonRewards: rankedSeason.rewards,
      seasonEndDate: rankedSeason.endDate,
    })
    .from(rankedUserRewards)
    .innerJoin(rankedSeason, eq(rankedUserRewards.seasonId, rankedSeason.id))
    .where(
      and(eq(rankedUserRewards.userId, userId), eq(rankedUserRewards.claimed, false)),
    );
  return joinedResults.map((row) => {
    const divisionRewards = row.seasonRewards.find(
      (d) => d.division === row.division,
    )?.rewards;
    return { ...row, seasonRewards: divisionRewards };
  });
};

type EndRankedSeasonOptions = {
  actorUserId?: string;
  request?: z.infer<typeof endRankedSeasonSchema>;
  now?: Date;
};

/**
 * Atomically end a ranked season. The manual route supplies an immutable confirmation
 * snapshot and audit key; the daily job uses the same locking/write path without a staff
 * receipt. User rows are locked before the ranked-season range so create/update/delete/end
 * cannot form a user/season lock-order cycle. Every transaction statement remains sequential.
 */
export const endRankedSeason = async (
  client: DrizzleClient,
  seasonId: string,
  options: EndRankedSeasonOptions = {},
) => {
  const request = options.request;
  const submittedSnapshot = request
    ? deleteSeasonSnapshot(request.expectedSeason)
    : undefined;
  const receiptId = request ? `end-ranked-season:${request.requestId}` : undefined;

  return retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      if (options.actorUserId) {
        await tx.execute(
          sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} = ${options.actorUserId} FOR UPDATE`,
        );
      }

      // Ranked LP is a season-wide balance. Lock the bounded participating set before the
      // season range: reward division calculation and LP reset must observe one exact cohort.
      await tx.execute(
        sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.rankedLp} > 0 ORDER BY ${userData.userId} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT ${rankedSeason.id} FROM ${rankedSeason} ORDER BY ${rankedSeason.id} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT ${rankedUserRewards.id} FROM ${rankedUserRewards} WHERE ${rankedUserRewards.seasonId} = ${seasonId} ORDER BY ${rankedUserRewards.id} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT ${rankedPvpQueue.id} FROM ${rankedPvpQueue} ORDER BY ${rankedPvpQueue.id} FOR UPDATE`,
      );

      const actor = options.actorUserId
        ? await tx.query.userData.findFirst({
            where: eq(userData.userId, options.actorUserId),
          })
        : undefined;
      const season = await tx.query.rankedSeason.findFirst({
        where: eq(rankedSeason.id, seasonId),
      });
      const previousRequest = receiptId
        ? await tx.query.actionLog.findFirst({
            where: eq(actionLog.id, receiptId),
          })
        : undefined;

      if (options.actorUserId) {
        if (!actor) return errorResponse("Ending user not found");
        if (actor.isBanned) {
          return errorResponse("You are banned and cannot end ranked seasons");
        }
        if (!canChangeContent(actor.role)) {
          return errorResponse("You don't have permission to end ranked seasons");
        }
      }

      if (request && actor && previousRequest) {
        const parsedReceipt = endSeasonReceiptSchema.safeParse(previousRequest.changes);
        if (!parsedReceipt.success || !submittedSnapshot) {
          return errorResponse("Invalid ranked season ending request ID");
        }
        const receipt = parsedReceipt.data;
        const currentSnapshot = season ? deleteSeasonSnapshot(season) : undefined;
        const currentRewards = await tx.query.rankedUserRewards.findMany({
          where: eq(rankedUserRewards.seasonId, seasonId),
          columns: { id: true, userId: true, division: true },
        });
        const rewardById = new Map(currentRewards.map((reward) => [reward.id, reward]));
        const exactRewardsRemain = receipt.rewards.every((reward) => {
          const current = rewardById.get(reward.id);
          return (
            current?.userId === reward.userId && current.division === reward.division
          );
        });
        const exactReplay =
          previousRequest.userId === actor.userId &&
          previousRequest.tableName === "RankedSeason" &&
          previousRequest.relatedId === seasonId &&
          receipt.requestId === request.requestId &&
          receipt.seasonId === seasonId &&
          receipt.expectedUpdatedAt === request.expectedUpdatedAt.toISOString() &&
          valuesMatch(receipt.expectedSeason, submittedSnapshot) &&
          valuesMatch(receipt.previousSeason, submittedSnapshot) &&
          currentSnapshot !== undefined &&
          valuesMatch(receipt.committedSeason, currentSnapshot) &&
          exactRewardsRemain;
        if (!exactReplay) {
          return errorResponse("Invalid ranked season ending request ID");
        }

        return {
          success: true,
          message: "Season was already ended",
          requestId: request.requestId,
          seasonId,
          expectedUpdatedAt: request.expectedUpdatedAt,
          expectedSeason: request.expectedSeason,
          previousSeason: deleteSeasonResponse(receipt.previousSeason),
          committedSeason: deleteSeasonResponse(receipt.committedSeason),
          rewards: receipt.rewards,
          rewardCount: receipt.rewards.length,
          insertedRewardIds: receipt.insertedRewardIds,
          resetUserIds: receipt.resetUserIds,
          resetUserCount: receipt.resetUserIds.length,
          clearedQueueUserIds: receipt.clearedQueueUserIds,
          clearedQueueCount: receipt.clearedQueueUserIds.length,
          ended: true as const,
        };
      }

      if (previousRequest) {
        return errorResponse("Invalid ranked season ending request ID");
      }
      if (!season) {
        if (request) return errorResponse("Season not found");
        throw new Error("Season not found");
      }
      if (season.ended) {
        if (request) return errorResponse("Season already ended");
        return { success: true, message: "Season already ended", ended: true as const };
      }

      const previousSnapshot = deleteSeasonSnapshot(season);
      if (
        request &&
        (!submittedSnapshot ||
          season.updatedAt.getTime() !== request.expectedUpdatedAt.getTime() ||
          !valuesMatch(previousSnapshot, submittedSnapshot))
      ) {
        return errorResponse(
          "This season changed after the confirmation opened. Refresh it before ending.",
        );
      }

      const now = options.now ?? new Date();
      if (request && (season.startDate > now || season.endDate < now)) {
        return errorResponse("Only the currently active season can be ended manually");
      }

      const users = await tx.query.userData.findMany({
        columns: { userId: true, rankedLp: true },
        where: gt(userData.rankedLp, 0),
        orderBy: (users, { desc, asc }) => [desc(users.rankedLp), asc(users.userId)],
      });
      const existingRewards = await tx.query.rankedUserRewards.findMany({
        where: eq(rankedUserRewards.seasonId, seasonId),
        columns: { id: true, userId: true, division: true },
      });
      const queueEntries = await tx.query.rankedPvpQueue.findMany({
        columns: { id: true, userId: true },
      });

      const existingRewardsByUser = new Map<string, typeof existingRewards>();
      for (const reward of existingRewards) {
        const entries = existingRewardsByUser.get(reward.userId) ?? [];
        entries.push(reward);
        existingRewardsByUser.set(reward.userId, entries);
      }
      if ([...existingRewardsByUser.values()].some((rewards) => rewards.length > 1)) {
        const message =
          "Season rewards contain duplicate users; repair them before ending the season";
        if (request) return errorResponse(message);
        throw new Error(message);
      }

      const topPlayersLP = users
        .filter((user) => user.rankedLp >= RANKED_LEGEND_LP_REQUIREMENT)
        .slice(0, RANKED_SANNIN_TOP_PLAYERS)
        .map((user) => user.rankedLp);
      const rewards: EndSeasonRewardReceipt[] = [];
      const rewardsToInsert: Array<typeof rankedUserRewards.$inferInsert> = [];
      for (const user of users) {
        const existingReward = existingRewardsByUser.get(user.userId)?.[0];
        if (existingReward) {
          rewards.push(existingReward);
          continue;
        }
        const reward = {
          id: nanoid(),
          userId: user.userId,
          seasonId,
          division: getRankedRank(user.rankedLp, topPlayersLP),
        };
        rewardsToInsert.push(reward);
        rewards.push({
          id: reward.id,
          userId: reward.userId,
          division: reward.division,
        });
      }
      rewards.sort((left, right) => left.userId.localeCompare(right.userId));
      const insertedRewardIds = rewardsToInsert.map((reward) => reward.id).sort();
      const resetUserIds = users.map((user) => user.userId).sort();
      const clearedQueueUserIds = [
        ...new Set(queueEntries.map((entry) => entry.userId)),
      ].sort();

      if (rewardsToInsert.length > 0) {
        await tx.insert(rankedUserRewards).values(rewardsToInsert);
      }
      if (resetUserIds.length > 0) {
        const resetResult = await tx
          .update(userData)
          .set({ rankedLp: 0, rankedStreak: 0 })
          .where(inArray(userData.userId, resetUserIds));
        if (affectedRows(resetResult) !== resetUserIds.length) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Ranked participants changed while the season was ending",
          });
        }
      }
      if (clearedQueueUserIds.length > 0) {
        await tx
          .update(userData)
          .set({ status: "AWAKE" })
          .where(
            and(
              inArray(userData.userId, clearedQueueUserIds),
              eq(userData.status, "QUEUED"),
            ),
          );
      }
      if (queueEntries.length > 0) {
        const queueDelete = await tx.delete(rankedPvpQueue);
        if (affectedRows(queueDelete) !== queueEntries.length) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Ranked queue changed while the season was ending",
          });
        }
      }

      const nextUpdatedAt = new Date(
        Math.max(now.getTime(), season.updatedAt.getTime() + 1),
      );
      const seasonUpdate = await tx
        .update(rankedSeason)
        .set({ ended: true, endDate: now, updatedAt: nextUpdatedAt })
        .where(
          and(
            eq(rankedSeason.id, seasonId),
            eq(rankedSeason.updatedAt, season.updatedAt),
            eq(rankedSeason.ended, false),
          ),
        );
      if (affectedRows(seasonUpdate) !== 1) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Season changed while it was being ended",
        });
      }

      const committedSnapshot: DeleteSeasonSnapshot = {
        ...previousSnapshot,
        endDate: now.toISOString(),
        ended: true,
        updatedAt: nextUpdatedAt.toISOString(),
      };

      if (request && actor && receiptId && submittedSnapshot) {
        await tx.insert(actionLog).values({
          id: receiptId,
          userId: actor.userId,
          tableName: "RankedSeason",
          changes: {
            requestId: request.requestId,
            seasonId,
            expectedUpdatedAt: request.expectedUpdatedAt.toISOString(),
            expectedSeason: submittedSnapshot,
            previousSeason: previousSnapshot,
            committedSeason: committedSnapshot,
            rewards,
            insertedRewardIds,
            resetUserIds,
            clearedQueueUserIds,
          } satisfies EndSeasonReceipt,
          relatedId: seasonId,
          relatedMsg: "Ended ranked season",
        });
      }

      return {
        success: true,
        message: "Season ended successfully",
        requestId: request?.requestId,
        seasonId,
        expectedUpdatedAt: request?.expectedUpdatedAt,
        expectedSeason: request?.expectedSeason,
        previousSeason: deleteSeasonResponse(previousSnapshot),
        committedSeason: deleteSeasonResponse(committedSnapshot),
        rewards,
        rewardCount: rewards.length,
        insertedRewardIds,
        resetUserIds,
        resetUserCount: resetUserIds.length,
        clearedQueueUserIds,
        clearedQueueCount: clearedQueueUserIds.length,
        ended: true as const,
      };
    }),
  );
};
