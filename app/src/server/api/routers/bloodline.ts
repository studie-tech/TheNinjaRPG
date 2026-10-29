import { randomInt } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, isNotNull, isNull, like, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  BLOODLINE_COST,
  BLOODLINE_SWAP_COOLDOWN_HOURS,
  COST_SWAP_BLOODLINE,
  LetterRanks,
  PITY_SYSTEM_ENABLED,
  REMOVAL_COST,
  ROLL_CHANCE,
} from "@/drizzle/constants";
import {
  type Bloodline,
  type BloodlineRank,
  bloodline,
  bloodlineRolls,
  type UserData,
  userData,
} from "@/drizzle/schema";

import {
  filterRollableBloodlines,
  getFreeBloodlineSwaps,
  getPityRolls,
} from "@/libs/bloodline";
import { getBloodlinePassivePatch } from "@/libs/bloodlineUserCache";
import { bloodrightSwapRefund } from "@/libs/bloodright";
import {
  deletedReason,
  editedReason,
  outdateProposalsFor,
} from "@/libs/contentReview/outdate";
import { validateUserUpdateReason } from "@/libs/moderator";
import { callDiscordContent } from "@/libs/socials";
import {
  deleteBloodlineForDelete,
  deleteBloodlineReskinForDeleteReskin,
  fetchBloodline,
  fetchBloodlineCacheUser,
  fetchBloodlineReskin,
  fetchBloodlines,
  fetchItemBloodlineRolls,
  fetchMonthlyBloodlineSwaps,
  fetchNaturalBloodlineRoll,
  fetchUserHistoricBloodlines,
  findActionLogForSwapBloodline,
  findBloodlineCacheState,
  findBloodlineForUpdate,
  findBloodlineReskinForUpdateReskin,
  findBloodlineRollsForRoll,
  insertActionLogForCreateReskin,
  insertActionLogForDelete,
  insertActionLogForDeleteReskin,
  insertActionLogForRemoveBloodlineFromPool,
  insertActionLogForRemoveBloodlineFromPool2,
  insertActionLogForSwapBloodline,
  insertActionLogForUpdate,
  insertActionLogForUpdateBloodline,
  insertActionLogForUpdateReskin,
  insertActionLogForUpdateReskin2,
  insertBloodlineForCreate,
  insertBloodlineReskinForCreateReskin,
  insertBloodlineRollsForDoRoll,
  insertBloodlineRollsForDoRoll2,
  insertBloodlineRollsForPityRoll,
  insertBloodlineRollsForPurchaseBloodline,
  listBloodlineForGetAll,
  listBloodlineForGetAllNames,
  listBloodlineReskinForGetReskinsForBloodline,
  listJutsuForDeleteReskin,
  listJutsuForUpdateBloodline,
  listUserDataForDelete,
  selectBloodlineReskinForDeleteReskin,
  selectBloodlineReskinForGetAllReskins,
  selectBloodlineRollsForGetNaturalRollStatistics,
  selectBloodlineRollsForGetNaturalRollStatistics2,
  selectJutsuForDeleteReskin,
  updateBloodlineForUpdate,
  updateBloodlineReskinForUpdateReskin,
  updateUserDataForDelete,
  updateUserDataForDeleteReskin,
  updateUserDataForDoRoll,
  updateUserDataForUpdateBloodline,
  updateUserJutsuForUpdateBloodline,
} from "@/queries/bloodline";
import { refundPityCredit } from "@/queries/concurrency";
import { fetchAllGameSettings, fetchUser } from "@/queries/profile";
import { fetchUpdatedUser, getUserProgressionUpdate } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  claimUserSnapshot,
  removeBloodlineFromPoolAtomically,
  reservePityCredit,
} from "@/server/utils/concurrency";
import { setEmptyStringsToNulls } from "@/server/utils/emptyStrings";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { fetchQueuedJutsuIds } from "@/server/utils/userQueue";
import { getRandomElement } from "@/utils/array";
import { calculateContentDiff } from "@/utils/diff";
import { getUserFederalStatus } from "@/utils/paypal";
import {
  canChangeContent,
  canRemoveBloodlineFromPool,
  isStaffMember,
} from "@/utils/permissions";
import {
  getDaysHoursMinutesSeconds,
  getTimeLeftStr,
  secondsFromDate,
  secondsPassed,
} from "@/utils/time";
import {
  type BloodlineFilteringSchema,
  bloodlineFilteringSchema,
  bloodlineReskinCreateSchema,
  bloodlineReskinUpdateSchema,
  removeBloodlineFromPoolSchema,
} from "@/validators/bloodline";

import { BloodlineValidator, type ZodAllTags } from "@/validators/combat";

import { idSchema } from "@/validators/misc";

const ALREADY_HAS_BLOODLINE_ERROR = "Already have a bloodline, please remove it first";

import { userDeltaResponseSchema } from "@/validators/userCache";

export const bloodlineRouter = createTRPCRouter({
  getAllNames: publicProcedure
    .meta({ mcp: { description: "Get all bloodline names and images" } })
    .query(async ({ ctx }) => {
      return await listBloodlineForGetAllNames(ctx.drizzle);
    }),
  getAll: publicProcedure
    .meta({
      mcp: { description: "Get paginated bloodlines with filters" },
    })
    .input(
      bloodlineFilteringSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;

      // Build where conditions using the abstracted filter function
      const baseFilters = bloodlineDatabaseFilter(input);

      const results = await listBloodlineForGetAll(
        ctx.drizzle,
        baseFilters,
        skip,
        input,
      );
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),
  // Get a specific bloodline
  get: publicProcedure
    .meta({ mcp: { description: "Get a specific bloodline by ID" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const result = await fetchBloodline(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Bloodline not found");
      }
      return result as Omit<typeof result, "effects"> & { effects: ZodAllTags[] };
    }),
  // Create new bloodline
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (user.isBanned)
      return errorResponse("You are banned and cannot perform this action");
    if (canChangeContent(user.role)) {
      const id = nanoid();
      await insertBloodlineForCreate(ctx.drizzle, id);
      return { success: true, message: id };
    } else {
      return { success: false, message: `Not allowed to create bloodline` };
    }
  }),
  // Get all bloodlines a user has ever had
  getUserHistoricBloodlines: protectedProcedure
    .meta({ mcp: { description: "Get user's historic bloodlines" } })
    .query(async ({ ctx }) => {
      return await fetchUserHistoricBloodlines(ctx.drizzle, ctx.userId);
    }),
  getUserHistoricBloodlinesForStaff: protectedProcedure
    .meta({
      mcp: { description: "Get a user's historic bloodlines (staff)" },
    })
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [actor, historic] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserHistoricBloodlines(ctx.drizzle, input.userId),
      ]);
      if (!actor || actor.isBanned || !canRemoveBloodlineFromPool(actor.role)) {
        return [];
      }
      return historic;
    }),
  // Get bloodline swap info
  getSwapInfo: protectedProcedure
    .meta({
      mcp: {
        description: "Get bloodline swap availability and cost info",
      },
    })
    .query(async ({ ctx }) => {
      // Query
      const [{ user }, recentSwaps] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchMonthlyBloodlineSwaps(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (!user)
        return {
          isFree: false,
          freeSwapsUsed: 0,
          freeSwapsRemaining: 0,
          recentSwaps: [],
        };
      // Derived
      const federalStatus = getUserFederalStatus(user);
      const freeSwaps = getFreeBloodlineSwaps(federalStatus);
      const freeSwapsUsed = recentSwaps.length;
      const rawRemaining = freeSwaps - freeSwapsUsed;
      const freeSwapsRemaining = Math.max(0, rawRemaining);
      const isFree = freeSwapsRemaining > 0 || isStaffMember(user);
      // Return
      return { isFree, freeSwapsUsed, freeSwapsRemaining, recentSwaps };
    }),
  // Swap bloodline of session user
  swapBloodline: protectedProcedure
    .meta({
      mcp: { description: "Swap to a previously owned bloodline" },
    })
    .input(z.object({ bloodlineId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [updatedUser, line, historicBloodlines, lastTransfer, monthlySwaps] =
        await Promise.all([
          fetchUpdatedUser({
            client: ctx.drizzle,
            userId: ctx.userId,
          }),
          fetchBloodline(ctx.drizzle, input.bloodlineId),
          fetchUserHistoricBloodlines(ctx.drizzle, ctx.userId),
          findActionLogForSwapBloodline(ctx.drizzle, ctx),
          fetchMonthlyBloodlineSwaps(ctx.drizzle, ctx.userId),
        ]);
      const user = updatedUser.user;
      // Guards
      if (!user) return errorResponse("User does not exist");
      if (!line) return errorResponse("Bloodline does not exist");
      if (user.status === "BATTLE")
        return errorResponse("You cannot change bloodline during battle");
      if (user.bloodlineId === line.id) {
        return errorResponse("You already have this bloodline");
      }

      // Check for free swap eligibility
      const federalStatus = getUserFederalStatus(user);
      const freeSwaps = getFreeBloodlineSwaps(federalStatus);
      const freeSwapsUsed = monthlySwaps.length;
      const hasFreeSwapAvailable = freeSwapsUsed < freeSwaps;
      const isStaffFreeSwap = isStaffMember(user);
      const isFreeSwap = hasFreeSwapAvailable || isStaffFreeSwap;

      if (!isFreeSwap && COST_SWAP_BLOODLINE > user.reputationPoints) {
        return errorResponse("Not enough reputation points");
      }
      if (!historicBloodlines.find((b) => b.id === line.id)) {
        return errorResponse("Bloodline is not in your history");
      }
      // Check if cooldown is over
      if (lastTransfer) {
        const canTransferAgainDate = secondsFromDate(
          BLOODLINE_SWAP_COOLDOWN_HOURS * 60 * 60,
          lastTransfer.createdAt,
        );
        if (canTransferAgainDate > new Date()) {
          const msLeft = -secondsPassed(canTransferAgainDate) * 1000;
          const timeLeft = getTimeLeftStr(...getDaysHoursMinutesSeconds(msLeft));
          return errorResponse(`You can swap again in ${timeLeft}`);
        }
      }

      // Update bloodline (this creates the "Bloodline Changed" log entry)
      const swapCost = isFreeSwap ? 0 : COST_SWAP_BLOODLINE;
      const swapMessage = `Bloodline Swapped from ${user.bloodline?.name} to ${line.name}`;
      try {
        await updateBloodline(ctx.drizzle, user, line, swapCost, swapMessage);
      } catch (error) {
        if (error instanceof BloodlineGrantRejectedError)
          return errorResponse(
            "Bloodline or battle status changed. Refresh and try again",
          );
        throw error;
      }

      // Log federal free swaps for monthly Silver/Gold tracking (staff benefit takes priority)
      if (hasFreeSwapAvailable && !isStaffFreeSwap) {
        await insertActionLogForSwapBloodline(
          ctx.drizzle,
          ctx,
          federalStatus,
          line,
          user,
        );
      }

      const lineagePatch = await bloodlineCachePatch(
        ctx.drizzle,
        user,
        line,
        updatedUser.settings,
      );
      const progression =
        updatedUser.requiresProgressionRefresh === false && lineagePatch
          ? getUserProgressionUpdate(user, updatedUser.publishedAchievementIds)
          : undefined;
      return {
        ...(progression
          ? { ...progression, userPatch: { ...progression.userPatch, ...lineagePatch } }
          : {}),
        success: true,
        message: `Bloodline swapped${isFreeSwap ? (isStaffFreeSwap ? " (Free for staff member)" : ` (Free for ${federalStatus} supporter)`) : ""}`,
      };
    }),
  // Bloodline reskins (staff-only creation & moderation)
  createReskin: protectedProcedure
    .input(bloodlineReskinCreateSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, base] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBloodline(ctx.drizzle, input.bloodlineId),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!base) return errorResponse("Base bloodline not found");
      if (!canChangeContent(user.role)) return errorResponse("Unauthorized");
      // Mutate
      const id = nanoid();
      const resolvedImage = input.image ?? base.image;
      await Promise.all([
        insertBloodlineReskinForCreateReskin(
          ctx.drizzle,
          id,
          base,
          input,
          resolvedImage,
          ctx,
        ),
        insertActionLogForCreateReskin(ctx.drizzle, ctx, base, input, resolvedImage),
      ]);
      return { success: true, message: id };
    }),
  updateReskin: protectedProcedure
    .input(z.object({ reskinId: z.string(), data: bloodlineReskinUpdateSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, reskin, reskinWithName] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBloodlineReskin(ctx.drizzle, input.reskinId),
        input.data.name
          ? findBloodlineReskinForUpdateReskin(ctx.drizzle, {
              data: { name: input.data.name },
              reskinId: input.reskinId,
            })
          : null,
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!reskin) return errorResponse("Reskin not found");
      if (reskinWithName && reskinWithName.id !== reskin.id) {
        return errorResponse("Reskin name already exists for this bloodline");
      }
      if (!canChangeContent(user.role)) return errorResponse("Unauthorized");
      // Prepare old/new objects for diff (exclude reason from new)
      const oldData = {
        name: reskin.name,
        description: reskin.description,
        image: reskin.image,
      } as const;
      const { reason, ...rest } = input.data;
      const newData = { ...rest } as const;
      const diff = calculateContentDiff(oldData, newData);
      // AI moderation of reason
      const aiCheck = await validateUserUpdateReason(diff.join(". "), reason);
      if (!aiCheck.allowUpdate) {
        await insertActionLogForUpdateReskin(ctx.drizzle, ctx, reskin, reason);
        return errorResponse(aiCheck.comment);
      }
      // Mutate
      await Promise.all([
        updateBloodlineReskinForUpdateReskin(ctx.drizzle, newData, reskin),
        insertActionLogForUpdateReskin2(ctx.drizzle, ctx, diff, reskin, newData),
      ]);

      return { success: true, message: "Bloodline reskin updated" };
    }),
  deleteReskin: protectedProcedure
    .input(z.object({ reskinId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, reskin, linkedJutsus] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBloodlineReskin(ctx.drizzle, input.reskinId),
        listJutsuForDeleteReskin(ctx.drizzle, input),
      ]);
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canChangeContent(user.role)) return errorResponse("Unauthorized");
      if (!reskin) return errorResponse("Reskin not found");
      if (linkedJutsus.length)
        return errorResponse(
          "Unlink or delete its jutsu reskins before deleting this bloodline reskin",
        );
      // Mutate
      const deleted = await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          await selectBloodlineReskinForDeleteReskin(tx, input);
          const children = await selectJutsuForDeleteReskin(tx, input);
          if (children.length) return false;
          await deleteBloodlineReskinForDeleteReskin(tx, input);
          return true;
        }),
      );
      if (!deleted)
        return errorResponse(
          "Unlink or delete its jutsu reskins before deleting this bloodline reskin",
        );
      await Promise.all([
        updateUserDataForDeleteReskin(ctx.drizzle, input),

        insertActionLogForDeleteReskin(ctx.drizzle, ctx, reskin),
      ]);
      return { success: true, message: "Bloodline reskin deleted" };
    }),
  removeBloodlineFromPool: protectedProcedure
    .input(removeBloodlineFromPoolSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [actor, target, targetPool] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, input.userId),
        fetchUserHistoricBloodlines(ctx.drizzle, input.userId),
      ]);
      // Guards
      if (!actor || !target) return errorResponse("User not found");
      if (actor.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canRemoveBloodlineFromPool(actor.role)) return errorResponse("Unauthorized");
      const poolBloodline = targetPool.find((b) => b.id === input.bloodlineId);
      if (!poolBloodline) return errorResponse("Bloodline is not in the player's pool");
      if (target.bloodlineId === input.bloodlineId) {
        return errorResponse(
          "Cannot remove the player's equipped bloodline; change it first",
        );
      }
      // AI moderation of reason
      const change = `Removed bloodline ${poolBloodline.name} from pool`;
      const aiCheck = await validateUserUpdateReason(change, input.reason);
      if (!aiCheck.allowUpdate) {
        await insertActionLogForRemoveBloodlineFromPool(
          ctx.drizzle,
          ctx,
          target,
          input,
        );
        return errorResponse(aiCheck.comment);
      }
      // Mutation (atomic, NOT EXISTS equipped guard) + audit
      const now = new Date();
      const success = await removeBloodlineFromPoolAtomically({
        client: ctx.drizzle,
        userId: target.userId,
        bloodlineId: input.bloodlineId,
        now,
      });
      if (!success) {
        return errorResponse("Bloodline became equipped; please retry");
      }
      await insertActionLogForRemoveBloodlineFromPool2(
        ctx.drizzle,
        ctx,
        change,
        target,
        input,
      );
      return {
        success: true,
        message: `Removed ${poolBloodline.name} from ${target.username}'s pool`,
      };
    }),
  getReskin: protectedProcedure
    .meta({ mcp: { description: "Get a specific bloodline reskin" } })
    .input(z.object({ reskinId: z.string() }))
    .query(async ({ ctx, input }) => {
      const res = await fetchBloodlineReskin(ctx.drizzle, input.reskinId);
      return res ?? errorResponse("Reskin not found");
    }),
  getReskinsForBloodline: protectedProcedure
    .meta({ mcp: { description: "Get all reskins for a bloodline" } })
    .input(z.object({ bloodlineId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await listBloodlineReskinForGetReskinsForBloodline(
        ctx.drizzle,
        input,
      );
      return rows;
    }),
  getAllReskins: publicProcedure
    .meta({ mcp: { description: "Get paginated bloodline reskins" } })
    .input(
      bloodlineFilteringSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(1000),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ?? 0;
      const skip = currentCursor * input.limit;
      const baseFilters = bloodlineDatabaseFilter(input);
      const rows = await selectBloodlineReskinForGetAllReskins(
        ctx.drizzle,
        baseFilters,
        skip,
        input,
      );
      const results = rows.map((row) => ({
        ...row.reskin,
        userUsername: row.userUsername,
        bloodline: row.base,
      }));
      const nextCursor = rows.length < input.limit ? null : currentCursor + 1;
      return { data: results, nextCursor };
    }),
  // Delete a bloodline
  delete: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, entry, usersWithBloodline] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBloodline(ctx.drizzle, input.id),
        listUserDataForDelete(ctx.drizzle, input),
      ]);
      // Derived
      const usernames = usersWithBloodline.map((u) => u.username).join(", ");
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Bloodline does not exist");
      if (!user) return errorResponse("User does not exist");
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to delete bloodline");
      }
      if (usersWithBloodline.length > 0) {
        return errorResponse(`Bloodline used by users: ${usernames}, cannot delete`);
      }
      // Mutate
      const bloodrightRefund = bloodrightSwapRefund(null);
      await Promise.all([
        deleteBloodlineForDelete(ctx.drizzle, input),
        updateUserDataForDelete(ctx.drizzle, bloodrightRefund, input),
        insertActionLogForDelete(ctx.drizzle, ctx, entry),
      ]);
      await outdateProposalsFor(
        ctx.drizzle,
        "BLOODLINE",
        [entry.id],
        deletedReason("BLOODLINE", entry.name, user.username),
      );
      return { success: true, message: `Bloodline deleted` };
    }),
  // Update a bloodline
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: BloodlineValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry, bloodlineWithName] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBloodline(ctx.drizzle, input.id),
        findBloodlineForUpdate(ctx.drizzle, input),
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Bloodline not found");
      if (bloodlineWithName && bloodlineWithName.id !== entry.id)
        return errorResponse("Bloodline name already exists");
      if (canChangeContent(user.role)) {
        // Prepare data: convert empty strings to null for optional fields
        setEmptyStringsToNulls(
          input.data as unknown as Record<string, unknown>,
          bloodline,
        );
        // Calculate diff
        const newData = {
          ...input.data,
          effects: input.data.effects.map((e) => {
            delete e.rounds;
            delete e.friendlyFire;
            return e;
          }),
        };
        const diff = calculateContentDiff(entry, {
          id: entry.id,
          updatedAt: entry.updatedAt,
          createdAt: entry.createdAt,
          ...newData,
        });
        // Update database
        await updateBloodlineForUpdate(ctx.drizzle, newData, input);
        await Promise.all([
          insertActionLogForUpdate(ctx.drizzle, ctx, diff, entry),
          outdateProposalsFor(
            ctx.drizzle,
            "BLOODLINE",
            [entry.id],
            editedReason("BLOODLINE", entry.name, user.username),
          ),
        ]);
        if (process.env.NODE_ENV !== "development") {
          await callDiscordContent(user.username, entry.name, diff, entry.image);
        }
        return { success: true, message: `Data updated: ${diff.join(". ")}` };
      } else {
        return { success: false, message: `Not allowed to edit bloodline` };
      }
    }),
  // Get bloodline roll of a specific user
  getNaturalRolls: protectedProcedure
    .meta({ mcp: { description: "Get user's natural bloodline roll" } })
    .query(async ({ ctx }) => {
      return (await fetchNaturalBloodlineRoll(ctx.drizzle, ctx.userId)) ?? null;
    }),
  getItemRolls: protectedProcedure
    .meta({ mcp: { description: "Get user's item bloodline rolls" } })
    .query(async ({ ctx }) => {
      return await fetchItemBloodlineRolls(ctx.drizzle, ctx.userId);
    }),
  // Get statistics about natural bloodline rolls grouped by rank
  getNaturalRollStatistics: publicProcedure
    .meta({
      mcp: { description: "Get bloodline roll statistics by rank" },
    })
    .query(async ({ ctx }) => {
      const stats = await selectBloodlineRollsForGetNaturalRollStatistics(ctx.drizzle);

      // Create a complete result with all ranks, even those with zero counts
      const result: Record<BloodlineRank, number> = {
        D: 0,
        C: 0,
        B: 0,
        A: 0,
        S: 0,
        H: 0,
      };

      // Fill in the actual counts from the query
      stats.forEach((stat) => {
        if (stat.rank) {
          result[stat.rank] = stat.count;
        }
      });

      // Also count rolls with no bloodline (null bloodlineId)
      const noBloodlineCount = await selectBloodlineRollsForGetNaturalRollStatistics2(
        ctx.drizzle,
      );

      return {
        ...result,
        none: noBloodlineCount[0]?.count || 0,
      };
    }),
  // Natural bloodline roll: CAS on userData.updatedAt before RNG; unique index allows one NATURAL row per user.
  roll: protectedProcedure
    .meta({ mcp: { description: "Roll for a natural bloodline" } })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      const [user, prevRoll, allBloodlines, registrationRoll, settings] =
        await Promise.all([
          fetchBloodlineCacheUser(ctx.drizzle, ctx.userId),
          fetchNaturalBloodlineRoll(ctx.drizzle, ctx.userId),
          fetchBloodlines(ctx.drizzle), // Fetch all bloodlines
          findBloodlineRollsForRoll(ctx.drizzle, ctx),
          fetchAllGameSettings(ctx.drizzle),
        ]);
      // Guard
      if (!user) return errorResponse("User not found");
      if (prevRoll) return errorResponse("You have already rolled a bloodline");
      if (user.status !== "AWAKE") {
        return errorResponse(
          `Cannot roll bloodline while ${user.status.toLowerCase()}`,
        );
      }
      if (user.rank === "STUDENT") {
        return errorResponse(
          "Academy students cannot roll for bloodlines. You must graduate first.",
        );
      }

      // Starter bloodline chosen at registration still uses userData.bloodlineId, but no NATURAL
      // roll row exists yet. Allow one natural roll to replace/confirm genetics like a new player
      // without a free bloodline (swap only if RNG grants a bloodline; "no bloodline" keeps starter).
      const starterBloodlineId =
        user.bloodlineId &&
        registrationRoll?.bloodlineId &&
        registrationRoll.bloodlineId === user.bloodlineId
          ? user.bloodlineId
          : null;

      const claimResult = await claimUserSnapshot({
        client: ctx.drizzle,
        userId: ctx.userId,
        updatedAt: user.updatedAt,
        where: [
          eq(userData.status, "AWAKE"),
          ne(userData.rank, "STUDENT"),
          starterBloodlineId
            ? eq(userData.bloodlineId, starterBloodlineId)
            : isNull(userData.bloodlineId),
        ],
      });
      if (!claimResult.success) {
        return errorResponse("You have already rolled a bloodline");
      }

      /**
       * Roll a bloodline. Defined like this to make testing of many rolls easier
       * @returns {Promise<{success: boolean, message: string}>}
       */
      const doRoll = async () => {
        const rand = randomInt(0, 1_000_000) / 1_000_000;
        let bloodlineRank: BloodlineRank | undefined;
        if (rand < ROLL_CHANCE.S) {
          bloodlineRank = "S";
        } else if (rand < ROLL_CHANCE.A) {
          bloodlineRank = "A";
        } else if (rand < ROLL_CHANCE.B) {
          bloodlineRank = "B";
        } else if (rand < ROLL_CHANCE.C) {
          bloodlineRank = "C";
        }
        // If a rank was determined, use filterRollableBloodlines to select a bloodline
        if (bloodlineRank) {
          const bloodlinePool = filterRollableBloodlines({
            bloodlines: allBloodlines,
            rank: bloodlineRank,
            user,
            previousRolls: [], // No previous rolls to consider for this standard roll
          });
          const randomBloodline = getRandomElement(bloodlinePool);
          if (randomBloodline) {
            const bloodlineUpdateResult = await updateUserDataForDoRoll(
              ctx.drizzle,
              randomBloodline,
              ctx,
              starterBloodlineId,
            );
            if (bloodlineUpdateResult.rowsAffected === 0) {
              return errorResponse("You have already rolled a bloodline");
            }
            try {
              await insertBloodlineRollsForDoRoll(ctx.drizzle, ctx, randomBloodline);
            } catch (error) {
              if (isMysqlDuplicateKeyError(error)) {
                return errorResponse("You have already rolled a bloodline");
              }
              throw error;
            }
            return {
              success: true,
              userPatch: await bloodlineCachePatch(
                ctx.drizzle,
                user,
                randomBloodline,
                settings,
              ),
              message: `After thorough examination, a bloodline was detected: ${randomBloodline.name}`,
            };
          }
        }
        // If no bloodline was found, proceed with the normal "no bloodline" case
        try {
          await insertBloodlineRollsForDoRoll2(ctx.drizzle, ctx);
        } catch (error) {
          if (isMysqlDuplicateKeyError(error)) {
            return errorResponse("You have already rolled a bloodline");
          }
          throw error;
        }
        return {
          success: false,
          message:
            "After thorough examination, the doctors conclude you have no bloodline",
        };
      };
      return doRoll();
    }),
  // Pity Roll a bloodline
  pityRoll: protectedProcedure
    .meta({ mcp: { description: "Use pity roll for a bloodline" } })
    .input(z.object({ rank: z.enum(LetterRanks).optional().nullish() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, bloodlines, previousRolls, settings] = await Promise.all([
        fetchBloodlineCacheUser(ctx.drizzle, ctx.userId),
        fetchBloodlines(ctx.drizzle),
        fetchItemBloodlineRolls(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      if (!user) return errorResponse("User not found");
      if (user.bloodlineId) {
        return errorResponse(ALREADY_HAS_BLOODLINE_ERROR);
      }
      // Derived
      const bloodlinePool = filterRollableBloodlines({
        bloodlines,
        user,
        previousRolls,
        rank: input.rank,
      });
      // Guard
      if (!PITY_SYSTEM_ENABLED) return errorResponse("Pity system is disabled");
      const prevRoll = previousRolls.find(
        (r) => r.goal === input.rank && !r.bloodlineId,
      );
      if (!prevRoll) return errorResponse("No previous roll found");
      const availablePityRolls = getPityRolls(prevRoll);
      if (availablePityRolls <= 0) return errorResponse("No pity rolls available");
      const randomBloodline = getRandomElement(bloodlinePool);
      if (!randomBloodline) return errorResponse("No bloodlines in the pool?");
      // Consume one pity credit atomically BEFORE granting the bloodline. The CAS on the
      // pre-read pityRolls value serializes concurrent claims: a request racing on a
      // stale count (e.g. claim -> remove the granted bloodline -> claim again before this
      // increment lands) gets false and aborts here, so a single earned credit
      // can never yield two grants. Reserving before the grant (not after) means the
      // loser stops before touching userData.bloodlineId at all.
      const reserved = await reservePityCredit({
        client: ctx.drizzle,
        table: bloodlineRolls,
        rollId: prevRoll.id,
        expectedPityRolls: prevRoll.pityRolls,
      });
      if (!reserved) {
        return errorResponse("No pity rolls available");
      }
      // Refund the reserved credit ONLY when the grant's own pre-write CAS rejected — signalled
      // structurally by BloodlineGrantRejectedError (rowsAffected 0, i.e. nothing was granted).
      // A raw DB error from its post-grant side-effect writes — or an ambiguous driver error
      // during the CAS — is NOT that marker, so the bloodline may already be granted, the credit
      // was legitimately spent, and it must not be handed back (avoids a grant + refund double
      // benefit even if a future edit throws a plain TRPCError from those side-effect writes).
      try {
        await updateBloodline(
          ctx.drizzle,
          user,
          randomBloodline,
          0,
          `Pity roll for ${input.rank}: ${randomBloodline.name}`,
        );
      } catch (error) {
        if (error instanceof BloodlineGrantRejectedError) {
          // Swallow refund failures: the grant rejection is the meaningful error for the caller,
          // and letting a transient refund error propagate would mask it. A dropped refund leaves
          // the credit reserved (user-visible as one missing pity roll) rather than double-spent.
          try {
            await refundPityCredit({
              client: ctx.drizzle,
              table: bloodlineRolls,
              rollId: prevRoll.id,
            });
          } catch (refundError) {
            console.error("Pity credit refund failed", refundError);
          }
        }
        throw error;
      }
      await insertBloodlineRollsForPityRoll(ctx.drizzle, ctx, randomBloodline, input);
      return {
        success: true,
        userPatch: await bloodlineCachePatch(
          ctx.drizzle,
          user,
          randomBloodline,
          settings,
        ),
        message: `You have been granted a bloodline: ${randomBloodline.name}`,
      };
    }),
  // Remove a bloodline from session user
  removeBloodline: protectedProcedure
    .meta({ mcp: { description: "Remove current bloodline" } })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      const [user, roll, settings] = await Promise.all([
        fetchBloodlineCacheUser(ctx.drizzle, ctx.userId),
        fetchNaturalBloodlineRoll(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      if (!user) return errorResponse("User not found");
      // Guard
      if (user.status === "BATTLE")
        return errorResponse("You cannot change bloodline during battle");
      if (!user.bloodlineId) {
        throw serverError("PRECONDITION_FAILED", "You do not have a bloodline");
      }
      const removalCost = user.bloodlineId === roll?.bloodlineId ? 0 : REMOVAL_COST;
      if (user.reputationPoints < removalCost)
        return errorResponse("You do not have enough reputation points");
      try {
        await updateBloodline(
          ctx.drizzle,
          user,
          null,
          removalCost,
          "Bloodline Removed",
        );
      } catch (error) {
        if (error instanceof BloodlineGrantRejectedError)
          return errorResponse(
            "Bloodline or battle status changed. Refresh and try again",
          );
        throw error;
      }
      return {
        success: true,
        userPatch: await bloodlineCachePatch(ctx.drizzle, user, null, settings),
        message: removalCost
          ? `Bloodline removed for ${REMOVAL_COST} reps`
          : "Bloodline removed for free",
      };
    }),
  // Purchase a bloodline for session user
  purchaseBloodline: protectedProcedure
    .meta({
      mcp: { description: "Purchase a bloodline with reputation" },
    })
    .input(z.object({ bloodlineId: z.string() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, line, settings] = await Promise.all([
        fetchBloodlineCacheUser(ctx.drizzle, ctx.userId),
        fetchBloodline(ctx.drizzle, input.bloodlineId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      if (!user) return errorResponse("User not found");
      // Guard
      if (!line) return errorResponse("Bloodline does not exist");
      if (user.bloodlineId) {
        return errorResponse("Already have bloodline, please remove first");
      }
      if (BLOODLINE_COST[line.rank] > user.reputationPoints) {
        return errorResponse("You do not have enough reputation points");
      }
      if (line.villageId && line.villageId !== user.villageId) {
        return errorResponse("Bloodline does not belong to your village");
      }
      // Update
      await updateBloodline(
        ctx.drizzle,
        user,
        line,
        BLOODLINE_COST[line.rank],
        `Bloodline Purchased: ${line.name}`,
      );
      await insertBloodlineRollsForPurchaseBloodline(ctx.drizzle, ctx, line);
      return {
        success: true,
        message: "Bloodline purchased",
        userPatch: await bloodlineCachePatch(ctx.drizzle, user, line, settings),
      };
    }),
});

/**
 * Update bloodline of user, ensuring the current blooline jutsus are unequipped
 */

/**
 * Marks a rejection before updateBloodline changes the user's bloodline. The pity handler
 * refunds the reserved credit exclusively on this marker, so post-grant side-effect failures
 * and ambiguous driver errors cannot trigger a grant + refund double benefit. Extends
 * TRPCError for BAD_REQUEST serialization and `instanceof TRPCError` handling.
 */
class BloodlineGrantRejectedError extends TRPCError {
  constructor(message: string) {
    super({ code: "BAD_REQUEST", message });
  }
}

export const updateBloodline = async (
  client: DrizzleClient,
  user: UserData,
  bloodline: Bloodline | null,
  repCost: number,
  logMsg: string,
) => {
  // Get current bloodline jutsus
  const [bloodlineJutsus, queued] = user.bloodlineId
    ? await Promise.all([
        listJutsuForUpdateBloodline(client, { bloodlineId: user.bloodlineId }).then(
          (rows) => rows.map((j) => j.id),
        ),
        fetchQueuedJutsuIds(client, user.userId),
      ])
    : [[], new Set<string>()];
  // Queued levels were bought for the current bloodline; the player cancels them for a
  // refund first. A level queued after this check is refunded when its turn comes.
  if (bloodlineJutsus.length > 0) {
    if (bloodlineJutsus.some((id) => queued.has(id))) {
      throw new BloodlineGrantRejectedError(
        "Cancel queued training of your bloodline jutsu before changing bloodline",
      );
    }
  }
  // Update user first, with a CAS on both reputation (atomic decrement, floor guard) and the
  // caller's pre-state bloodlineId (prevents a raced/duplicate grant from re-spending reputation
  // or clobbering a bloodline someone else already changed).
  const updateResult = await updateUserDataForUpdateBloodline(
    client,
    bloodline,
    repCost,
    user,
  );
  if (!updateResult.rowsAffected) {
    throw new BloodlineGrantRejectedError("Unable to update bloodline");
  }
  // Only once the grant is confirmed, run the side-effect writes
  await Promise.all([
    // Update bloodline jutsus currently being trained
    ...(bloodlineJutsus.length > 0
      ? [updateUserJutsuForUpdateBloodline(client, user, bloodlineJutsus)]
      : []),
    // Create a log entry for this action
    insertActionLogForUpdateBloodline(client, user, logMsg),
  ]);
};

/**
 * Build database filters for bloodline queries based on filtering schema
 */
export const bloodlineDatabaseFilter = (input?: BloodlineFilteringSchema) => {
  return [
    // Name filter
    ...(input?.name ? [like(bloodline.name, `%${input.name}%`)] : []),

    // Classification filter
    ...(input?.classification
      ? [eq(bloodline.statClassification, input.classification)]
      : []),

    // Village filter
    ...(input?.village ? [eq(bloodline.villageId, input.village)] : []),

    // Stat filter
    ...(input?.stat && input.stat.length > 0
      ? [
          and(
            ...input.stat.map(
              (s) => sql`JSON_SEARCH(${bloodline.effects},'one',${s}) IS NOT NULL`,
            ),
          ),
        ]
      : []),

    // Effect filter
    ...(input?.effect && input.effect.length > 0
      ? [
          or(
            ...input.effect.map(
              (e) => sql`JSON_SEARCH(${bloodline.effects},'one',${e}) IS NOT NULL`,
            ),
          ),
        ]
      : []),

    // Rank filter
    ...(input?.rank ? [eq(bloodline.rank, input.rank)] : [isNotNull(bloodline.rank)]),

    // Element filter
    ...(input?.element && input.element.length > 0
      ? [
          and(
            ...input.element.map(
              (e) =>
                sql`JSON_SEARCH(${bloodline.effects},'one',${e},NULL,'$[*].elements') IS NOT NULL`,
            ),
          ),
        ]
      : []),

    // Hidden filter (default to false if not specified)
    ...(input?.hidden !== undefined
      ? [eq(bloodline.hidden, input.hidden)]
      : [eq(bloodline.hidden, false)]),
  ];
};

/** Confirm SQL refunds/debits and project passive effects without another profile hydration. */
const bloodlineCachePatch = async (
  client: DrizzleClient,
  user: NonNullable<Awaited<ReturnType<typeof fetchBloodlineCacheUser>>>,
  line: Bloodline | null,
  settings: Parameters<typeof getBloodlinePassivePatch>[2],
) => {
  const saved = await findBloodlineCacheState(client, user.userId);
  if (!saved || saved.bloodlineId !== (line?.id ?? null)) return undefined;
  return {
    ...saved,
    ...getBloodlinePassivePatch(
      { ...user, regeneration: saved.regeneration },
      line,
      settings,
    ),
    ...(saved.bloodlineReskinId === null ? { activeReskin: null } : {}),
  };
};
