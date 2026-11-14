import { randomInt } from "node:crypto";
import { and, eq, isNotNull, isNull, like, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  bloodlineCachePatch,
  getPurchaseBloodlineUserUpdate,
} from "@/deltas/bloodline";
import {
  BLOODLINE_COST,
  BLOODLINE_SWAP_COOLDOWN_HOURS,
  BLOODLINE_SWAP_FREE,
  COST_SWAP_BLOODLINE,
  LetterRanks,
  REMOVAL_COST,
  ROLL_CHANCE,
} from "@/drizzle/constants";
import {
  type Bloodline,
  type BloodlineRank,
  bloodline,
  type UserData,
  userData,
} from "@/drizzle/schema";
import {
  filterRollableBloodlines,
  getBloodlineSwapAllowance,
  getPityRolls,
} from "@/libs/bloodline";
import { bloodrightSwapRefund } from "@/libs/bloodright";
import {
  deletedReason,
  editedReason,
  outdateProposalsFor,
} from "@/libs/contentReview/outdate";
import { validateUserUpdateReason } from "@/libs/moderator";
import { callDiscordContent } from "@/libs/socials";
import { fetchActionUser } from "@/queries/actionReadiness";
import {
  deleteBloodlineForDelete,
  deleteBloodlineReskinForDeleteReskin,
  fetchBloodline,
  fetchBloodlineProgressionUser,
  fetchBloodlineReskin,
  fetchBloodlines,
  fetchItemBloodlineRolls,
  fetchMonthlyBloodlineSwaps,
  fetchNaturalBloodlineRoll,
  fetchUserHistoricBloodlines,
  findActionLogForSwapBloodline,
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
import {
  fetchAchievementCatalogue,
  fetchAllGameSettings,
  fetchUser,
} from "@/queries/profile";
import { fetchQuestBootstrap, fetchUpdatedUser } from "@/routers/profile";
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
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import {
  claimUserSnapshot,
  removeBloodlineFromPoolAtomically,
  reservePityCredit,
} from "@/server/utils/concurrency";
import { setEmptyStringsToNulls } from "@/server/utils/emptyStrings";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { offsetPage } from "@/server/utils/pagination";
import { invalidateBloodlineCollectionCatalogue } from "@/server/utils/questCollections";
import { fetchQueuedJutsuIds } from "@/server/utils/userQueue";
import { getRandomElement } from "@/utils/array";
import { calculateContentDiff } from "@/utils/diff";
import { freeAllowanceNote } from "@/utils/paypal";
import { canChangeContent, canRemoveBloodlineFromPool } from "@/utils/permissions";
import { getTimeLeftStr, secondsFromDate, secondsPassed } from "@/utils/time";
import {
  type BloodlineFilteringSchema,
  bloodlineFilteringSchema,
  bloodlineReskinUpdateSchema,
  reskinBaseSchema,
} from "@/validators/bloodline";

import { BloodlineValidator, type ZodAllTags } from "@/validators/combat";

import { idSchema } from "@/validators/misc";
import { userDeltaResponseSchema } from "@/validators/userCache";

/** Schema for creating a bloodline reskin (staff only). */
const bloodlineReskinCreateSchema = reskinBaseSchema.extend({
  bloodlineId: z.string(),
});

const removeBloodlineFromPoolSchema = z.object({
  userId: z.string(),
  bloodlineId: z.string(),
  reason: z.string().trim().min(10).max(500),
});

const ALREADY_HAS_BLOODLINE_ERROR = "Already have a bloodline, please remove it first";

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
      const { skip, cursorAfter } = offsetPage(input);

      // Build where conditions using the abstracted filter function
      const baseFilters = bloodlineDatabaseFilter(input);

      const results = await listBloodlineForGetAll(
        ctx.drizzle,
        baseFilters,
        skip,
        input,
      );
      const nextCursor = cursorAfter(results);
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
    if (!canChangeContent(user.role)) {
      return errorResponse(`Not allowed to create bloodline`);
    }
    const id = nanoid();
    await insertBloodlineForCreate(ctx.drizzle, id);
    return { success: true, message: id };
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
      if (actor.isBanned || !canRemoveBloodlineFromPool(actor.role)) {
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
      const { isFree, freeSwapsUsed, freeSwapsRemaining } = getBloodlineSwapAllowance(
        user,
        recentSwaps.length,
      );
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
      const {
        federalStatus,
        hasFreeSwapAvailable,
        isFree: isFreeSwap,
        isStaffFree: isStaffFreeSwap,
      } = getBloodlineSwapAllowance(user, monthlySwaps.length);
      const freeNote = freeAllowanceNote(
        BLOODLINE_SWAP_FREE,
        federalStatus,
        monthlySwaps.length,
        isStaffFreeSwap,
      );

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
          const timeLeft = getTimeLeftStr(msLeft);
          return errorResponse(`You can swap again in ${timeLeft}`);
        }
      }

      // Update bloodline (this creates the "Bloodline Changed" log entry)
      const swapCost = isFreeSwap ? 0 : COST_SWAP_BLOODLINE;
      const swapMessage = `Bloodline Swapped from ${user.bloodline?.name} to ${line.name}`;
      const swap = await updateBloodline(
        ctx.drizzle,
        user,
        line,
        swapCost,
        swapMessage,
      );
      if (!swap.granted) return errorResponse(swap.message);

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

      // The live Bloodright refund and hydrated passive sources require profile reconciliation.
      return {
        success: true,
        message: `Bloodline swapped${isFreeSwap ? ` (${freeNote})` : ""}`,
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
      // Mutate. The transaction holds the reskin group's row lock, which jutsu family
      // saves and createLinkedReskin also take, so no jutsu can link to the group
      // between the child check and the delete.
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
      const { skip, cursorAfter } = offsetPage(input);
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
      const nextCursor = cursorAfter(rows);
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
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to delete bloodline");
      }
      if (usersWithBloodline.length > 0) {
        return errorResponse(`Bloodline used by users: ${usernames}, cannot delete`);
      }
      // Mutate
      const bloodrightRefund = bloodrightSwapRefund(null);
      await Promise.all([
        deleteBloodlineForDelete(ctx.drizzle, input).then(
          invalidateBloodlineCollectionCatalogue,
        ),
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
      if (!canChangeContent(user.role)) {
        return errorResponse(`Not allowed to edit bloodline`);
      }
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
      invalidateBloodlineCollectionCatalogue();
      await Promise.all([
        insertActionLogForUpdate(ctx.drizzle, ctx, diff, entry),
        outdateProposalsFor(
          ctx.drizzle,
          "BLOODLINE",
          [entry.id],
          editedReason("BLOODLINE", entry.name, user.username),
        ),
      ]);
      await callDiscordContent(user.username, entry.name, diff, entry.image);
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
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
      // Rolls with a bloodline are counted by rank, rolls without one separately
      const [stats, noBloodlineCount] = await Promise.all([
        selectBloodlineRollsForGetNaturalRollStatistics(ctx.drizzle),
        selectBloodlineRollsForGetNaturalRollStatistics2(ctx.drizzle),
      ]);

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
      const [
        initialUser,
        prevRoll,
        allBloodlines,
        registrationRoll,
        settings,
        progression,
      ] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchNaturalBloodlineRoll(ctx.drizzle, ctx.userId),
        fetchBloodlines(ctx.drizzle), // Fetch all bloodlines
        findBloodlineRollsForRoll(ctx.drizzle, ctx),
        fetchAllGameSettings(ctx.drizzle),
        fetchBloodlineProgression(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      if (prevRoll) return errorResponse("You have already rolled a bloodline");
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
        readiness,
        where: [
          ne(userData.rank, "STUDENT"),
          starterBloodlineId
            ? eq(userData.bloodlineId, starterBloodlineId)
            : isNull(userData.bloodlineId),
        ],
      });
      if (!claimResult.success) {
        return errorResponse("You have already rolled a bloodline");
      }

      const rand = randomInt(0, 1_000_000) / 1_000_000;
      const bloodlineRank = (["S", "A", "B", "C"] as const).find(
        (rank) => rand < ROLL_CHANCE[rank],
      );
      const randomBloodline = getRandomElement(
        filterRollableBloodlines({
          bloodlines: allBloodlines,
          rank: bloodlineRank,
          user,
          previousRolls: [], // No previous rolls to consider for this standard roll
        }),
      );
      const alreadyRolled = () =>
        actionReadinessResponse(
          errorResponse("You have already rolled a bloodline"),
          readiness,
          ctx.drizzle,
        );
      if (randomBloodline) {
        const bloodlineUpdateResult = await updateUserDataForDoRoll(
          ctx.drizzle,
          randomBloodline,
          ctx,
          starterBloodlineId,
        );
        if (bloodlineUpdateResult.rowsAffected === 0) return alreadyRolled();
      }
      try {
        await insertBloodlineRollsForDoRoll(ctx.drizzle, ctx, randomBloodline?.id);
      } catch (error) {
        if (isMysqlDuplicateKeyError(error)) return alreadyRolled();
        throw error;
      }
      if (!randomBloodline) {
        return actionReadinessResponse(
          {
            success: false,
            message:
              "After thorough examination, the doctors conclude you have no bloodline",
          },
          readiness,
          ctx.drizzle,
        );
      }
      const userPatch = bloodlineCachePatch(
        user,
        randomBloodline,
        settings,
        progression,
      );
      return actionReadinessResponse(
        {
          success: true,
          userPatch,
          message: `After thorough examination, a bloodline was detected: ${randomBloodline.name}`,
        },
        readiness,
        ctx.drizzle,
      );
    }),
  // Pity Roll a bloodline
  pityRoll: protectedProcedure
    .meta({ mcp: { description: "Use pity roll for a bloodline" } })
    .input(z.object({ rank: z.enum(LetterRanks).optional().nullish() }))
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, bloodlines, previousRolls, settings, progression] =
        await Promise.all([
          fetchBloodlineProgressionUser(ctx.drizzle, ctx.userId),
          fetchBloodlines(ctx.drizzle),
          fetchItemBloodlineRolls(ctx.drizzle, ctx.userId),
          fetchAllGameSettings(ctx.drizzle),
          fetchBloodlineProgression(ctx.drizzle, ctx.userId),
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
        rollId: prevRoll.id,
        expectedPityRolls: prevRoll.pityRolls,
      });
      if (!reserved) {
        return errorResponse("No pity rolls available");
      }
      const granted = await updateBloodline(
        ctx.drizzle,
        user,
        randomBloodline,
        0,
        `Pity roll for ${input.rank}: ${randomBloodline.name}`,
      );
      // Refund only a rejection that granted nothing. A thrown error may follow a grant, so the
      // credit stays spent rather than risk a grant plus a refund.
      if (!granted.granted) {
        // A dropped refund leaves one pity roll missing instead of masking the rejection.
        try {
          await refundPityCredit({
            client: ctx.drizzle,
            rollId: prevRoll.id,
          });
        } catch (refundError) {
          console.error("Pity credit refund failed", refundError);
        }
        return errorResponse(granted.message);
      }
      await insertBloodlineRollsForPityRoll(ctx.drizzle, ctx, randomBloodline, input);
      const userPatch = bloodlineCachePatch(
        user,
        randomBloodline,
        settings,
        progression,
        granted.updatedAt,
      );
      return {
        success: true,
        userPatch,
        message: `You have been granted a bloodline: ${randomBloodline.name}`,
      };
    }),
  // Remove a bloodline from session user
  removeBloodline: protectedProcedure
    .meta({ mcp: { description: "Remove current bloodline" } })
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      // Query
      const [user, roll] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchNaturalBloodlineRoll(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (user.status === "BATTLE")
        return errorResponse("You cannot change bloodline during battle");
      if (!user.bloodlineId) return errorResponse("You do not have a bloodline");
      const removalCost = user.bloodlineId === roll?.bloodlineId ? 0 : REMOVAL_COST;
      if (user.reputationPoints < removalCost)
        return errorResponse("You do not have enough reputation points");
      const removal = await updateBloodline(
        ctx.drizzle,
        user,
        null,
        removalCost,
        "Bloodline Removed",
      );
      if (!removal.granted) return errorResponse(removal.message);
      return {
        success: true,
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
      const [user, line, settings, progression] = await Promise.all([
        fetchBloodlineProgressionUser(ctx.drizzle, ctx.userId),
        fetchBloodline(ctx.drizzle, input.bloodlineId),
        fetchAllGameSettings(ctx.drizzle),
        fetchBloodlineProgression(ctx.drizzle, ctx.userId),
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
      const granted = await updateBloodline(
        ctx.drizzle,
        user,
        line,
        BLOODLINE_COST[line.rank],
        `Bloodline Purchased: ${line.name}`,
      );
      if (!granted.granted) return errorResponse(granted.message);
      await insertBloodlineRollsForPurchaseBloodline(ctx.drizzle, ctx, line);
      const patch = bloodlineCachePatch(
        user,
        line,
        settings,
        progression,
        granted.updatedAt,
      );
      return {
        success: true,
        message: "Bloodline purchased",
        ...getPurchaseBloodlineUserUpdate({ patch, lineRank: line.rank }),
      };
    }),
});

/**
 * Update bloodline of user, ensuring the current bloodline jutsus are unequipped. A rejection
 * before the change returns `granted: false` with a user-facing message and writes nothing;
 * failures after the guarded write throw.
 */
export const updateBloodline = async (
  client: DrizzleClient,
  user: UserData,
  bloodline: Bloodline | null,
  repCost: number,
  logMsg: string,
): Promise<
  { granted: true; updatedAt: Date } | { granted: false; message: string }
> => {
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
      return {
        granted: false,
        message:
          "Cancel queued training of your bloodline jutsu before changing bloodline",
      };
    }
  }
  // Update user first, with a CAS on both reputation (atomic decrement, floor guard) and the
  // caller's pre-state bloodlineId (prevents a raced/duplicate grant from re-spending reputation
  // or clobbering a bloodline someone else already changed).
  const updatedAt = new Date();
  const updateResult = await updateUserDataForUpdateBloodline(
    client,
    bloodline,
    repCost,
    user,
    updatedAt,
  );
  if (!updateResult.rowsAffected) {
    return {
      granted: false,
      message: "Bloodline or battle status changed. Refresh and try again",
    };
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
  return { granted: true, updatedAt };
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

/** Independent quest eligibility reads share the lineage mutation's opening query wave. */
const fetchBloodlineProgression = async (client: DrizzleClient, userId: string) => {
  const [achievements, questBootstrap] = await Promise.all([
    fetchAchievementCatalogue(client),
    fetchQuestBootstrap(client, userId),
  ]);
  return { achievements, questBootstrap };
};
