import { createHash } from "node:crypto";
import { and, eq, gte, inArray, like, ne, or, type SQL, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  COST_RESKIN_JUTSU,
  JUTSU_LEVEL_CAP,
  JUTSU_TRANSFER_COST,
  JUTSU_TRANSFER_MAX_LEVEL,
  JUTSU_TRANSFER_MINIMUM_LEVEL,
  RESKIN_LIMIT,
  TUTORIAL_JUTSU_ID,
} from "@/drizzle/constants";
import {
  type Jutsu,
  type JutsuLoadout,
  jutsu,
  jutsuLoadout,
  type UserData,
  type UserJutsuWithRelations,
  userData,
  userJutsu,
} from "@/drizzle/schema";

import {
  deletedReason,
  editedReason,
  outdateProposalsFor,
} from "@/libs/contentReview/outdate";
import { filterVisibleEvolutions, validateEvolutionGraph } from "@/libs/evolution";
import {
  type ComputedJutsuLoadout,
  canEquipUnderCaps,
  computeJutsuLoadoutAssignments,
  computeJutsuLoadoutPreview,
  countEquippedByCap,
  findExceededJutsuEquipCap,
  getFreeTransfers,
  getJutsuCapFlags,
  getReskinnedUserJutsu,
  hasAnyJutsuEquipCap,
  type JutsuCapFlags,
} from "@/libs/jutsu";

import {
  getJutsuReskinMechanics,
  inheritJutsuReskinEffects,
} from "@/libs/jutsu/reskins";
import { jutsuMasteryTypes } from "@/libs/jutsuMastery";
import { getJutsuMaxLevel } from "@/libs/jutsuProgression";
import {
  buildMissingLoadouts,
  decideRename,
  resolveSelectableLoadout,
} from "@/libs/loadout";
import { effectiveMasteries } from "@/libs/mastery";
import { validateUserUpdateReason } from "@/libs/moderator";
import {
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  getPublicQuestUser,
} from "@/libs/quest";
import { hasEnergyQueue, liveQueueRows } from "@/libs/queue";
import { hasRequiredSkill } from "@/libs/skillRequirements";
import { callDiscordContent } from "@/libs/socials";
import {
  calcJutsuEquipLimit,
  calcJutsuTrainCost,
  calcJutsuTrainTime,
  canEvolveJutsu,
  canTrainJutsu,
  canUseJutsu,
  checkJutsuBloodlineItem,
  findJutsuInTraining,
  hasRequiredLevel,
  hasRequiredRank,
  isJutsuInTraining,
  isJutsuTrainToLearnRestricted,
} from "@/libs/train";
import {
  deleteJutsuForDelete,
  deleteUserJutsuForDelete,
  deleteUserJutsuForForget,
  executeRowsForSelectJutsuLoadout,
  executeTransferredForTransferLevel,
  executeWriteForImportJutsuLoadout,
  fetchActiveLoadoutJutsuIds,
  fetchBloodlineJutsuReskins,
  fetchJutsu,
  fetchJutsuLoadouts,
  fetchReskin,
  fetchUserReskins,
  findBloodlineReskinById,
  findItemForUpdate,
  findJutsuForUpdate,
  findJutsuForUpdateReskin,
  findJutsuLoadoutForRenameLoadout,
  findJutsuReskinForAdjustUserJutsu,
  findJutsuReskinForEvolveJutsu,
  findJutsuReskinForUpdateReskin,
  findPetSpeciesForUpdate,
  findUserJutsuForRemoveReskin,
  findUserJutsuForUpdateReskin,
  insertActionLogForAdjustUserJutsu,
  insertActionLogForClone,
  insertActionLogForCreateLinkedReskin,
  insertActionLogForDelete,
  insertActionLogForEvolveJutsu,
  insertActionLogForSaveJutsuFamily,
  insertActionLogForTransferLevel,
  insertActionLogForUpdateReskin,
  insertActionLogForUpdateReskin2,
  insertJutsuForClone,
  insertJutsuForCreate,
  insertJutsuForCreateLinkedReskin,
  insertJutsuLoadoutForInsertMissing,
  insertJutsuReskinForCreateReskin,
  insertUserJutsuForStartTraining,
  listActionLogForGetRecentTransfers,
  listBloodlineForGetJutsuRelations,
  listItemForGetJutsuRelations,
  listJutsuForGetAll,
  listJutsuForGetAllNames,
  listJutsuForGetEvolutions,
  listJutsuForGetJutsuRelations,
  listJutsuForGetJutsuRelations2,
  listJutsuForGetJutsuRelations3,
  listJutsuForGetLinkedReskins,
  listJutsuForGetReskinParents,
  listJutsuForPrepareJutsuLoadoutImport,
  listJutsuForUpdate,
  listJutsuForUpdate2,
  listJutsuReskinForGetReskinsForJutsu,
  listPetSpeciesForUpdate,
  listQuestForGetJutsuRelations,
  listSkillTreeForGetJutsuRelations,
  listUserJutsuForGetReskin,
  listUserJutsuForUpdateReskin,
  selectBloodlineReskinForUpdate,
  selectJutsuForCreateLinkedReskin,
  selectJutsuForDelete,
  selectJutsuForDelete2,
  selectJutsuForSaveJutsuFamily,
  selectJutsuForSaveJutsuFamily2,
  selectJutsuLoadoutForImportJutsuLoadout,
  selectJutsuReskinForGetAllReskins,
  selectJutsuReskinForGetJutsuRelations,
  selectUserDataForFetchUserJutsus,
  selectUserDataForUpdateReskin,
  selectUserJutsuEquipped,
  selectUserJutsuForFetchOwned,
  selectUserJutsuForFetchUserJutsus,
  selectUserJutsuForGetJutsuRelations,
  selectUserJutsuForStartTraining,
  setUserJutsuReskin,
  updateJutsuForSaveJutsuFamily,
  updateJutsuForSaveJutsuFamily2,
  updateJutsuLoadoutForAppendJutsuIdToLoadoutAtomically,
  updateJutsuLoadoutForRemoveJutsuIdFromLoadoutAtomically,
  updateJutsuLoadoutForRenameLoadout,
  updateJutsuLoadoutForSetLoadoutHotkeys,
  updateJutsuLoadoutForUnequipAll,
  updateJutsuLoadoutIds,
  updateJutsuReskinForCreateReskin,
  updateJutsuReskinForEvolveJutsu,
  updateJutsuReskinForUpdateReskin,
  updateUserDataForCreateReskin,
  updateUserDataForWriteDefaultPointer,
  updateUserJutsuForAdjustUserJutsu,
  updateUserJutsuForEvolveJutsu,
  updateUserJutsuForRemoveReskin,
  updateUserJutsuForRollbackEquipIfOverCap,
  updateUserJutsuForStartTraining,
  updateUserJutsuForStopTraining,
  updateUserJutsuForToggleEquip,
  updateUserJutsuForTryEquipUserJutsuAtomically,
  updateUserJutsuForUnequipAll,
  updateUserJutsuForUpdate,
  updateUserJutsuForUpdateReskin,
  updateUserJutsuForUpdateReskin2,
} from "@/queries/jutsu";
import {
  debitUserMoney,
  fetchLoadoutUser,
  fetchUser,
  findUserDataForGetUsername,
  findUserRoleById,
  incrementUserMoney,
} from "@/queries/profile";
import { updateUserQuestData } from "@/queries/quests";
import { fetchStudents } from "@/queries/sensei";
import { findRequiredSkillTreeEntry } from "@/queries/skillTree";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { getNextUserSnapshotAt } from "@/server/utils/concurrency";
import { applyLoadoutRename, backfillLoadouts } from "@/server/utils/loadout";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import {
  cancelQueuedJutsuTraining,
  enqueueJutsuLevels,
  fetchJutsuTrainingQueue,
  fetchQueuedJutsuIds,
  hasDueTimedJob,
  hasQueueRoom,
  MAX_JUTSU_LEVELS_PER_REQUEST,
  planJutsuLevels,
  settleJutsuTrainingQueue,
} from "@/server/utils/userQueue";
import { calculateContentDiff } from "@/utils/diff";
import { fedJutsuLoadouts, getQueueTotalCapacity } from "@/utils/paypal";
import {
  canChangeContent,
  canEditJutsus,
  canModerateReskin,
  canOnlyEditSelf,
  canReskinFreely,
  canTransferJutsu,
} from "@/utils/permissions";
import {
  JutsuValidator,
  type ZodAllTags,
  type ZodJutsuType,
} from "@/validators/combat";
import {
  createLinkedJutsuSchema,
  evolveJutsuSchema,
  getEvolutionsSchema,
  getJutsuReskinSchema,
  type JutsuFilteringSchema,
  jutsuFilteringSchema,
  jutsuReskinCreateSchema,
  type UserJutsuFilteringSchema,
  updateJutsuReskinSchema,
  updateJutsuSchema,
  userJutsuFilteringSchema,
} from "@/validators/jutsu";
import {
  importJutsuLoadoutSchema,
  previewJutsuLoadoutSchema,
  renameLoadoutSchema,
  setLoadoutHotkeysSchema,
  sharedJutsuLoadoutTextSchema,
} from "@/validators/loadout";
import { idSchema } from "@/validators/misc";
import { QuestTracker } from "@/validators/objectives";
import {
  cancelQueuedJobInputSchema,
  jutsuTrainingQueueOutputSchema,
} from "@/validators/train";
import { userDeltaResponseSchema } from "@/validators/userCache";
import { fetchUpdatedUser } from "./profile";

/** "level 3" or "levels 3-5" */
const formatLevelRange = (from: number, to: number) =>
  from === to ? `level ${from}` : `levels ${from}-${to}`;

export const jutsuRouter = createTRPCRouter({
  getRecentTransfers: protectedProcedure
    .meta({
      mcp: { description: "Get user's recent jutsu level transfers" },
    })
    .query(async ({ ctx }) => {
      return await listActionLogForGetRecentTransfers(ctx.drizzle, ctx);
    }),
  transferLevel: protectedProcedure
    .meta({ mcp: { description: "Transfer levels between jutsus" } })
    .input(
      z.object({
        fromJutsuId: z.string(),
        toJutsuId: z.string(),
        transferLevels: z.number().int().min(1, "Must transfer at least 1 level"),
      }),
    )
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // Query
      const transfer = input.transferLevels;
      const [user, userJutsus, queuedJutsuIds, recentTransfers] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserJutsus(ctx.drizzle, ctx.userId),
        fetchQueuedJutsuIds(ctx.drizzle, ctx.userId),
        listActionLogForGetRecentTransfers(ctx.drizzle, ctx),
      ]);
      const fromUserJutsu = userJutsus.find((j) => j.jutsuId === input.fromJutsuId);
      const fromJutsu = fromUserJutsu?.jutsu;
      const toUserJutsu = userJutsus.find((j) => j.jutsuId === input.toJutsuId);
      const toJutsu = toUserJutsu?.jutsu;
      const prevFreeTransfers = recentTransfers.filter((t) =>
        (t.changes as string[]).some((c) => c.includes("Used free transfer.")),
      );
      // Guard
      if (queuedJutsuIds.has(input.fromJutsuId) || queuedJutsuIds.has(input.toJutsuId))
        return errorResponse(
          "Cancel queued training of these jutsu before transferring",
        );
      if (!fromJutsu) return errorResponse("Source jutsu not found");
      if (!toJutsu) return errorResponse("Target jutsu not found");
      if (fromJutsu.parentJutsuId)
        return errorResponse("Cannot transfer levels from an evolution jutsu");
      if (toJutsu.parentJutsuId)
        return errorResponse("Cannot transfer levels to an evolution jutsu");
      if (fromJutsu.jutsuType !== toJutsu.jutsuType) {
        return errorResponse("Jutsus must be of the same type");
      }
      if (fromJutsu.jutsuRank !== toJutsu.jutsuRank) {
        return errorResponse("Jutsus must be of the same rank");
      }
      if (fromUserJutsu.level < JUTSU_TRANSFER_MINIMUM_LEVEL) {
        return errorResponse(
          `Source jutsu must be at least ${JUTSU_TRANSFER_MINIMUM_LEVEL} to transfer levels`,
        );
      }
      if (fromUserJutsu.id === toUserJutsu.id)
        return errorResponse("Choose two different jutsu");
      if (
        isJutsuInTraining(fromUserJutsu, Date.now()) ||
        isJutsuInTraining(toUserJutsu, Date.now())
      )
        return errorResponse(
          "Wait for training to complete before transferring levels",
        );

      // Guard: Check that source has enough levels and target won't exceed maximum
      if (fromUserJutsu.level - transfer < 1) {
        return errorResponse("Source jutsu does not have enough levels to transfer");
      }
      if (toUserJutsu.level + transfer > JUTSU_TRANSFER_MAX_LEVEL) {
        return errorResponse("Target jutsu cannot exceed the maximum allowed level");
      }

      // Check if user has free transfers
      const transferCost = canTransferJutsu(user) ? 0 : JUTSU_TRANSFER_COST;
      const availFreeTransfers = getFreeTransfers(user.federalStatus);
      const usedTransfers = prevFreeTransfers.length;
      const needsReputation = usedTransfers >= availFreeTransfers;

      const cost = needsReputation ? transferCost : 0;
      if (user.reputationPoints < cost)
        return errorResponse("Not enough reputation points");
      // Drizzle's update builder cannot change both ownership rows and the fee together.
      // This joined statement commits all three atomically; level and owner snapshot
      // guards reject stale transfers after concurrent progression or account changes.
      const transferred = await retryOnDeadlock(() =>
        executeTransferredForTransferLevel(
          ctx.drizzle,
          toUserJutsu,
          transfer,
          cost,
          user,
          fromUserJutsu,
          ctx,
        ),
      );
      if (transferred.rowsAffected === 0)
        return errorResponse("Your jutsu or balance changed. Please try again.");
      await insertActionLogForTransferLevel(
        ctx.drizzle,
        ctx,
        transfer,
        fromJutsu,
        fromUserJutsu,
        toJutsu,
        toUserJutsu,
        needsReputation,
        user,
      );

      return {
        success: true,
        userDelta: hasEnergyQueue(user)
          ? undefined
          : { reputationPoints: needsReputation ? -transferCost : 0 },
        message: needsReputation
          ? `Level transferred for ${transferCost} reputation points`
          : "Level transferred for free",
      };
    }),

  getAllNames: publicProcedure
    .meta({ mcp: { description: "Get all jutsu names and images" } })
    .query(async ({ ctx }) => {
      return await listJutsuForGetAllNames(ctx.drizzle);
    }),

  get: publicProcedure
    .meta({
      mcp: {
        description: "Get a specific jutsu by ID, or null if no such jutsu exists",
      },
    })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const result = await fetchJutsu(ctx.drizzle, input.id);
      // React Query rejects undefined query data, so a missing jutsu resolves to null
      // and each page shows its own not-found state.
      if (!result) return null;
      return result as Omit<typeof result, "effects"> & { effects: ZodAllTags[] };
    }),

  getAll: publicProcedure
    .meta({ mcp: { description: "Get paginated jutsus with filters" } })
    .input(
      jutsuFilteringSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(1000),
        hideAi: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ?? 0;
      const skip = currentCursor * input.limit;

      // Build the base DB filter
      const baseFilters = jutsuDatabaseFilter(input);

      const results = await listJutsuForGetAll(ctx.drizzle, baseFilters, input, skip);

      // Post-filter to ensure constraints are satisfied within the same effect
      const filtered = filterByEffectConstraints(results, input);

      // Next cursor if more rows
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;

      return {
        data: filtered,
        nextCursor: nextCursor,
      };
    }),

  getLoadouts: protectedProcedure
    .meta({ mcp: { description: "Get user's jutsu loadouts" } })
    .query(async ({ ctx }) => {
      const [loadouts, user] = await Promise.all([
        fetchJutsuLoadouts(ctx.drizzle, ctx.userId),
        fetchLoadoutUser(ctx.drizzle, ctx.userId),
      ]);
      // Backfill any loadouts the user is entitled to but does not yet own. A
      // deterministic id + no-op upsert keeps concurrent reads from inserting
      // duplicates, and one batched insert avoids a round-trip per slot.
      const maxLoadouts = fedJutsuLoadouts(user);
      const missing = buildMissingLoadouts(
        ctx.userId,
        "jutsu",
        loadouts.length,
        maxLoadouts,
        { jutsuIds: [] as JutsuLoadout["jutsuIds"], hotkeys: {} },
        new Date(),
      );
      return backfillLoadouts<JutsuLoadout>({
        loadouts,
        missing,
        maxLoadouts,
        currentPointer: user?.jutsuLoadout ?? null,
        insertMissing: (rows) => insertJutsuLoadoutForInsertMissing(ctx.drizzle, rows),
        writeDefaultPointer: (id) =>
          // Compare-and-swap: only set the default when no pointer exists yet, so
          // a concurrent select that set it first is not overwritten.
          updateUserDataForWriteDefaultPointer(ctx.drizzle, id, ctx),
      });
    }),

  selectJutsuLoadout: protectedProcedure
    .meta({ mcp: { description: "Select a jutsu loadout" } })
    .input(idSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      // fetchUpdatedUser (not fetchUser) so the full relations canUseJutsu reads
      // (bloodline/village/elements) are present for validation, mirroring
      // toggleEquip. Note this makes the mutation no longer read-only on the user
      // row: fetchUpdatedUser may persist the usual throttled regen/quest
      // maintenance (never money/XP/loadout state).
      const [loadouts, data, userjutsus] = await Promise.all([
        fetchJutsuLoadouts(ctx.drizzle, ctx.userId),
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchUserJutsus(ctx.drizzle, ctx.userId),
      ]);
      const { user } = data;
      if (!user) return errorResponse("User not found");
      // Pass the validator here (full user relations are loaded) so a stale
      // loadout cannot re-equip hidden/ineligible jutsu or exceed equip caps.
      const id = input.id;
      const masteries = effectiveMasteries(user);
      const result = await selectJutsuLoadout(
        ctx.drizzle,
        id,
        loadouts,
        userjutsus,
        user,
        (jutsuIds) =>
          computeJutsuLoadoutAssignments({ jutsuIds, userjutsus, user, masteries }),
      );
      const loadout = loadouts.find((loadout) => loadout.id === id);
      return result.success && loadout && !data.requiresUserRefresh
        ? {
            ...result,
            userPatch: { jutsuLoadout: id, loadout: { jutsuIds: loadout.jutsuIds } },
          }
        : result;
    }),

  /** Return eligibility and a confirmation fingerprint without editing slots or equipment. */
  previewJutsuLoadout: protectedProcedure
    .input(previewJutsuLoadoutSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await prepareJutsuLoadoutImport(ctx.drizzle, ctx.userId, input);
      if (!result.success) return result;
      return {
        success: true as const,
        message: "Loadout preview ready",
        preview: result.preview,
      };
    }),

  /** Revalidate the preview, preserve the destination name and equip active imports atomically. */
  importJutsuLoadout: protectedProcedure
    .input(importJutsuLoadoutSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const result = await prepareJutsuLoadoutImport(ctx.drizzle, ctx.userId, input);
      if (!result.success) return result;
      if (input.previewToken !== result.preview.token) {
        return errorResponse(
          "Loadout or eligibility changed. Preview again before replacing.",
        );
      }
      const { loadout, user, userjutsus, preview } = result;
      if (preview.jutsuIds.length === 0) {
        return errorResponse(
          "No usable jutsu to import. The loadout was left unchanged.",
        );
      }
      const isActive = user.jutsuLoadout === loadout.id;
      const guard = and(
        eq(jutsuLoadout.id, loadout.id),
        eq(jutsuLoadout.userId, ctx.userId),
        eq(userData.userId, ctx.userId),
        eq(jutsuLoadout.name, loadout.name),
        sql`${jutsuLoadout.jutsuIds} = CAST(${JSON.stringify(loadout.jutsuIds)} AS JSON)`,
        sql`${userData.jutsuLoadout} <=> ${user.jutsuLoadout}`,
        eq(userData.federalStatus, user.federalStatus),
        eq(userData.staffAccount, user.staffAccount),
      );
      const sameIds =
        JSON.stringify(loadout.jutsuIds) === JSON.stringify(preview.jutsuIds);
      if (
        sameIds &&
        (!isActive ||
          userjutsus.every(
            (entry) => entry.equipped === preview.jutsuIds.includes(entry.jutsuId),
          ))
      ) {
        // Confirm the no-op against one current snapshot, including equipment for
        // an active destination, before acknowledging the import without a write.
        const current = await selectJutsuLoadoutForImportJutsuLoadout(
          ctx.drizzle,
          guard,
        );
        const equippedIds = current.flatMap((entry) =>
          entry.jutsuId === null ? [] : [entry.jutsuId],
        );
        if (
          current.length === 0 ||
          (isActive &&
            (equippedIds.length !== preview.jutsuIds.length ||
              equippedIds.some((id) => !preview.jutsuIds.includes(id))))
        ) {
          return errorResponse("Loadout changed. Preview again before replacing.");
        }
        return { success: true, message: "Loadout already matches" };
      }

      // Drizzle's update builder targets one table; joined SQL keeps saved order
      // and equipped flags together in one statement, without a transaction.
      // Snapshot guards also stop a concurrent selection, rename, allowance change,
      // or edit from being overwritten between revalidation and this write.
      const changed = await retryOnDeadlock(() =>
        executeWriteForImportJutsuLoadout(ctx.drizzle, isActive, preview, guard),
      );
      if (changed.rowsAffected === 0) {
        return errorResponse("Loadout changed. Preview again before replacing.");
      }
      return { success: true, message: "Loadout replaced" };
    }),

  getReskinParents: protectedProcedure.query(({ ctx }) =>
    listJutsuForGetReskinParents(ctx.drizzle),
  ),

  getLinkedReskins: publicProcedure
    .input(idSchema)
    .query(({ ctx, input }) => listJutsuForGetLinkedReskins(ctx.drizzle, input)),

  createLinkedReskin: protectedProcedure
    .input(createLinkedJutsuSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, reskin] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findBloodlineReskinById(ctx.drizzle, input.bloodlineReskinId),
      ]);
      if (user.isBanned || !canChangeContent(user.role))
        return errorResponse("Not allowed");
      if (!reskin) return errorResponse("Bloodline reskin not found");
      // Match family saves' jutsu-before-group lock order, so creation cannot copy
      // stale mechanics or race parent conversion/deletion or group deletion.
      return retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          const [parent] = await selectJutsuForCreateLinkedReskin(tx, input);
          if (!parent || parent.reskinParentJutsuId || parent.jutsuRank === "H") {
            return errorResponse("Select a non-reskin parent jutsu");
          }
          if (parent.bloodlineId !== reskin.bloodlineId)
            return errorResponse("Parent jutsu must belong to this bloodline");
          const [currentGroup] = await selectBloodlineReskinForUpdate(tx, reskin.id);
          if (!currentGroup || currentGroup.bloodlineId !== parent.bloodlineId)
            return errorResponse("Bloodline reskin changed; refresh before creating");
          const id = nanoid();
          const name = `${reskin.name.slice(0, 70)}: ${parent.name.slice(0, 70)} - ${id}`;
          await insertJutsuForCreateLinkedReskin(tx, parent, id, name, reskin);
          await insertActionLogForCreateLinkedReskin(tx, ctx, id, parent, reskin, name);
          return { success: true, message: id };
        }),
      );
    }),

  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (user.isBanned)
      return errorResponse("You are banned and cannot perform this action");
    if (canChangeContent(user.role)) {
      const id = nanoid();
      await insertJutsuForCreate(ctx.drizzle, id);
      return { success: true, message: id };
    } else {
      return { success: false, message: `Not allowed to create jutsu` };
    }
  }),

  clone: protectedProcedure
    .meta({ mcp: { description: "Clone an existing jutsu (content editors)" } })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, source] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchJutsu(ctx.drizzle, input.id),
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canChangeContent(user.role))
        return errorResponse("Not allowed to clone jutsu");
      if (!source) return errorResponse("Jutsu not found");

      const id = nanoid();
      const suffix = ` - copy ${id}`;
      const name = `${source.name.slice(0, 191 - suffix.length)}${suffix}`;
      // The copy and its provenance must commit together; an audit failure must not
      // leave an unlogged copy and invite a duplicate on retry.
      await ctx.drizzle.transaction(async (tx) => {
        await insertJutsuForClone(tx, source, id, name);
        await insertActionLogForClone(tx, ctx, id, source, name);
      });
      return { success: true, message: id };
    }),

  delete: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query in parallel for performance
      const [user, entry, relations] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchJutsu(ctx.drizzle, input.id),
        getJutsuRelations(ctx.drizzle, input.id),
      ]);
      // Derived
      const totalRelations =
        relations.jutsuInjectors.length +
        relations.bloodlineInjectors.length +
        relations.skillInjectors.length +
        relations.itemInjectors.length +
        relations.aiUsingJutsu.length +
        relations.questsUsingJutsu.length +
        relations.childEvolutions.length +
        relations.linkedReskins.length +
        relations.playerReskins.length;
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Jutsu not found");
      if (entry.id === TUTORIAL_JUTSU_ID)
        return errorResponse("Cannot delete tutorial jutsu");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      if (totalRelations > 0) {
        const message = [
          ...relations.jutsuInjectors.map((j) => `Jutsu: ${j.name}`),
          ...relations.bloodlineInjectors.map((b) => `Bloodline: ${b.name}`),
          ...relations.skillInjectors.map((s) => `Skill: ${s.name}`),
          ...relations.itemInjectors.map((i) => `Item: ${i.name}`),
          ...relations.aiUsingJutsu.map((a) => `AI: ${a.name}`),
          ...relations.questsUsingJutsu.map((q) => `Quest: ${q.name}`),
          ...relations.childEvolutions.map((e) => `Evolution: ${e.name}`),
          ...relations.linkedReskins.map((e) => `Reskin: ${e.name}`),
          ...relations.playerReskins.map((r) => `Player reskin: ${r.name}`),
        ].join(", ");
        return errorResponse(
          `Justu is being used by: ${message}. So you cannot delete it.`,
        );
      }
      // Mutate
      const deleted = await retryOnDeadlock(() =>
        ctx.drizzle.transaction(async (tx) => {
          await selectJutsuForDelete(tx, input);
          const children = await selectJutsuForDelete2(tx, input);
          if (children.length) return false;
          await deleteJutsuForDelete(tx, input);
          return true;
        }),
      );
      if (!deleted)
        return errorResponse("Unlink or delete its reskins before deleting this jutsu");
      await Promise.all([
        deleteUserJutsuForDelete(ctx.drizzle, input),
        insertActionLogForDelete(ctx.drizzle, ctx, entry),
      ]);
      await outdateProposalsFor(
        ctx.drizzle,
        "JUTSU",
        [entry.id],
        deletedReason("JUTSU", entry.name, user.username),
      );
      return { success: true, message: `Jutsu deleted` };
    }),

  forget: protectedProcedure
    .meta({ mcp: { description: "Forget a learned jutsu" } })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [userjutsus, queuedJutsuIds] = await Promise.all([
        fetchUserJutsus(ctx.drizzle, ctx.userId),
        fetchQueuedJutsuIds(ctx.drizzle, ctx.userId),
      ]);
      const userjutsuObj = userjutsus.find((j) => j.id === input.id);
      if (userjutsuObj && queuedJutsuIds.has(userjutsuObj.jutsuId)) {
        return errorResponse(
          "Cancel queued training of this jutsu before forgetting it",
        );
      }
      if (userjutsuObj) {
        const res1 = await deleteUserJutsuForForget(ctx.drizzle, input);
        if (res1.rowsAffected === 1) {
          return { success: true, message: `Jutsu forgotten, 0 ryo restored` };
        }
      }
      return { success: false, message: `Could not find jutsu to delete` };
    }),

  getEvolutions: publicProcedure
    .meta({
      mcp: {
        description: "Get all evolution jutsus for a parent jutsu",
      },
    })
    .input(getEvolutionsSchema)
    .query(async ({ ctx, input }) => {
      const [user, evolutions] = await Promise.all([
        ctx.userId ? findUserRoleById(ctx.drizzle, ctx.userId) : Promise.resolve(null),
        listJutsuForGetEvolutions(ctx.drizzle, input),
      ]);
      const canViewHidden = !!user && canChangeContent(user.role);
      return filterVisibleEvolutions(evolutions, canViewHidden);
    }),

  evolveJutsu: protectedProcedure
    .meta({ mcp: { description: "Evolve a jutsu into its evolution" } })
    .input(evolveJutsuSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [
        { user },
        userJutsus,
        evolutionJutsu,
        allLoadouts,
        conflictingReskin,
        queuedJutsuIds,
      ] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchUserJutsus(ctx.drizzle, ctx.userId),
        fetchJutsu(ctx.drizzle, input.evolutionJutsuId),
        fetchJutsuLoadouts(ctx.drizzle, ctx.userId),
        findJutsuReskinForEvolveJutsu(ctx.drizzle, ctx, input),
        fetchQueuedJutsuIds(ctx.drizzle, ctx.userId),
      ]);
      // Guards
      if (!user) return errorResponse("User not found");
      if (user.status !== "AWAKE")
        return errorResponse("Must be awake to evolve a jutsu");
      if (!evolutionJutsu) return errorResponse("Evolution jutsu not found");
      if (!evolutionJutsu.parentJutsuId)
        return errorResponse("Target jutsu is not an evolution");
      if (evolutionJutsu.hidden && !canChangeContent(user.role))
        return errorResponse("This evolution is not yet available");
      const userJutsuObj = userJutsus.find((j) => j.id === input.userJutsuId);
      if (!userJutsuObj) return errorResponse("You don't own this jutsu");
      if (queuedJutsuIds.has(userJutsuObj.jutsuId))
        return errorResponse("Cancel queued training of this jutsu before evolving it");
      if (isJutsuInTraining(userJutsuObj, Date.now()))
        return errorResponse(
          "This jutsu is currently being trained. Wait for training to complete before evolving.",
        );
      const evolutionLevel = getJutsuMaxLevel(userJutsuObj.jutsu);
      if (userJutsuObj.level < evolutionLevel)
        return errorResponse(
          `Jutsu must be at max level (${evolutionLevel}) to evolve`,
        );
      if (userJutsuObj.jutsuId !== evolutionJutsu.parentJutsuId)
        return errorResponse("This jutsu cannot evolve into the target evolution");
      if (userJutsus.some((j) => j.jutsuId === input.evolutionJutsuId))
        return errorResponse("You already have this evolved jutsu");
      if (!hasRequiredRank(user.rank, evolutionJutsu.requiredRank))
        return errorResponse("You don't meet the rank requirement for this evolution");
      if (!hasRequiredLevel(user.level, evolutionJutsu.requiredLevel))
        return errorResponse("You don't meet the level requirement for this evolution");
      if (!canEvolveJutsu(evolutionJutsu, user))
        return errorResponse("You don't meet the stat requirements for this evolution");
      if (!canUseJutsu(evolutionJutsu, user, true, undefined, true))
        return errorResponse(
          "You don't meet all requirements for this evolution (village, bloodline, or element restrictions)",
        );
      if (!checkJutsuBloodlineItem(evolutionJutsu, user.items))
        return errorResponse(
          "You don't have the required bloodline item equipped for this evolution",
        );
      // Quest tracking
      const { trackers } = getNewTrackers(user, [
        { task: "jutsus_mastered", increment: 1 },
        {
          task: "train_specific_jutsu",
          increment: 1,
          contentId: input.evolutionJutsuId,
          masteryTypes: jutsuMasteryTypes(evolutionJutsu),
        },
      ]);
      const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);
      const evolutionCapFlags = getJutsuCapFlags(evolutionJutsu);
      const isRestrictedEquipType =
        hasAnyJutsuEquipCap(evolutionCapFlags) ||
        !hasRequiredSkill(evolutionJutsu, user);
      // Single compare-and-swap update that applies every userJutsu-row change at once:
      // - jutsuId/level/experience/finishTraining — the evolution itself
      // - equipped — force off for restricted types to avoid cap overflows
      // - reskinId — on reskin-collision, re-point to the existing historical row so
      //   the user's evolved jutsu activates the slot they already own
      // The CAS WHERE guards against double-evolve on retry/double-submit.
      const evolveResult = await updateUserJutsuForEvolveJutsu(
        ctx.drizzle,
        input,
        isRestrictedEquipType,
        userJutsuObj,
        conflictingReskin,
        ctx,
      );
      if (evolveResult.rowsAffected === 0)
        return errorResponse("Evolution failed - jutsu may have already been evolved");
      // Replace old jutsu ID with evolved ID across all user loadouts.
      // Restricted equip types are force-unequipped post-evolution to avoid cap overflows.
      const oldJutsuId = userJutsuObj.jutsu.id;
      const loadoutsToUpdate = allLoadouts
        .filter(
          (loadout) =>
            loadout.jutsuIds.includes(oldJutsuId) ||
            (isRestrictedEquipType &&
              loadout.jutsuIds.includes(input.evolutionJutsuId)),
        )
        .map((loadout) => ({
          id: loadout.id,
          jutsuIds: isRestrictedEquipType
            ? loadout.jutsuIds.filter(
                (id) => id !== oldJutsuId && id !== input.evolutionJutsuId,
              )
            : loadout.jutsuIds.map((id) =>
                id === oldJutsuId ? input.evolutionJutsuId : id,
              ),
        }));
      await Promise.all([
        updateUserQuestData(ctx.drizzle, questDataForDb, ctx.userId),
        ...loadoutsToUpdate.map((loadout) =>
          updateJutsuLoadoutIds(ctx.drizzle, loadout.jutsuIds, loadout.id),
        ),
        // No-collision reskin carry-forward: update the reskin row's jutsuId so
        // createReskin's by-jutsuId lookup still works after evolution. (The
        // collision case is already handled above in the merged userJutsu update,
        // where reskinId is re-pointed to the pre-existing historical row. The
        // parent reskin row is left as an orphaned historical record there,
        // consistent with removeReskin behaviour.)
        ...(userJutsuObj.reskinId && !conflictingReskin
          ? [
              updateJutsuReskinForEvolveJutsu(
                ctx.drizzle,
                input,
                { reskinId: userJutsuObj.reskinId },
                ctx,
              ),
            ]
          : []),
        insertActionLogForEvolveJutsu(
          ctx.drizzle,
          ctx,
          userJutsuObj,
          evolutionJutsu,
          input,
        ),
      ]);
      return { success: true, message: `Evolved into ${evolutionJutsu.name}!` };
    }),

  /** Validate content and species/default-loadout compatibility before saving a jutsu. */
  update: protectedProcedure
    .input(updateJutsuSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query in parallel for performance
      const [
        user,
        entry,
        relations,
        requiredSkill,
        jutsuWithName,
        parent,
        siblings,
        evolutionGraph,
        requiredItem,
        reskinParent,
        reskinGroup,
        requiredSpecies,
        defaultSpecies,
      ] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchJutsu(ctx.drizzle, input.id),
        getJutsuRelations(ctx.drizzle, input.id),
        input.data.requiredSkillId
          ? findRequiredSkillTreeEntry(ctx.drizzle, {
              data: { requiredSkillId: input.data.requiredSkillId },
            })
          : Promise.resolve(null),
        findJutsuForUpdate(ctx.drizzle, input),
        input.data.parentJutsuId
          ? fetchJutsu(ctx.drizzle, input.data.parentJutsuId)
          : Promise.resolve(null),
        input.data.parentJutsuId
          ? listJutsuForUpdate(ctx.drizzle, {
              data: { parentJutsuId: input.data.parentJutsuId },
            })
          : Promise.resolve([]),
        input.data.parentJutsuId
          ? listJutsuForUpdate2(ctx.drizzle)
          : Promise.resolve([]),
        input.data.requiredBloodlineItemId && !input.data.reskinParentJutsuId
          ? findItemForUpdate(ctx.drizzle, {
              data: { requiredBloodlineItemId: input.data.requiredBloodlineItemId },
            })
          : Promise.resolve(null),
        input.data.reskinParentJutsuId
          ? fetchJutsu(ctx.drizzle, input.data.reskinParentJutsuId)
          : Promise.resolve(null),
        input.data.bloodlineReskinId
          ? findBloodlineReskinById(ctx.drizzle, input.data.bloodlineReskinId)
          : Promise.resolve(null),
        input.data.requiredPetSpeciesId
          ? findPetSpeciesForUpdate(ctx.drizzle, {
              data: { requiredPetSpeciesId: input.data.requiredPetSpeciesId },
            })
          : Promise.resolve(null),
        input.data.requiredPetSpeciesId
          ? listPetSpeciesForUpdate(ctx.drizzle, input)
          : Promise.resolve([]),
      ]);
      if (input.data.reskinParentJutsuId) {
        if (
          !reskinParent ||
          reskinParent.id === input.id ||
          reskinParent.reskinParentJutsuId ||
          reskinParent.jutsuRank === "H"
        ) {
          return errorResponse("Select a different, non-reskin parent jutsu");
        }
        if (
          input.data.parentJutsuId ||
          relations.childEvolutions.length ||
          relations.linkedReskins.length
        ) {
          return errorResponse(
            "Reskins cannot have evolution links or reskin children",
          );
        }
        input.data = {
          ...input.data,
          ...getJutsuReskinMechanics(reskinParent),
          jutsuRank: "H",
          effects: inheritJutsuReskinEffects(reskinParent.effects, input.data.effects),
        };
      }
      if (
        input.data.bloodlineReskinId &&
        (!input.data.reskinParentJutsuId ||
          !reskinGroup ||
          reskinGroup.bloodlineId !== input.data.bloodlineId)
      ) {
        return errorResponse(
          "Bloodline reskin must match the linked parent's bloodline",
        );
      }
      if (
        input.data.requiredSkillId &&
        !input.data.reskinParentJutsuId &&
        (!requiredSkill || requiredSkill.pathType !== "SKILL")
      ) {
        return errorResponse("Select a valid SkillTree skill entry");
      }
      if (
        input.data.requiredPetSpeciesId &&
        (input.data.jutsuType !== "PETS" || !requiredSpecies)
      )
        return errorResponse("Select a valid companion species for a PETS jutsu");
      if (
        defaultSpecies.some((species) => species.id !== input.data.requiredPetSpeciesId)
      )
        return errorResponse("This jutsu is a default for another companion species");
      // Guard
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Jutsu not found");
      if (jutsuWithName && jutsuWithName.id !== entry.id)
        return errorResponse("Jutsu name already exists");
      if (entry.id === TUTORIAL_JUTSU_ID && input?.data?.hidden)
        return errorResponse("Cannot hide tutorial jutsu");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      // A required bloodline item must belong to the jutsu's own bloodline, otherwise the
      // in-combat gate could never be satisfied (or would gate on an unrelated item).
      if (input.data.requiredBloodlineItemId && !input.data.reskinParentJutsuId) {
        if (!input.data.bloodlineId)
          return errorResponse("Set a bloodline before requiring a bloodline item");
        if (!requiredItem) return errorResponse("Required bloodline item not found");
        if (requiredItem.bloodlineId !== input.data.bloodlineId)
          return errorResponse(
            "The required bloodline item must belong to the jutsu's bloodline",
          );
      }
      if (!input.data.injectableInBattle) {
        const totalRelations =
          relations.jutsuInjectors.length +
          relations.bloodlineInjectors.length +
          relations.skillInjectors.length +
          relations.itemInjectors.length;
        if (totalRelations > 0) {
          const message = [
            ...relations.jutsuInjectors.map((j) => `Jutsu: ${j.name}`),
            ...relations.bloodlineInjectors.map((b) => `Bloodline: ${b.name}`),
            ...relations.skillInjectors.map((s) => `Skill: ${s.name}`),
            ...relations.itemInjectors.map((i) => `Item: ${i.name}`),
          ].join(", ");
          return errorResponse(
            `Justu is being injected by: ${message}. So you cannot disable it.`,
          );
        }
      }
      // Validate that at least one effect has both appearAnimation and appearSfx
      const hasValidAnimation = input.data.effects.some(
        (effect) =>
          "appearAnimation" in effect &&
          effect.appearAnimation &&
          "appearSfx" in effect &&
          effect.appearSfx,
      );
      if (!input.data.hidden && !hasValidAnimation) {
        return errorResponse(
          "At least one effect must have both appearAnimation and appearSfx defined",
        );
      }
      if (input.data.jutsuType === "AI" && input.data.parentJutsuId) {
        return errorResponse("AI jutsus cannot be evolutions");
      }
      if (input.data.jutsuType === "AI" && relations.childEvolutions.length > 0) {
        return errorResponse("AI jutsus cannot have evolution children");
      }
      // Validate evolution chain constraints
      if (input.data.parentJutsuId) {
        if (parent?.jutsuType === "AI")
          return errorResponse("AI jutsus cannot be evolution parents");
        if (parent?.reskinParentJutsuId)
          return errorResponse("Reskins cannot be evolution parents");
        const graphValidation = validateEvolutionGraph({
          contentId: input.id,
          parentId: input.data.parentJutsuId,
          parentExists: !!parent,
          parentParentId: parent?.parentJutsuId ?? null,
          siblingIds: siblings.map((s) => s.id),
          graph: evolutionGraph.map((node) => ({
            id: node.id,
            parentId: node.parentJutsuId,
          })),
          contentLabel: "jutsu",
        });
        if (!graphValidation.ok) return errorResponse(graphValidation.message);
      }
      // Parent and child mechanics must commit together. Lock the family root so
      // concurrent parent edits and newly linked children cannot leave stale copies.
      const saved = await saveJutsuFamily(ctx.drizzle, entry, input.data, ctx.userId);
      if (!saved.success) return errorResponse(saved.message);
      const diff = saved.diff;
      if (input.data.hidden) {
        await updateUserJutsuForUpdate(ctx.drizzle, entry);
      }
      await outdateProposalsFor(
        ctx.drizzle,
        "JUTSU",
        saved.ids,
        editedReason("JUTSU", entry.name, user.username),
      );
      if (process.env.NODE_ENV !== "development") {
        await callDiscordContent(user.username, entry.name, diff, entry.image);
      }
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),

  getUserJutsus: protectedProcedure
    .meta({ mcp: { description: "Get current user's jutsus" } })
    .input(userJutsuFilteringSchema)
    .query(async ({ ctx, input }) => {
      return await fetchUserJutsus(ctx.drizzle, ctx.userId, input);
    }),
  // Get jutsus of public user
  getPublicUserJutsus: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const [user, results] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserJutsus(ctx.drizzle, input.userId),
      ]);
      // Guard - the result only annotates jutsu names with levels, so a viewer
      // without editing rights simply sees no levels
      if (!canEditJutsus(user.role)) return [];
      // Return
      return results;
    }),
  // Adjust jutsu level of public user (and optionally reskin)
  adjustUserJutsu: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        jutsuId: z.string(),
        level: z.number().int().min(0),
        reskinId: z.string().nullable().optional(),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, userjutsus, reskin] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserJutsus(ctx.drizzle, input.userId),
        ...(input.reskinId
          ? [
              findJutsuReskinForAdjustUserJutsu(ctx.drizzle, {
                reskinId: input.reskinId,
                jutsuId: input.jutsuId,
              }),
            ]
          : []),
      ]);
      // Guard)
      if (!canEditJutsus(user.role)) {
        return errorResponse("Not allowed to edit public user");
      }
      // Roles that can only edit themselves
      if (canOnlyEditSelf(user.role) && user.userId !== input.userId) {
        return errorResponse("You can only edit your own jutsus");
      }
      const userjutsu = userjutsus.find((j) => j.jutsuId === input.jutsuId);
      if (!userjutsu) {
        return errorResponse("Jutsu not found for user");
      }
      if (input.level > getJutsuMaxLevel(userjutsu.jutsu))
        return errorResponse(
          `Jutsu level cannot exceed ${getJutsuMaxLevel(userjutsu.jutsu)}`,
        );
      if (input.reskinId && !reskin) {
        return errorResponse("Reskin not found for this jutsu");
      }
      // Action loggin
      const prevReskinName = userjutsu.activeReskin?.name ?? null;
      const newReskinName = reskin?.name ?? null;
      const updateFields = {
        level: input.level,
        updatedAt: new Date(),
        reskinId: input.reskinId,
      };

      const changes: string[] = [
        `Jutsu ${userjutsu.jutsu.name} lvl ${userjutsu.level} -> ${input.level}`,
      ];
      if (input.reskinId !== undefined && prevReskinName !== newReskinName) {
        changes.push(
          `Jutsu ${userjutsu.jutsu.name} reskin ${prevReskinName ?? "None"} -> ${newReskinName ?? "None"}`,
        );
      }

      // Mutate
      await Promise.all([
        updateUserJutsuForAdjustUserJutsu(ctx.drizzle, updateFields, input),
        insertActionLogForAdjustUserJutsu(ctx.drizzle, ctx, changes, input, userjutsu),
      ]);
      return { success: true, message: `Jutsu updated` };
    }),
  // Start training a given jutsu
  startTraining: protectedProcedure
    .meta({ mcp: { description: "Start training a jutsu" } })
    .input(
      z.object({
        jutsuId: z.string(),
        // Successive levels of this jutsu to buy at once; the extra ones are queued.
        levels: z.number().int().min(1).max(MAX_JUTSU_LEVELS_PER_REQUEST).optional(),
      }),
    )
    .output(
      baseServerResponse.extend({
        data: z
          .object({ money: z.number(), questData: z.array(QuestTracker).nullable() })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [data, info, fetchedJutsus, students] = await Promise.all([
        fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
        fetchJutsu(ctx.drizzle, input.jutsuId),
        fetchUserJutsus(ctx.drizzle, ctx.userId),
        fetchStudents(ctx.drizzle, ctx.userId),
      ]);
      // The refresh may have started a queued level the parallel read missed (rare).
      const userjutsus =
        data.startedQueuedJobs > 0
          ? await fetchUserJutsus(ctx.drizzle, ctx.userId)
          : fetchedJutsus;
      const { user } = data;
      if (!user) return errorResponse("User not found");
      const waiting = liveQueueRows(user.queue ?? [], "JUTSU");
      // Gear and skill mastery buffs count, as they do for equipping
      const masteries = effectiveMasteries(user);

      // Derived
      const userjutsuObj = userjutsus.find((j) => j.jutsuId === input.jutsuId);
      const equippedJutsus = userjutsus.filter((uj) => uj.equipped);
      const curEquip = equippedJutsus.length;
      const maxEquip = calcJutsuEquipLimit(user);
      const equippedCapCounts = countEquippedByCap(equippedJutsus);

      if (!info) return errorResponse("Jutsu not found");
      if (!canTrainJutsu(info, user, masteries) && !info.parentJutsuId)
        return errorResponse("Jutsu not for you");
      if (!userjutsuObj && isJutsuTrainToLearnRestricted(info.jutsuType)) {
        return errorResponse("This jutsu cannot be learned through training");
      }
      if (info.parentJutsuId && !userjutsuObj)
        return errorResponse(
          "Evolution jutsus can only be obtained by evolving the parent jutsu",
        );
      if (
        info.parentJutsuId &&
        userjutsuObj &&
        !canUseJutsu(info, user, true, masteries, true)
      )
        return errorResponse("Jutsu not for you");
      if (
        userjutsus.some(
          (j) =>
            j.jutsu.parentJutsuId === input.jutsuId ||
            j.parentJutsuParentId === input.jutsuId,
        )
      )
        return errorResponse("You have already evolved this jutsu");
      if (user.status !== "AWAKE") return errorResponse("Must be awake");

      // Levels already queued for this jutsu count toward the one being bought.
      const level =
        (userjutsuObj ? userjutsuObj.level : 0) +
        waiting.filter((entry) => entry.jutsuId === input.jutsuId).length;
      if (level >= JUTSU_LEVEL_CAP) {
        return errorResponse("Jutsu is already at max level");
      }
      // Every requested level must still be a legal level-up when its turn comes.
      const levels = input.levels ?? 1;
      if (level + levels > JUTSU_LEVEL_CAP) {
        const left = JUTSU_LEVEL_CAP - level;
        return errorResponse(
          `Only ${left} more level${left === 1 ? "" : "s"} of this jutsu can be trained`,
        );
      }
      if (info.hidden && !canChangeContent(user.role)) {
        return errorResponse("Jutsu is hidden, cannot be trained");
      }
      const active = findJutsuInTraining(userjutsus, Date.now());
      const isQueueing = !!active || waiting.length > 0;
      // Levels that go to the waiting queue: all of them behind an active training,
      // otherwise every level after the one that starts now.
      const queuedLevels = isQueueing ? levels : levels - 1;
      if (queuedLevels > 0 && !hasQueueRoom(user, waiting.length + queuedLevels - 1)) {
        return errorResponse(
          levels > 1
            ? "Not enough room in your jutsu training queue for that many levels"
            : "Your jutsu training queue is full",
        );
      }
      if (isQueueing) {
        // The room check above is a fast path; enqueueJutsuLevels re-checks it under
        // the user lock so concurrent requests cannot overfill the queue.
        const planned = planJutsuLevels({
          info,
          user,
          students,
          fromLevel: level,
          count: levels,
          previousFinish: waiting.at(-1)?.finishesAt ?? active?.finishTraining,
        });
        const queued = await enqueueJutsuLevels(
          ctx.drizzle,
          user,
          input.jutsuId,
          planned,
        );
        if (!queued.success) return errorResponse(queued.message);
        return {
          success: true,
          message: `Queued ${info.name} ${formatLevelRange(level + 1, level + levels)}`,
          data: {
            money: user.money - queued.cost,
            questData: getPublicQuestUser(user).questData,
          },
        };
      }

      // Time & cost
      const trainingStartedAt = new Date();
      const trainTime = calcJutsuTrainTime(info, level, user, trainingStartedAt);
      const trainCost = calcJutsuTrainCost(info, level, user, students);
      const finishTraining = new Date(trainingStartedAt.getTime() + trainTime);
      // Further levels bought now wait behind this one
      const followUps = planJutsuLevels({
        info,
        user,
        students,
        fromLevel: level + 1,
        count: queuedLevels,
        previousFinish: finishTraining,
      });
      const followUpCost = followUps.reduce((sum, entry) => sum + entry.reservedRyo, 0);
      if (user.money < trainCost + followUpCost) {
        return errorResponse("You don't have enough money");
      }

      // Quests
      let questDataFull = user.questData ?? [];
      if (!userjutsuObj) {
        const { trackers } = getNewTrackers(user, [
          { task: "jutsus_mastered", increment: 1 },
          {
            task: "train_specific_jutsu",
            increment: 1,
            contentId: input.jutsuId,
            masteryTypes: jutsuMasteryTypes(info),
          },
        ]);
        questDataFull = trackers;
      }
      const questDataForDb = filterQuestTrackersForDbPersist(questDataFull, user);

      // Deduct money first, but persist new-jutsu quest progress only after the
      // ownership insert is confirmed. A duplicate request can then refund its
      // own money without restoring a stale questData snapshot over the winner.
      const moneyUpdate = await debitUserMoney(ctx.drizzle, trainCost, ctx);
      if (moneyUpdate.rowsAffected !== 1) {
        return errorResponse("You don't have enough money");
      }

      // Insert or update user jutsu
      if (userjutsuObj) {
        await updateUserJutsuForStartTraining(
          ctx.drizzle,
          trainingStartedAt,
          finishTraining,
          userjutsuObj,
          ctx,
        );
      } else {
        // Soft pre-check whether auto-equip is likely to succeed. Insert already
        // equipped when the snapshot says yes; only the over-cap rollback CAS
        // runs afterward to handle concurrent equips (under-cap re-check would
        // duplicate what the rollback covers a moment later).
        const capFlags = getJutsuCapFlags(info);
        const canAutoEquip =
          hasRequiredSkill(info, user) &&
          curEquip < maxEquip &&
          checkJutsuBloodlineItem(info, user.items) &&
          canEquipUnderCaps(capFlags, equippedCapCounts);

        const newUserJutsuId = nanoid();
        // onDuplicateKeyUpdate no-op (`id = id`) absorbs unique-index races. PlanetScale
        // reports changed rows, so a duplicate yields rowsAffected === 0 (not 2). Deduct
        // already happened above, so refund it when this request definitively did not
        // insert. Quest progress has not been persisted yet and needs no compensation.
        const refundTrainCost = () =>
          incrementUserMoney(ctx.drizzle, trainCost, ctx.userId);

        let insertedByThisRequest = false;
        try {
          const insertResult = await insertUserJutsuForStartTraining(
            ctx.drizzle,
            newUserJutsuId,
            ctx,
            input,
            trainingStartedAt,
            finishTraining,
            canAutoEquip,
          );
          insertedByThisRequest = insertResult.rowsAffected === 1;
        } catch {
          // A transport error can arrive after MySQL committed the insert. Re-read
          // the unique ownership row before compensating so a committed training
          // session is never refunded and granted for free.
          let persisted: { id: string } | undefined;
          try {
            [persisted] = await selectUserJutsuForStartTraining(
              ctx.drizzle,
              ctx,
              input,
            );
          } catch {
            return errorResponse(
              "Training status could not be confirmed — please refresh before retrying",
            );
          }
          insertedByThisRequest = persisted?.id === newUserJutsuId;
          if (!insertedByThisRequest) {
            await refundTrainCost();
            return errorResponse(
              persisted
                ? "You already own this jutsu — please refresh and try again"
                : "Failed to start training — please try again",
            );
          }
        }

        if (!insertedByThisRequest) {
          await refundTrainCost();
          return errorResponse(
            "You already own this jutsu — please refresh and try again",
          );
        }

        await Promise.all([
          updateUserQuestData(ctx.drizzle, questDataForDb, ctx.userId),
          canAutoEquip
            ? rollbackEquipIfOverCap({
                client: ctx.drizzle,
                userId: ctx.userId,
                userJutsuId: newUserJutsuId,
                maxEquip,
                flags: capFlags,
              })
            : undefined,
        ]);
      }

      // Queue the further levels; the started one stands even if this fails.
      const queued = await enqueueJutsuLevels(
        ctx.drizzle,
        user,
        input.jutsuId,
        followUps,
      );
      const queuedCost = queued.success ? queued.cost : 0;
      return {
        success: true,
        message: queued.success
          ? followUps.length > 0
            ? `You started training: ${info.name}, and queued ${formatLevelRange(level + 2, level + 1 + followUps.length)}`
            : `You started training: ${info.name}`
          : `You started training: ${info.name}, but the further levels could not be queued: ${queued.message}`,
        data: {
          money: user.money - trainCost - queuedCost,
          questData: getPublicQuestUser({ ...user, questData: questDataFull })
            .questData,
        },
      };
    }),

  stopTraining: protectedProcedure
    .meta({ mcp: { description: "Stop training current jutsu" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      const [userjutsus, waiting] = await Promise.all([
        fetchUserJutsus(ctx.drizzle, ctx.userId),
        fetchJutsuTrainingQueue(ctx.drizzle, ctx.userId),
      ]);
      const userjutsuObj = findJutsuInTraining(userjutsus, Date.now());
      if (!userjutsuObj) {
        return { success: false, message: "Not training any jutsu" };
      }
      await updateUserJutsuForStopTraining(ctx.drizzle, userjutsuObj, ctx);
      // The next queued level starts now instead of in the stopped training's slot.
      if (waiting.length > 0) {
        await settleJutsuTrainingQueue(ctx.drizzle, ctx.userId, new Date(), waiting);
      }

      return {
        success: true,
        message: `You stopped training: ${userjutsuObj.jutsu?.name}`,
      };
    }),

  getTrainingQueue: protectedProcedure
    .meta({
      mcp: { description: "Get jutsu levels queued behind the active training" },
    })
    .output(jutsuTrainingQueueOutputSchema)
    .query(async ({ ctx }) => {
      const fetchOwned = () => selectUserJutsuForFetchOwned(ctx.drizzle, ctx);
      let [user, waiting, owned] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchJutsuTrainingQueue(ctx.drizzle, ctx.userId),
        fetchOwned(),
      ]);
      // Polled on its own, so reading the queue starts levels whose turn has come.
      if (hasDueTimedJob(waiting)) {
        await settleJutsuTrainingQueue(ctx.drizzle, ctx.userId, new Date(), waiting);
        [waiting, owned] = await Promise.all([
          fetchJutsuTrainingQueue(ctx.drizzle, ctx.userId),
          fetchOwned(),
        ]);
      }
      // A jutsu queued several times trains successive levels, in queue order.
      const nextLevel = new Map(owned.map((row) => [row.jutsuId, row.level]));
      return {
        capacity: getQueueTotalCapacity(user),
        waiting: waiting.map((entry) => {
          const level = (nextLevel.get(entry.jutsuId) ?? 0) + 1;
          nextLevel.set(entry.jutsuId, level);
          return {
            id: entry.id,
            jutsuId: entry.jutsuId,
            name: entry.jutsu?.name ?? "Removed jutsu",
            image: entry.jutsu?.image ?? null,
            reservedRyo: entry.reservedRyo,
            level,
            durationSeconds: entry.durationSeconds,
            startsAt: entry.startsAt,
            finishesAt: entry.finishesAt,
          };
        }),
      };
    }),

  cancelQueuedTraining: protectedProcedure
    .meta({ mcp: { description: "Cancel a queued jutsu level and refund its ryo" } })
    .input(cancelQueuedJobInputSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const cancelled = await cancelQueuedJutsuTraining(
        ctx.drizzle,
        ctx.userId,
        input.queueId,
      );
      if (!cancelled) return errorResponse("That queued training already started");
      return {
        success: true,
        message: `Queued training cancelled, ${cancelled.refunded.toLocaleString()} ryo refunded`,
        // Only the refund changed the profile, unless the cancellation let a queued
        // level start (it may refund the difference and advance quests): refresh then.
        ...(cancelled.started === 0
          ? { userDelta: { money: cancelled.refunded } }
          : {}),
      };
    }),

  unequipAll: protectedProcedure
    .meta({ mcp: { description: "Unequip all jutsus" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      const [data, loadouts] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchJutsuLoadouts(ctx.drizzle, ctx.userId),
      ]);
      const { user } = data;
      if (!user) return errorResponse("User not found");

      const loadout = loadouts.find((l) => l.id === user.jutsuLoadout);

      await Promise.all([
        updateUserJutsuForUnequipAll(ctx.drizzle, ctx),
        loadout ? updateJutsuLoadoutForUnequipAll(ctx.drizzle, loadout) : null,
      ]);

      return { success: true, message: "All jutsu unequipped" };
    }),

  toggleEquip: protectedProcedure
    .meta({ mcp: { description: "Toggle jutsu equip status" } })
    .input(z.object({ userJutsuId: z.string() }))
    .output(
      baseServerResponse.extend({
        data: z.object({ equipped: z.boolean(), jutsuId: z.string() }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [userjutsus, data, loadouts] = await Promise.all([
        fetchUserJutsus(ctx.drizzle, ctx.userId),
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchJutsuLoadouts(ctx.drizzle, ctx.userId),
      ]);
      const { user } = data;
      if (!user) return errorResponse("User not found");

      const userjutsuObj = userjutsus.find((j) => j.id === input.userJutsuId);
      const isEquipped = userjutsuObj?.equipped || false;
      const equippedJutsus = userjutsus.filter((j) => j.equipped);
      const curEquip = equippedJutsus.length || 0;
      const maxEquip = calcJutsuEquipLimit(user);
      const curJutsuFlags = userjutsuObj
        ? getJutsuCapFlags(userjutsuObj.jutsu)
        : undefined;
      const equippedCapCounts = countEquippedByCap(equippedJutsus);
      const newEquippedState = !isEquipped;
      const loadout = loadouts.find((l) => l.id === user.jutsuLoadout);

      // Guards
      if (!userjutsuObj) return errorResponse("Jutsu not found");
      if (!isEquipped && userjutsuObj.jutsu.hidden && !canChangeContent(user.role))
        return errorResponse("Jutsu is hidden, cannot be equipped");

      // Check if jutsu can be equipped (bloodline item handled separately below for a
      // clearer error message, so skip it inside canUseJutsu here)
      const masteries = effectiveMasteries(user);
      if (!isEquipped && !canUseJutsu(userjutsuObj.jutsu, user, true, masteries)) {
        return errorResponse("You cannot equip this jutsu due to missing requirements");
      }
      if (!isEquipped && !checkJutsuBloodlineItem(userjutsuObj.jutsu, user.items)) {
        return errorResponse(
          "You don't have the required bloodline item equipped for this jutsu",
        );
      }

      if (!isEquipped && curEquip >= maxEquip) {
        return errorResponse("You cannot equip more jutsu");
      }
      if (!isEquipped && curJutsuFlags) {
        const exceeded = findExceededJutsuEquipCap(curJutsuFlags, equippedCapCounts);
        if (exceeded) {
          return errorResponse(
            `You cannot equip more than ${exceeded.max} ${exceeded.label} jutsu`,
          );
        }
      }

      // Calculate loadout after a successful equip/unequip write
      if (newEquippedState) {
        // CAS equip with live cap counts so concurrent equips cannot both slip under a
        // snapshot-based heal/pierce/… check (see tryEquipUserJutsuAtomically).
        const equipResult = await tryEquipUserJutsuAtomically({
          client: ctx.drizzle,
          userId: ctx.userId,
          userJutsuId: input.userJutsuId,
          maxEquip,
          flags: getJutsuCapFlags(userjutsuObj.jutsu),
        });
        if (equipResult === "already-equipped") {
          return errorResponse(
            "Could not equip jutsu — it may already be equipped. Please refresh and retry.",
          );
        }
        if (equipResult === "cap-reached") {
          return errorResponse(
            "Could not equip jutsu — an equip limit was reached. Please retry.",
          );
        }
        // Atomic JSON append — concurrent equips must not replace the whole array from
        // stale snapshots (last writer would drop the other jutsuId). If sync fails,
        // roll back the equip only when the active loadout still lacks this jutsu —
        // membership is checked inside the UPDATE so a concurrent selectLoadout/equip
        // that already made state consistent cannot be clobbered (check-then-act window).
        if (loadout) {
          const synced = await appendJutsuIdToLoadoutAtomically({
            client: ctx.drizzle,
            loadoutId: loadout.id,
            userId: ctx.userId,
            jutsuId: userjutsuObj.jutsuId,
          });
          if (!synced) {
            const rolledBack = await updateUserJutsuForToggleEquip(
              ctx.drizzle,
              input,
              ctx,

              userjutsuObj,
            );
            if (rolledBack.rowsAffected === 1) {
              return errorResponse("Failed to update loadout — please retry");
            }
            // 0 rows: either a concurrent writer already put this id in the
            // active loadout (leave equipped), or a concurrent unequip already
            // flipped the row. Only report success when the row is still on.
            const [row] = await selectUserJutsuEquipped(
              ctx.drizzle,
              input.userJutsuId,
              ctx.userId,
            );
            if (!row?.equipped) {
              return errorResponse("Failed to update loadout — please retry");
            }
          }
        }
      } else {
        // Remove from loadout first, then unequip. On unequip failure, re-append only
        // when the row is still equipped — if the UPDATE committed but the response
        // was lost, re-appending would leave the loadout listing an unequipped jutsu.
        if (loadout) {
          const synced = await removeJutsuIdFromLoadoutAtomically({
            client: ctx.drizzle,
            loadoutId: loadout.id,
            userId: ctx.userId,
            jutsuId: userjutsuObj.jutsuId,
          });
          if (!synced) {
            return errorResponse("Failed to update loadout — please retry");
          }
        }
        try {
          const unequipped = await updateUserJutsuForToggleEquip(
            ctx.drizzle,
            input,
            ctx,

            userjutsuObj,
          );
          if (unequipped.rowsAffected !== 1) {
            const [row, activeIds] = await Promise.all([
              selectUserJutsuEquipped(ctx.drizzle, input.userJutsuId, ctx.userId).then(
                (rows) => rows[0],
              ),
              fetchActiveLoadoutJutsuIds(ctx.drizzle, ctx.userId),
            ]);
            if (row && !row.equipped && !activeIds?.includes(userjutsuObj.jutsuId)) {
              return {
                success: true,
                message: "Jutsu unequipped",
                data: { equipped: false, jutsuId: userjutsuObj.jutsuId },
              };
            }
            return errorResponse(
              "Active loadout changed while unequipping — please refresh and retry",
            );
          }
        } catch {
          const [row] = await selectUserJutsuEquipped(
            ctx.drizzle,
            input.userJutsuId,
            ctx.userId,
          );
          if (row && !row.equipped) {
            // Unequip committed despite the lost/failed response — loadout already
            // removed; treat as success rather than restoring a stale id.
            return {
              success: true,
              message: "Jutsu unequipped",
              data: { equipped: false, jutsuId: userjutsuObj.jutsuId },
            };
          }
          if (loadout && row?.equipped) {
            await appendJutsuIdToLoadoutAtomically({
              client: ctx.drizzle,
              loadoutId: loadout.id,
              userId: ctx.userId,
              jutsuId: userjutsuObj.jutsuId,
            });
          }
          return errorResponse("Failed to unequip jutsu — please retry");
        }
      }

      return {
        success: true,
        message: `Jutsu ${isEquipped ? "unequipped" : "equipped"}`,
        data: { equipped: newEquippedState, jutsuId: userjutsuObj.jutsuId },
      };
    }),

  updateUserJutsuOrder: protectedProcedure
    .meta({ mcp: { description: "Reorder jutsu in loadout" } })
    .input(
      z.object({
        jutsuId: z.string(),
        loadoutId: z.string(),
        moveForward: z.boolean(),
      }),
    )
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const loadouts = await fetchJutsuLoadouts(ctx.drizzle, ctx.userId);
      const loadout = loadouts.find((l) => l.id === input.loadoutId);
      if (!loadout) return errorResponse("Loadout not found");

      const curIndex = loadout.jutsuIds.indexOf(input.jutsuId);
      if (curIndex === -1) return errorResponse("Jutsu not found in loadout");
      if (curIndex === 0 && !input.moveForward) {
        return errorResponse("Already first");
      }
      if (curIndex === loadout.jutsuIds.length - 1 && input.moveForward) {
        return errorResponse("Already last");
      }

      const withoutJutsu = loadout.jutsuIds.filter((id) => id !== input.jutsuId);
      const newIndex = curIndex + (input.moveForward ? 1 : -1);
      const newOrder = withoutJutsu.splice(0, newIndex);
      newOrder.push(input.jutsuId);
      newOrder.push(...loadout.jutsuIds.filter((id) => !newOrder.includes(id)));

      await updateJutsuLoadoutIds(ctx.drizzle, newOrder, loadout.id);

      return {
        success: true,
        message: `Order updated`,
        userPatch: { loadout: { jutsuIds: newOrder } },
      };
    }),

  setLoadoutHotkeys: protectedProcedure
    .meta({ mcp: { description: "Set the battle hotkeys of a jutsu loadout" } })
    .input(setLoadoutHotkeysSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const result = await updateJutsuLoadoutForSetLoadoutHotkeys(
        ctx.drizzle,
        input,
        ctx,
      );
      // MySQL reports no affected row when the keys did not change, so confirm
      // ownership before calling an unchanged save a failure.
      if (result.rowsAffected === 0) {
        const exists = await findJutsuLoadoutForRenameLoadout(ctx.drizzle, input, ctx);
        if (!exists) return errorResponse("Loadout not found");
      }
      return { success: true, message: "Hotkeys saved" };
    }),
  renameLoadout: protectedProcedure
    .meta({ mcp: { description: "Rename a jutsu loadout" } })
    .input(renameLoadoutSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [loadouts, user] = await Promise.all([
        fetchJutsuLoadouts(ctx.drizzle, ctx.userId),
        fetchLoadoutUser(ctx.drizzle, ctx.userId),
      ]);
      return applyLoadoutRename(
        decideRename(loadouts, fedJutsuLoadouts(user), input),
        (name) => updateJutsuLoadoutForRenameLoadout(ctx.drizzle, name, input, ctx),
        () =>
          findJutsuLoadoutForRenameLoadout(ctx.drizzle, input, ctx).then(
            (row) => !!row,
          ),
      );
    }),

  createReskin: protectedProcedure
    .meta({ mcp: { description: "Create a jutsu reskin" } })
    .input(jutsuReskinCreateSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, jutsuData, userReskins] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchJutsu(ctx.drizzle, input.jutsuId),
        fetchUserReskins(ctx.drizzle, ctx.userId),
      ]);
      // Derived
      const curReskins = userReskins?.length || 0;
      const maxReskins = user.extraReskinSlots + RESKIN_LIMIT;
      const existingReskin = userReskins.find((r) => r.jutsuId === input.jutsuId);
      // Guards
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!jutsuData) {
        return errorResponse("Original jutsu not found");
      }
      if (!existingReskin && curReskins >= maxReskins) {
        return errorResponse(
          `You have used all your reskins (${curReskins}/${maxReskins})`,
        );
      }
      if (
        !existingReskin &&
        !canReskinFreely(user.role) &&
        user.reputationPoints < COST_RESKIN_JUTSU
      ) {
        return errorResponse(
          `Not enough reputation points. Required: ${COST_RESKIN_JUTSU}`,
        );
      }
      // Default image fallback to original jutsu image if omitted
      const resolvedImage = input.image ?? jutsuData.image;

      // Run mutation (free update or new)
      if (existingReskin) {
        await Promise.all([
          updateJutsuReskinForCreateReskin(
            ctx.drizzle,
            input,
            resolvedImage,
            existingReskin,
          ),
          setUserJutsuReskin(ctx.drizzle, existingReskin.id, jutsuData.id, ctx.userId),
        ]);
        return { success: true, message: "Jutsu reskin updated successfully" };
      } else {
        const reskinId = nanoid();
        await Promise.all([
          setUserJutsuReskin(ctx.drizzle, reskinId, jutsuData.id, ctx.userId),
          insertJutsuReskinForCreateReskin(
            ctx.drizzle,
            reskinId,
            ctx,
            jutsuData,
            input,
            resolvedImage,
          ),
          ...(canReskinFreely(user.role)
            ? []
            : [updateUserDataForCreateReskin(ctx.drizzle, ctx)]),
        ]);

        return { success: true, message: "Jutsu reskin created successfully" };
      }
    }),

  updateReskin: protectedProcedure
    .input(updateJutsuReskinSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const { reason, username, jutsuId, attached, ...cosmetics } = input.data;
      // The assignment target is resolved by username inside each query, so every
      // lookup runs in parallel.
      const targetUserId = selectUserDataForUpdateReskin(ctx.drizzle, username);
      // Query
      const [user, reskin, targetUser, targetJutsu, conflict, targetUserJutsu, usages] =
        await Promise.all([
          fetchUser(ctx.drizzle, ctx.userId),
          fetchReskin(ctx.drizzle, input.reskinId),
          findUserDataForGetUsername(ctx.drizzle, { username }),
          findJutsuForUpdateReskin(ctx.drizzle, jutsuId),
          findJutsuReskinForUpdateReskin(ctx.drizzle, targetUserId, jutsuId, input),
          findUserJutsuForUpdateReskin(ctx.drizzle, targetUserId, jutsuId),
          listUserJutsuForUpdateReskin(ctx.drizzle, input),
        ]);
      // Guards
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canModerateReskin(user.role)) return errorResponse("Unauthorized");
      if (!reskin) return errorResponse("Reskin not found");
      if (!targetUser) return errorResponse(`User ${username} not found`);
      if (!targetJutsu) return errorResponse("Jutsu not found");
      if (conflict) {
        return errorResponse(
          `${targetUser.username} already has a reskin for ${targetJutsu.name}`,
        );
      }
      if (attached && !targetUserJutsu) {
        return errorResponse(
          `${targetUser.username} does not know ${targetJutsu.name}, so the reskin cannot be attached`,
        );
      }
      // Jutsu that stop using this reskin: any copy of a different base jutsu, the
      // previous owner's copy when ownership moves, and the owner's copy when detached
      const ownerChanged = reskin.userId !== targetUser.userId;
      const detachIds = usages
        .filter(
          (usage) =>
            usage.jutsuId !== targetJutsu.id ||
            (ownerChanged && usage.userId === reskin.userId) ||
            (!attached && usage.userId === targetUser.userId),
        )
        .map((usage) => usage.id);
      const shouldAttach =
        attached && targetUserJutsu && targetUserJutsu.reskinId !== reskin.id;
      // Prepare old/new objects for diff
      const wasAttached = isAttachedToOwner(reskin, usages);
      const oldData = {
        name: reskin.name,
        description: reskin.description,
        battleDescription: reskin.battleDescription,
        image: reskin.image,
        owner: reskin.user?.username,
        jutsu: reskin.jutsu?.name,
        attached: wasAttached,
      };
      const newData = {
        ...cosmetics,
        owner: targetUser.username,
        jutsu: targetJutsu.name,
        attached,
      };
      const diff = calculateContentDiff(oldData, newData);

      // AI moderation of reason
      const aiCheck = await validateUserUpdateReason(diff.join(". "), reason);
      if (!aiCheck.allowUpdate) {
        await insertActionLogForUpdateReskin(ctx.drizzle, ctx, aiCheck, reskin, reason);
        return errorResponse(aiCheck.comment);
      }

      // Staff-only cosmetic repairs are reversible. Keep the writes parallel;
      // concurrent staff edits may need another repair, but grant no player value.
      await Promise.all([
        updateJutsuReskinForUpdateReskin(
          ctx.drizzle,
          targetUser,
          targetJutsu,
          cosmetics,
          reskin,
        ),
        ...(detachIds.length > 0
          ? [updateUserJutsuForUpdateReskin(ctx.drizzle, detachIds, reskin)]
          : []),
        ...(shouldAttach
          ? [updateUserJutsuForUpdateReskin2(ctx.drizzle, reskin, targetUserJutsu)]
          : []),
        insertActionLogForUpdateReskin2(
          ctx.drizzle,
          ctx,
          diff,
          targetJutsu,
          cosmetics,
          reskin,
        ),
      ]);

      return { success: true, message: "Jutsu reskin updated successfully" };
    }),

  getAllReskins: publicProcedure
    .meta({ mcp: { description: "Get paginated jutsu reskins" } })
    .input(
      jutsuFilteringSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(1000),
        hideAi: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ?? 0;
      const skip = currentCursor * input.limit;

      // Build the base DB filter (on underlying jutsu)
      const baseFilters = jutsuDatabaseFilter(input);
      const jutsuFilters = and(
        ...baseFilters,
        ...(input.hideAi ? [ne(jutsu.jutsuType, "AI")] : []),
      );

      // Query reskins joined with jutsu to allow filtering via jutsuDatabaseFilter.
      // Reskins whose base jutsu was deleted (jutsu is null) bypass the jutsu
      // filters and are listed first, so staff can re-point them with updateReskin.
      const rows = await selectJutsuReskinForGetAllReskins(
        ctx.drizzle,
        jutsuFilters,
        skip,
        input,
      );

      // Map back to the previous shape used by the frontend consumer
      const results = rows
        .filter(
          (row) =>
            !row.jutsu || filterByEffectConstraints([row.jutsu], input).length > 0,
        )
        .map((row) => ({
          ...row.reskin,
          jutsu: row.jutsu
            ? {
                ...row.jutsu,
                bloodline: row.bloodlineName ? { name: row.bloodlineName } : null,
              }
            : null,
          user: {
            username: row.userUsername,
          },
        }));

      const nextCursor = rows.length < input.limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor,
      };
    }),

  getUserReskins: protectedProcedure
    .meta({ mcp: { description: "Get user's jutsu reskins" } })
    .query(async ({ ctx }) => {
      return await fetchUserReskins(ctx.drizzle, ctx.userId);
    }),

  // List all reskins available for a given base jutsu
  getReskinsForJutsu: protectedProcedure
    .meta({ mcp: { description: "Get all reskins for a jutsu" } })
    .input(z.object({ jutsuId: z.string() }))
    .query(async ({ ctx, input }) => {
      const reskins = await listJutsuReskinForGetReskinsForJutsu(ctx.drizzle, input);
      return reskins;
    }),

  getReskin: protectedProcedure
    .meta({ mcp: { description: "Get a specific jutsu reskin" } })
    .input(getJutsuReskinSchema)
    .query(async ({ ctx, input }) => {
      // Query
      const [user, reskin, usages] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchReskin(ctx.drizzle, input.reskinId),
        listUserJutsuForGetReskin(ctx.drizzle, input),
      ]);
      // Guard - players only see their own reskins, staff can see any
      if (!reskin || (reskin.userId !== ctx.userId && !canModerateReskin(user.role))) {
        return errorResponse("Reskin not found");
      }
      // Return
      return { ...reskin, attached: isAttachedToOwner(reskin, usages) };
    }),
  removeReskin: protectedProcedure
    .meta({ mcp: { description: "Remove reskin from a jutsu" } })
    .input(z.object({ userJutsuId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const userJutsuData = await findUserJutsuForRemoveReskin(ctx.drizzle, input, ctx);
      // Guard
      if (!userJutsuData) {
        return errorResponse("User jutsu not found");
      }
      if (!userJutsuData.activeReskin) {
        return errorResponse("No reskin found for this jutsu");
      }
      // Remove the reskin (but keep the record for history + free future updates)
      await Promise.all([updateUserJutsuForRemoveReskin(ctx.drizzle, input, ctx)]);
      // Return
      return {
        success: true,
        message: "Jutsu reskin removed successfully",
      };
    }),

  getJutsuRelations: publicProcedure
    .meta({
      mcp: { description: "Get jutsu relations and dependencies" },
    })
    .input(z.object({ jutsuId: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await getJutsuRelations(ctx.drizzle, input.jutsuId);
      return results;
    }),
});

/**
 * COMMON QUERIES/HELPERS
 */
export const getJutsuRelations = async (client: DrizzleClient, jutsuId: string) => {
  const [
    jutsuInjectors,
    bloodlineInjectors,
    skillInjectors,
    itemInjectors,
    aiUsingJutsu,
    questsUsingJutsu,
    childEvolutions,
    linkedReskins,
    playerReskins,
  ] = await Promise.all([
    listJutsuForGetJutsuRelations(client, jutsuId),
    listBloodlineForGetJutsuRelations(client, jutsuId),
    listSkillTreeForGetJutsuRelations(client, jutsuId),
    listItemForGetJutsuRelations(client, jutsuId),
    selectUserJutsuForGetJutsuRelations(client, jutsuId),
    listQuestForGetJutsuRelations(client, jutsuId),
    listJutsuForGetJutsuRelations2(client, jutsuId),
    listJutsuForGetJutsuRelations3(client, jutsuId),
    // Player-owned reskins reference the jutsu by id; staff re-point them with
    // updateReskin before the jutsu can be deleted.
    selectJutsuReskinForGetJutsuRelations(client, jutsuId),
  ]);

  return {
    jutsuInjectors,
    bloodlineInjectors,
    skillInjectors,
    itemInjectors,
    aiUsingJutsu,
    questsUsingJutsu,
    childEvolutions,
    linkedReskins,
    playerReskins,
  };
};
export type JutsuRelations = Awaited<ReturnType<typeof getJutsuRelations>>;

/**
 * Resolve current recipient, destination and eligibility for either sharing endpoint.
 * Independent reads run in parallel; the fingerprint binds confirmation to their result.
 */
const prepareJutsuLoadoutImport = async (
  client: DrizzleClient,
  userId: string,
  input: { loadoutId: string; text: string },
) => {
  const parsed = sharedJutsuLoadoutTextSchema.safeParse(input.text);
  if (!parsed.success)
    return errorResponse("Invalid or unsupported jutsu loadout text");
  const jutsuIds = parsed.data.jutsuIds;
  const [loadouts, data, userjutsus, content] = await Promise.all([
    fetchJutsuLoadouts(client, userId),
    fetchUpdatedUser({ client, userId }),
    fetchUserJutsus(client, userId),
    listJutsuForPrepareJutsuLoadoutImport(client, jutsuIds),
  ]);
  const { user } = data;
  if (!user) return errorResponse("User not found");
  const destination = resolveSelectableLoadout(
    loadouts,
    input.loadoutId,
    fedJutsuLoadouts(user),
  );
  if (!destination.ok) return errorResponse(destination.message);
  const loadout = destination.loadout;
  const preview = computeJutsuLoadoutPreview({
    jutsuIds,
    userjutsus,
    user,
    content,
    masteries: effectiveMasteries(user),
  });
  // The digest binds confirmation to the ordered result and destination snapshot.
  // Submission always recomputes eligibility; the token confers no ownership.
  const token = createHash("sha256")
    .update(
      JSON.stringify({
        loadout,
        active: user.jutsuLoadout,
        allowance: fedJutsuLoadouts(user),
        preview,
      }),
    )
    .digest("hex");
  return {
    success: true as const,
    preview: { ...preview, token },
    loadout,
    user,
    userjutsus,
  };
};

/**
 * Whether the reskin's owner has it active on their copy of the reskinned jutsu
 * @param reskin - The reskin, with its owner and base jutsu
 * @param usages - The user jutsu rows that reference the reskin
 */
const isAttachedToOwner = (
  reskin: { userId: string; jutsuId: string },
  usages: { userId: string; jutsuId: string }[],
) => {
  return usages.some(
    (usage) => usage.userId === reskin.userId && usage.jutsuId === reskin.jutsuId,
  );
};

/**
 * Fetch all jutsus for a user
 * @param client - The database client
 * @param userId - The ID of the user to fetch jutsus for
 * @param input - The input object
 * @returns
 */
export const fetchUserJutsus = async (
  client: DrizzleClient,
  userId: string,
  input?: UserJutsuFilteringSchema,
  options: { applyReskins?: boolean } = {},
) => {
  // Self-join alias to get the parent jutsu's parentJutsuId (grandparent)

  // Use the same ordering as fetchBloodlineJutsuReskins so only the resolved
  // variant's name matches when a group contains multiple variants of a parent.
  const linkedReskinName = selectUserDataForFetchUserJutsus(client, userId);
  const filters = jutsuDatabaseFilter(input, true, sql`(${linkedReskinName})`);
  // Equipped slots stay visible; only the unequipped categories follow search filters.
  const inventoryFilter =
    input?.includeEquipped && filters.length > 0
      ? or(eq(userJutsu.equipped, true), and(...filters))
      : and(...filters);
  // Grab all userJutsus with Jutsu data and reskin data
  const [linkedReskins, userjutsus] = await Promise.all([
    fetchBloodlineJutsuReskins(client, [userId]),
    selectUserJutsuForFetchUserJutsus(client, userId, inventoryFilter),
  ]);
  // First map to query-format
  const unskinnedUserJutsus = userjutsus.map((result) => ({
    ...result.UserJutsu,
    jutsu: {
      ...result.Jutsu,
      bloodline: result.Bloodline,
    },
    activeReskin: result.JutsuReskin,
    linkedReskin:
      linkedReskins.find(
        (row) =>
          row.userId === userId && row.jutsu.reskinParentJutsuId === result.Jutsu.id,
      )?.jutsu ?? null,
    // Grandparent ID — allows frontend to walk the full ancestor chain
    parentJutsuParentId: result.parentJutsu?.parentJutsuId ?? null,
    ancestorIds: [
      result.Jutsu.parentJutsuId,
      result.parentJutsu?.parentJutsuId ?? null,
    ].filter((id): id is string => !!id),
  }));
  // Combat stores shared base jutsu data and applies cosmetics through each owner's reference.
  return options.applyReskins === false
    ? unskinnedUserJutsus
    : unskinnedUserJutsus.map((userjutsu) => getReskinnedUserJutsu(userjutsu));
};

/**
 * Build the DB filtering array, including new EXCLUSIONS.
 */
export const jutsuDatabaseFilter = (
  input?: JutsuFilteringSchema,
  includeHidden = false,
  additionalName?: SQL,
) => {
  return [
    // -----------------------------
    // Existing "include" conditions
    // -----------------------------
    ...(input?.name
      ? [
          or(
            like(sql`LOWER(${jutsu.name})`, `%${input.name.toLowerCase()}%`),
            additionalName
              ? like(sql`LOWER(${additionalName})`, `%${input.name.toLowerCase()}%`)
              : undefined,
          ),
        ]
      : []),
    ...(input?.bloodline ? [eq(jutsu.bloodlineId, input.bloodline)] : []),
    ...(input?.jutsuType ? [inArray(jutsu.jutsuType, input.jutsuType)] : []),
    ...(input?.requiredLevel ? [gte(jutsu.requiredLevel, input.requiredLevel)] : []),
    ...(input?.rank?.length ? [inArray(jutsu.requiredRank, input.rank)] : []),
    ...(input?.rarity ? [eq(jutsu.jutsuRank, input.rarity)] : []),
    ...(input?.villageId ? [eq(jutsu.villageId, input.villageId)] : []),

    ...(input?.appear
      ? [
          sql`JSON_SEARCH(${jutsu.effects}, 'one', ${input.appear}, NULL, '$[*].appearAnimation') IS NOT NULL`,
        ]
      : []),
    ...(input?.appearSfx
      ? [
          sql`JSON_SEARCH(${jutsu.effects}, 'one', ${input.appearSfx}, NULL, '$[*].appearSfx') IS NOT NULL`,
        ]
      : []),
    ...(input?.static
      ? [
          sql`JSON_SEARCH(${jutsu.effects}, 'one', ${input.static}, NULL, '$[*].staticAnimation') IS NOT NULL`,
        ]
      : []),
    ...(input?.disappear
      ? [
          sql`JSON_SEARCH(${jutsu.effects}, 'one', ${input.disappear}, NULL, '$[*].disappearAnimation') IS NOT NULL`,
        ]
      : []),
    ...(input?.disappearSfx
      ? [
          sql`JSON_SEARCH(${jutsu.effects}, 'one', ${input.disappearSfx}, NULL, '$[*].disappearSfx') IS NOT NULL`,
        ]
      : []),
    ...(input?.classification
      ? [eq(jutsu.statClassification, input.classification)]
      : []),

    // "Include" elements, stats, effect
    ...(input?.element?.length
      ? [
          and(
            ...input.element.map(
              (e) =>
                sql`((${jutsu.elementClassification} IS NOT NULL AND ${jutsu.elementClassification} <> 'None' AND ${jutsu.elementClassification} = ${e}) OR JSON_SEARCH(${jutsu.effects}, 'one', ${e}, NULL, '$[*].elements[*]') IS NOT NULL)`,
            ),
          ),
        ]
      : []),
    ...(input?.stat?.length
      ? [
          and(
            ...input.stat.map(
              (s) =>
                sql`JSON_SEARCH(${jutsu.effects}, 'one', ${s}, NULL, '$[*].statTypes[*]') IS NOT NULL`,
            ),
          ),
        ]
      : []),
    ...(input?.effect?.length
      ? [
          or(
            ...input.effect.map(
              (e) =>
                sql`JSON_SEARCH(${jutsu.effects}, 'one', ${e}, NULL, '$[*].type') IS NOT NULL`,
            ),
          ),
        ]
      : []),

    ...(input?.method ? [eq(jutsu.method, input.method)] : []),
    ...(input?.target ? [eq(jutsu.target, input.target)] : []),

    // Battle usage type filter
    ...(input?.battleUsageType
      ? [eq(jutsu.battleUsageType, input.battleUsageType)]
      : []),

    // Action cost filter
    ...(input?.actionCostPerc !== undefined
      ? [eq(jutsu.actionCostPerc, input.actionCostPerc)]
      : []),

    ...(includeHidden
      ? []
      : input?.hidden !== undefined
        ? [eq(jutsu.hidden, input.hidden)]
        : [eq(jutsu.hidden, false)]),

    // ---------------------------
    // Exclude: Single-value cols
    // ---------------------------
    ...(input?.excludedJutsuTypes?.length
      ? input.excludedJutsuTypes.map((excludedType) =>
          ne(
            jutsu.jutsuType,
            excludedType as
              | "NORMAL"
              | "EVENT"
              | "CLAN"
              | "SPECIAL"
              | "BLOODLINE"
              | "FORBIDDEN"
              | "LOYALTY"
              | "AI",
          ),
        )
      : []),
    ...(input?.excludedClassifications?.length
      ? input.excludedClassifications.map((c) =>
          ne(
            jutsu.statClassification,
            c as "None" | "Ninjutsu" | "Genjutsu" | "Taijutsu" | "Bukijutsu",
          ),
        )
      : []),
    ...(input?.excludedRarities?.length
      ? input.excludedRarities.map((r) =>
          ne(jutsu.jutsuRank, r as "D" | "C" | "B" | "A" | "S" | "H"),
        )
      : []),
    ...(input?.excludedRanks?.length
      ? input.excludedRanks.map((r) =>
          ne(
            jutsu.requiredRank,
            r as
              | "STUDENT"
              | "GENIN"
              | "CHUNIN"
              | "JONIN"
              | "ELITE JONIN"
              | "ELDER"
              | "NONE",
          ),
        )
      : []),
    ...(input?.excludedMethods?.length
      ? input.excludedMethods.map((m) =>
          ne(
            jutsu.method,
            m as
              | "ALL"
              | "SINGLE"
              | "AOE_CIRCLE_SPAWN"
              | "AOE_LINE_SHOOT"
              | "AOE_WALL_SHOOT"
              | "AOE_CIRCLE_SHOOT"
              | "AOE_SPIRAL_SHOOT",
          ),
        )
      : []),
    ...(input?.excludedTargets?.length
      ? input.excludedTargets.map((t) =>
          ne(
            jutsu.target,
            t as
              | "SELF"
              | "OTHER_USER"
              | "OPPONENT"
              | "ALLY"
              | "CHARACTER"
              | "GROUND"
              | "EMPTY_GROUND",
          ),
        )
      : []),

    // ---------------------------
    // Exclude animations in JSON
    // ---------------------------
    ...(input?.excludedAppear?.length
      ? input.excludedAppear.map(
          (anim) =>
            sql`JSON_SEARCH(${jutsu.effects}, 'one', ${anim}, NULL, '$[*].appearAnimation') IS NULL`,
        )
      : []),
    ...(input?.excludedAppearSfx?.length
      ? input.excludedAppearSfx.map(
          (sfx) =>
            sql`JSON_SEARCH(${jutsu.effects}, 'one', ${sfx}, NULL, '$[*].appearSfx') IS NULL`,
        )
      : []),
    ...(input?.excludedDisappear?.length
      ? input.excludedDisappear.map(
          (anim) =>
            sql`JSON_SEARCH(${jutsu.effects}, 'one', ${anim}, NULL, '$[*].disappearAnimation') IS NULL`,
        )
      : []),
    ...(input?.excludedDisappearSfx?.length
      ? input.excludedDisappearSfx.map(
          (sfx) =>
            sql`JSON_SEARCH(${jutsu.effects}, 'one', ${sfx}, NULL, '$[*].disappearSfx') IS NULL`,
        )
      : []),
    ...(input?.excludedStatic?.length
      ? input.excludedStatic.map(
          (anim) =>
            sql`JSON_SEARCH(${jutsu.effects}, 'one', ${anim}, NULL, '$[*].staticAnimation') IS NULL`,
        )
      : []),

    // --------------------------
    // Exclude elements/effects/stats in JSON
    // --------------------------
    ...(input?.excludedElements?.length
      ? input.excludedElements.map(
          (excludedEl) =>
            sql`((${jutsu.elementClassification} IS NULL OR ${jutsu.elementClassification} = 'None' OR ${jutsu.elementClassification} <> ${excludedEl}) AND JSON_SEARCH(${jutsu.effects}, 'one', ${excludedEl}, NULL, '$[*].elements[*]') IS NULL)`,
        )
      : []),
    ...(input?.excludedEffects?.length
      ? input.excludedEffects.map(
          (excludedEf) =>
            sql`JSON_SEARCH(${jutsu.effects}, 'one', ${excludedEf}, NULL, '$[*].type') IS NULL`,
        )
      : []),
    ...(input?.excludedStats?.length
      ? input.excludedStats.map(
          (excludedSt) =>
            sql`JSON_SEARCH(${jutsu.effects}, 'one', ${excludedSt}, NULL, '$[*].statTypes[*]') IS NULL`,
        )
      : []),
  ];
};

/**
 * Utility: Post-filter jutsu-like rows to ensure includes are satisfied within the same effect
 */
export const filterByEffectConstraints = <
  T extends Pick<Jutsu, "effects" | "elementClassification">,
>(
  rows: T[],
  input: JutsuFilteringSchema,
) => {
  return rows.filter((row) => {
    const classification =
      row.elementClassification && row.elementClassification !== "None"
        ? row.elementClassification
        : undefined;
    // Classification-only matches also include jutsu without effect tags.
    if (
      !input.stat?.length &&
      !input.effect?.length &&
      !input.appear &&
      !input.static &&
      !input.disappear &&
      input.element?.length &&
      input.element.every((element) => element === classification)
    ) {
      return true;
    }
    if (
      input.stat ||
      input.effect ||
      input.element ||
      input.appear ||
      input.static ||
      input.disappear
    ) {
      return row.effects.some((e) => {
        const asString = JSON.stringify(e);

        const effectStats = [
          ...("statTypes" in e && e.statTypes ? e.statTypes : []),
          ...("generalTypes" in e && e.generalTypes ? e.generalTypes : []),
        ];
        const effectElements = [
          ...(classification ? [classification] : []),
          ...("elements" in e && e.elements ? e.elements : []),
        ] as string[];

        return (
          (!input.stat || input.stat.every((x) => effectStats.includes(x))) &&
          (!input.effect || input.effect.some((x) => x === e.type)) &&
          (!input.element || input.element.every((x) => effectElements.includes(x))) &&
          (!input.appear || asString.includes(input.appear)) &&
          (!input.static || asString.includes(input.static)) &&
          (!input.disappear || asString.includes(input.disappear))
        );
      });
    }
    return true;
  });
};

/**
 * @param client - The database client
 * @param loadoutId - The ID of the loadout to select
 * @param loadouts - The loadouts to select from
 * @param user - The user data
 * @returns A promise that resolves to the result of the select
 */
export const selectJutsuLoadout = async (
  client: DrizzleClient,
  loadoutId: string,
  loadouts: JutsuLoadout[],
  userjutsus: UserJutsuWithRelations[],
  user: Pick<UserData, "userId" | "federalStatus" | "staffAccount">,
  // Optional validator: when supplied, saved jutsuIds are filtered to those still
  // equippable. The jutsu-management path passes full canUseJutsu validation;
  // combat checks bloodline items and effective masteries against its battle state.
  validateLoadout?: (jutsuIds: string[]) => ComputedJutsuLoadout,
) => {
  // Guard: only loadouts within the user's current allowance are selectable, so
  // a downgraded user can't reach an out-of-range loadout by guessing its
  // deterministic id (loadouts are ordered the same way getLoadouts slices).
  const selectable = resolveSelectableLoadout(
    loadouts,
    loadoutId,
    fedJutsuLoadouts(user),
  );
  if (!selectable.ok) return errorResponse(selectable.message);
  const loadout = selectable.loadout;

  // Unlike selectItemLoadout (which re-checks availability inside the atomic SQL
  // CASE), jutsu eligibility derives entirely from the just-fetched snapshot
  // (ownership + canUseJutsu + caps), and no external subsystem mutates it
  // mid-request, so JS-side validation here needs no write-time re-check.
  const { equipIds, invalidJutsus } = validateLoadout
    ? validateLoadout(loadout.jutsuIds)
    : { equipIds: loadout.jutsuIds, invalidJutsus: [] as string[] };

  // Update the active pointer and every equipped row in one multi-table UPDATE.
  // Keeping these writes in a single statement closes the window where
  // toggleEquip could observe the old pointer after the new loadout's equipped
  // rows were already applied (or vice versa).
  const equippedAssignment =
    equipIds.length > 0
      ? sql`CASE WHEN ${inArray(userJutsu.jutsuId, equipIds)} THEN 1 ELSE 0 END`
      : sql`0`;
  await executeRowsForSelectJutsuLoadout(client, loadout, equippedAssignment, user);

  const message =
    invalidJutsus.length > 0
      ? `Loadout selected. Warnings: ${invalidJutsus.join(", ")}`
      : `Loadout selected`;

  return {
    success: true,
    message,
    jutsus: userjutsus.filter((u) => equipIds.includes(u.jutsuId)),
  };
};

/**
 * Unequip a row if it falls outside the first-N kept slots for any exceeded cap.
 * Used after inserting already-equipped (startTraining) and after a successful
 * under-cap equip CAS (toggleEquip) to close concurrent-equip races without
 * making both racers lose.
 *
 * Returns true when the row remains equipped (no rollback).
 */
export const rollbackEquipIfOverCap = async (args: {
  client: DrizzleClient;
  userId: string;
  userJutsuId: string;
  maxEquip: number;
  flags: JutsuCapFlags;
}): Promise<boolean> => {
  const { client, userId, userJutsuId, maxEquip, flags } = args;
  const rollback = await updateUserJutsuForRollbackEquipIfOverCap(
    client,
    userJutsuId,
    userId,

    maxEquip,
    flags,
  );
  return rollback.rowsAffected === 0;
};

/**
 * Equip a single userJutsu row under live equip-cap guards.
 *
 * Pre-check counts in the UPDATE WHERE reject the common already-at-cap case.
 * Those counts alone are not race-safe across distinct rows: two concurrent
 * equips can each lock a different PK, both observe "under cap", and both
 * persist. After a successful equip we therefore re-rank and roll this row
 * back only when it sits outside the first-N kept slots for an exceeded cap
 * (so one concurrent racer keeps the slot).
 */
export type TryEquipUserJutsuResult = "equipped" | "already-equipped" | "cap-reached";

export const tryEquipUserJutsuAtomically = async (args: {
  client: DrizzleClient;
  userId: string;
  userJutsuId: string;
  maxEquip: number;
  flags: JutsuCapFlags;
}): Promise<TryEquipUserJutsuResult> => {
  const { client, userId, userJutsuId, maxEquip, flags } = args;

  const result = await updateUserJutsuForTryEquipUserJutsuAtomically(
    client,
    userJutsuId,
    userId,

    maxEquip,
    flags,
  );
  if (result.rowsAffected !== 1) {
    // Distinguish double-click / concurrent equip from a genuine cap rejection.
    const [row] = await selectUserJutsuEquipped(client, userJutsuId, userId);
    return row?.equipped ? "already-equipped" : "cap-reached";
  }

  const kept = await rollbackEquipIfOverCap({
    client,
    userId,
    userJutsuId,
    maxEquip,
    flags,
  });
  return kept ? "equipped" : "cap-reached";
};

/**
 * Append a jutsuId to a loadout's JSON array without rewriting the whole array, so
 * concurrent equips cannot drop each other's IDs. Idempotent via NOT JSON_CONTAINS.
 * Only mutates the loadout if it is still the user's active pointer — otherwise a
 * concurrent selectJutsuLoadout would desynchronize the old loadout from equipped
 * rows. Returns true when the *active* loadout contains jutsuId.
 */
const appendJutsuIdToLoadoutAtomically = async (args: {
  client: DrizzleClient;
  loadoutId: string;
  userId: string;
  jutsuId: string;
}): Promise<boolean> => {
  const { client, loadoutId, userId, jutsuId } = args;
  try {
    const result = await updateJutsuLoadoutForAppendJutsuIdToLoadoutAtomically(
      client,
      jutsuId,
      loadoutId,
      userId,
    );
    if (result.rowsAffected === 1) return true;
    // Already present, pointer moved, or missing loadout — check the active one.
    const ids = await fetchActiveLoadoutJutsuIds(client, userId);
    return !!ids?.includes(jutsuId);
  } catch {
    return false;
  }
};

/**
 * Escape `%`, `_`, and `\` so MySQL JSON_SEARCH treats the needle as a literal
 * (JSON_SEARCH uses LIKE matching). nanoid IDs commonly contain `_`.
 */
const escapeJsonSearchPattern = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

/**
 * Remove a jutsuId from a loadout's JSON array without rewriting the whole array, so
 * concurrent unequips cannot restore each other's IDs from stale snapshots.
 * Only mutates the loadout if it is still the user's active pointer.
 * Returns true when the *active* loadout no longer contains jutsuId.
 */
const removeJutsuIdFromLoadoutAtomically = async (args: {
  client: DrizzleClient;
  loadoutId: string;
  userId: string;
  jutsuId: string;
}): Promise<boolean> => {
  const { client, loadoutId, userId, jutsuId } = args;
  const searchPattern = escapeJsonSearchPattern(jutsuId);
  try {
    const result = await updateJutsuLoadoutForRemoveJutsuIdFromLoadoutAtomically(
      client,
      searchPattern,
      loadoutId,
      userId,

      jutsuId,
    );
    if (result.rowsAffected === 1) return true;
    // Pointer moved or already absent — only the active loadout must lack this id.
    const ids = await fetchActiveLoadoutJutsuIds(client, userId);
    return !ids?.includes(jutsuId);
  } catch {
    return false;
  }
};

/**
 * Commit the edited jutsu, inherited child mechanics and their audit logs together.
 * A single guarded update cannot preserve this multi-row invariant. Creation,
 * linking and deletion share the source row lock; sorted jutsu locks precede group
 * locks. Re-read under those locks before validating, then batch the child write.
 * Callers invalidate content proposals only after this transaction succeeds.
 */
const saveJutsuFamily = async (
  client: DrizzleClient,
  entry: Jutsu,
  data: ZodJutsuType,
  userId: string,
) =>
  retryOnDeadlock(() =>
    client.transaction(async (tx) => {
      const lockIds = [
        ...new Set(
          [
            entry.id,
            entry.reskinParentJutsuId,
            data.reskinParentJutsuId,
            data.parentJutsuId,
          ].filter((id): id is string => !!id),
        ),
      ].sort();
      const locked = await selectJutsuForSaveJutsuFamily(tx, lockIds);
      const current = locked.find((row) => row.id === entry.id);
      if (!current || current.updatedAt.getTime() !== entry.updatedAt.getTime())
        return errorResponse("Jutsu changed; refresh before saving");
      // Evolution edits and reskin linking share the candidate parent's lock.
      const evolutionParent = locked.find((row) => row.id === data.parentJutsuId);
      if (evolutionParent?.reskinParentJutsuId)
        return errorResponse("Reskins cannot be evolution parents");
      const related = await selectJutsuForSaveJutsuFamily2(tx, entry, data);
      const children = related.filter((row) => row.reskinParentJutsuId === entry.id);
      if (
        data.reskinParentJutsuId &&
        related.some((row) => row.parentJutsuId === entry.id)
      )
        return errorResponse("Reskins cannot have evolution links or reskin children");
      if (data.reskinParentJutsuId && children.length)
        return errorResponse("Unlink child reskins before linking this jutsu");
      const parent = locked.find((row) => row.id === data.reskinParentJutsuId);
      if (
        data.reskinParentJutsuId &&
        (!parent || parent.reskinParentJutsuId || parent.jutsuRank === "H")
      )
        return errorResponse("Reskin parent changed; refresh before saving");
      if (parent) {
        // Use the current source mechanics, never the child editor's snapshot.
        data = {
          ...data,
          ...getJutsuReskinMechanics(parent),
          jutsuRank: "H",
          effects: inheritJutsuReskinEffects(parent.effects, data.effects),
        };
        if (data.bloodlineReskinId) {
          const [group] = await selectBloodlineReskinForUpdate(
            tx,
            data.bloodlineReskinId,
          );
          if (!group || group.bloodlineId !== parent.bloodlineId)
            return errorResponse("Bloodline reskin no longer matches the parent");
        }
      }
      if (
        children.some(
          (child) => child.bloodlineReskinId && child.bloodlineId !== data.bloodlineId,
        )
      )
        return errorResponse(
          "Unlink bloodline reskins before changing the parent's bloodline",
        );
      if (children.length && data.jutsuRank === "H")
        return errorResponse("A reskin parent cannot have H rank");
      const mechanics = getJutsuReskinMechanics(data);
      const updates = children.map((child) => ({
        original: child,
        updated: {
          ...child,
          ...mechanics,
          effects: inheritJutsuReskinEffects(data.effects, child.effects),
        },
      }));
      for (const variant of [data, ...updates.map(({ updated }) => updated)]) {
        const valid = JutsuValidator.safeParse(variant);
        if (!valid.success)
          return errorResponse(
            `Invalid reskin mechanics or cosmetics for ${variant.name}: ${valid.error.issues[0]?.message}`,
          );
        const hasAnimation = variant.effects.some(
          (effect) =>
            "appearAnimation" in effect &&
            effect.appearAnimation &&
            "appearSfx" in effect &&
            effect.appearSfx,
        );
        if (!variant.hidden && !hasAnimation)
          return errorResponse(
            `Visible jutsu ${variant.name} needs an effect with both appear animation and sound`,
          );
      }
      const diff = calculateContentDiff(current, { ...current, ...data });
      const latestUpdatedAt = children.reduce(
        (latest, child) =>
          child.updatedAt.getTime() > latest.getTime() ? child.updatedAt : latest,
        current.updatedAt,
      );
      const updatedAt = getNextUserSnapshotAt(latestUpdatedAt);
      await updateJutsuForSaveJutsuFamily(tx, data, updatedAt, entry);
      if (children.length) {
        // One batched child write preserves each effect's cosmetic fields.
        const cases = updates.map(
          ({ updated }) =>
            sql`WHEN ${updated.id} THEN ${JSON.stringify(updated.effects)}`,
        );
        await updateJutsuForSaveJutsuFamily2(tx, mechanics, cases, updatedAt, children);
      }
      await insertActionLogForSaveJutsuFamily(tx, userId, diff, entry, updates, data);
      return {
        success: true as const,
        diff,
        ids: [entry.id, ...children.map((child) => child.id)],
      };
    }),
  );
