import { TRPCError } from "@trpc/server";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  COST_RESKIN_JUTSU,
  IMG_AVATAR_DEFAULT,
  JUTSU_LEVEL_CAP,
  JUTSU_TRAIN_LEVEL_CAP,
  JUTSU_TRANSFER_COST,
  JUTSU_TRANSFER_DAYS,
  JUTSU_TRANSFER_MAX_LEVEL,
  JUTSU_TRANSFER_MINIMUM_LEVEL,
  RESKIN_LIMIT,
  TUTORIAL_JUTSU_ID,
} from "@/drizzle/constants";
import type { JutsuLoadout, UserData, UserJutsuWithRelations } from "@/drizzle/schema";
import {
  actionLog,
  bloodline,
  item,
  jutsu,
  jutsuLoadout,
  jutsuReskin,
  quest,
  skillTree,
  userData,
  userJutsu,
} from "@/drizzle/schema";
import type { ComputedJutsuLoadout, JutsuCapFlags, JutsuEquipCap } from "@/libs/jutsu";
import {
  canEquipUnderCaps,
  computeJutsuLoadoutAssignments,
  countEquippedByCap,
  findExceededJutsuEquipCap,
  getFreeTransfers,
  getJutsuCapFlags,
  getReskinnedUserJutsu,
  hasAnyJutsuEquipCap,
  JUTSU_EQUIP_CAPS,
} from "@/libs/jutsu";
import {
  buildMissingLoadouts,
  decideRename,
  resolveSelectableLoadout,
} from "@/libs/loadout";
import { validateUserUpdateReason } from "@/libs/moderator";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { callDiscordContent } from "@/libs/socials";
import {
  calcJutsuEquipLimit,
  calcJutsuTrainCost,
  calcJutsuTrainTime,
  canEvolveJutsu,
  canTrainJutsu,
  canUseJutsu,
  checkJutsuBloodlineItem,
  hasRequiredLevel,
  hasRequiredRank,
  isJutsuTrainToLearnRestricted,
} from "@/libs/train";
import { fetchStudents } from "@/routers/sensei";
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
  applyLoadoutRename,
  backfillLoadouts,
  fetchLoadoutUser,
} from "@/server/utils/loadout";
import { calculateContentDiff } from "@/utils/diff";
import { fedJutsuLoadouts } from "@/utils/paypal";
import {
  canChangeContent,
  canEditJutsus,
  canModerateReskin,
  canOnlyEditSelf,
  canReskinFreely,
  canTransferJutsu,
} from "@/utils/permissions";
import { DAY_S, secondsFromDate } from "@/utils/time";
import type { ZodAllTags } from "@/validators/combat";
import { JutsuValidator } from "@/validators/combat";
import type { JutsuFilteringSchema } from "@/validators/jutsu";
import {
  evolveJutsuSchema,
  getEvolutionsSchema,
  jutsuFilteringSchema,
  jutsuReskinCreateSchema,
  jutsuReskinUpdateSchema,
} from "@/validators/jutsu";
import { renameLoadoutSchema } from "@/validators/loadout";
import { QuestTracker } from "@/validators/objectives";
import { fetchUpdatedUser, fetchUser } from "./profile";

export const jutsuRouter = createTRPCRouter({
  getRecentTransfers: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Get user's recent jutsu level transfers" },
    })
    .query(async ({ ctx }) => {
      return await ctx.drizzle.query.actionLog.findMany({
        where: and(
          eq(actionLog.userId, ctx.userId),
          eq(actionLog.relatedMsg, "JutsuLevelTransfer"),
          gte(
            actionLog.createdAt,
            secondsFromDate(-JUTSU_TRANSFER_DAYS * DAY_S, new Date()),
          ),
        ),
      });
    }),
  transferLevel: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Transfer levels between jutsus" } })
    .input(
      z.object({
        fromJutsuId: z.string(),
        toJutsuId: z.string(),
        transferLevels: z.number().min(1, "Must transfer at least 1 level"),
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const transfer = input.transferLevels;
      const [user, userJutsus, recentTransfers] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserJutsus(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.actionLog.findMany({
          where: and(
            eq(actionLog.userId, ctx.userId),
            eq(actionLog.relatedMsg, "JutsuLevelTransfer"),
            gte(
              actionLog.createdAt,
              secondsFromDate(-JUTSU_TRANSFER_DAYS * DAY_S, new Date()),
            ),
          ),
        }),
      ]);
      const fromUserJutsu = userJutsus.find((j) => j.jutsuId === input.fromJutsuId);
      const fromJutsu = fromUserJutsu?.jutsu;
      const toUserJutsu = userJutsus.find((j) => j.jutsuId === input.toJutsuId);
      const toJutsu = toUserJutsu?.jutsu;
      const prevFreeTransfers = recentTransfers.filter((t) =>
        (t.changes as string[]).some((c) => c.includes("Used free transfer.")),
      );
      // Guard
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
      if (fromUserJutsu.level > JUTSU_TRANSFER_MAX_LEVEL) {
        return errorResponse(
          `Cannot transfer levels above ${JUTSU_TRANSFER_MAX_LEVEL}`,
        );
      }

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

      // If needs reputation, check and deduct
      if (needsReputation) {
        if (user.reputationPoints < transferCost) {
          return errorResponse("Not enough reputation points");
        }
        const reputationUpdate = await ctx.drizzle
          .update(userData)
          .set({
            reputationPoints: sql`${userData.reputationPoints} - ${transferCost}`,
          })
          .where(
            and(
              eq(userData.userId, ctx.userId),
              gte(userData.reputationPoints, transferCost),
            ),
          );
        if (reputationUpdate.rowsAffected !== 1) {
          return errorResponse("Not enough reputation points");
        }
      }

      // Perform the transfer
      await Promise.all([
        ctx.drizzle
          .update(userJutsu)
          .set({ level: toUserJutsu.level + transfer })
          .where(eq(userJutsu.id, toUserJutsu.id)),
        ctx.drizzle
          .update(userJutsu)
          .set({ level: fromUserJutsu.level - transfer })
          .where(eq(userJutsu.id, fromUserJutsu.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "userjutsu",
          changes: [
            `Transferred ${transfer} level(s) from ${fromJutsu.name} (new level: ${fromUserJutsu.level - transfer}) to ${toJutsu.name} (new level: ${toUserJutsu.level + transfer}). ${!needsReputation ? ` Used free transfer.` : ""}`,
          ],
          relatedId: ctx.userId,
          relatedMsg: "JutsuLevelTransfer",
          relatedImage: user.avatarLight,
        }),
      ]);

      return {
        success: true,
        message: needsReputation
          ? `Level transferred for ${transferCost} reputation points`
          : "Level transferred for free",
      };
    }),

  getAllNames: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get all jutsu names and images" } })
    .query(async ({ ctx }) => {
      return await ctx.drizzle.query.jutsu.findMany({
        columns: { id: true, name: true, image: true, injectableInBattle: true },
        orderBy: (table, { asc }) => [asc(table.name)],
      });
    }),

  get: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get a specific jutsu by ID" } })
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchJutsu(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Jutsu not found");
      }
      return result as Omit<typeof result, "effects"> & { effects: ZodAllTags[] };
    }),

  getAll: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get paginated jutsus with filters" } })
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

      const results = await ctx.drizzle.query.jutsu.findMany({
        where: and(
          ...baseFilters,
          ...(input.hideAi ? [ne(jutsu.jutsuType, "AI")] : []),
        ),
        orderBy: (table) => desc(table.updatedAt),
        offset: skip,
        with: {
          bloodline: {
            columns: {
              name: true,
            },
          },
        },
        limit: input.limit,
      });

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
    .meta({ mcp: { enabled: true, description: "Get user's jutsu loadouts" } })
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
        { jutsuIds: [] as JutsuLoadout["jutsuIds"] },
        new Date(),
      );
      return backfillLoadouts<JutsuLoadout>({
        loadouts,
        missing,
        maxLoadouts,
        currentPointer: user?.jutsuLoadout ?? null,
        insertMissing: (rows) =>
          ctx.drizzle
            .insert(jutsuLoadout)
            .values(rows)
            .onDuplicateKeyUpdate({ set: { id: sql`id` } }),
        writeDefaultPointer: (id) =>
          // Compare-and-swap: only set the default when no pointer exists yet, so
          // a concurrent select that set it first is not overwritten.
          ctx.drizzle
            .update(userData)
            .set({ jutsuLoadout: id })
            .where(and(eq(userData.userId, ctx.userId), isNull(userData.jutsuLoadout))),
      });
    }),

  selectJutsuLoadout: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Select a jutsu loadout" } })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
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
      return await selectJutsuLoadout(
        ctx.drizzle,
        id,
        loadouts,
        userjutsus,
        user,
        (jutsuIds) => computeJutsuLoadoutAssignments({ jutsuIds, userjutsus, user }),
      );
    }),

  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (user.isBanned)
      return errorResponse("You are banned and cannot perform this action");
    if (canChangeContent(user.role)) {
      const id = nanoid();
      await ctx.drizzle.insert(jutsu).values({
        id,
        name: `New Jutsu - ${id}`,
        description: "New jutsu description",
        battleDescription: "%user uses %jutsu on %target",
        effects: [],
        range: 1,
        requiredRank: "STUDENT",
        requiredLevel: 1,
        target: "OTHER_USER",
        jutsuType: "AI",
        statClassification: "Highest",
        image: IMG_AVATAR_DEFAULT,
      });
      return { success: true, message: id };
    } else {
      return { success: false, message: `Not allowed to create jutsu` };
    }
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
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
        relations.childEvolutions.length;
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
        ].join(", ");
        return errorResponse(
          `Justu is being used by: ${message}. So you cannot delete it.`,
        );
      }
      // Mutate
      await Promise.all([
        ctx.drizzle.delete(jutsu).where(eq(jutsu.id, input.id)),
        ctx.drizzle.delete(userJutsu).where(eq(userJutsu.jutsuId, input.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "jutsu",
          changes: [`Deleted: ${entry.name}`],
          relatedId: entry.id,
          relatedMsg: `Delete: ${entry.name}`,
          relatedImage: entry.image,
        }),
      ]);
      return { success: true, message: `Jutsu deleted` };
    }),

  forget: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Forget a learned jutsu" } })
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const userjutsus = await fetchUserJutsus(ctx.drizzle, ctx.userId);
      const userjutsuObj = userjutsus.find((j) => j.id === input.id);
      if (userjutsuObj) {
        const res1 = await ctx.drizzle
          .delete(userJutsu)
          .where(eq(userJutsu.id, input.id));
        if (res1.rowsAffected === 1) {
          return { success: true, message: `Jutsu forgotten, 0 ryo restored` };
        }
      }
      return { success: false, message: `Could not find jutsu to delete` };
    }),

  getEvolutions: publicProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Get all evolution jutsus for a parent jutsu",
      },
    })
    .input(getEvolutionsSchema)
    .query(async ({ ctx, input }) => {
      const [user, evolutions] = await Promise.all([
        ctx.userId
          ? ctx.drizzle.query.userData.findFirst({
              where: eq(userData.userId, ctx.userId),
              columns: { role: true },
            })
          : Promise.resolve(null),
        ctx.drizzle.query.jutsu.findMany({
          where: eq(jutsu.parentJutsuId, input.jutsuId),
          orderBy: (table, { asc }) => [asc(table.requiredLevel)],
        }),
      ]);
      const canViewHidden = !!user && canChangeContent(user.role);
      return evolutions.filter((evolution) => !evolution.hidden || canViewHidden);
    }),

  evolveJutsu: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Evolve a jutsu into its evolution" } })
    .input(evolveJutsuSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [{ user }, userJutsus, evolutionJutsu, allLoadouts, conflictingReskin] =
        await Promise.all([
          fetchUpdatedUser({ client: ctx.drizzle, userId: ctx.userId }),
          fetchUserJutsus(ctx.drizzle, ctx.userId),
          fetchJutsu(ctx.drizzle, input.evolutionJutsuId),
          fetchJutsuLoadouts(ctx.drizzle, ctx.userId),
          ctx.drizzle.query.jutsuReskin.findFirst({
            where: and(
              eq(jutsuReskin.userId, ctx.userId),
              eq(jutsuReskin.jutsuId, input.evolutionJutsuId),
            ),
            columns: { id: true },
          }),
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
      if (userJutsuObj.finishTraining && userJutsuObj.finishTraining > new Date())
        return errorResponse(
          "This jutsu is currently being trained. Wait for training to complete before evolving.",
        );
      if (userJutsuObj.level < JUTSU_TRAIN_LEVEL_CAP)
        return errorResponse(
          `Jutsu must be at max level (${JUTSU_TRAIN_LEVEL_CAP}) to evolve`,
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
      if (!canUseJutsu(evolutionJutsu, user, true))
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
        },
      ]);
      const questDataForDb = filterQuestTrackersForDbPersist(trackers, user);
      const evolutionCapFlags = getJutsuCapFlags(evolutionJutsu);
      const isRestrictedEquipType = hasAnyJutsuEquipCap(evolutionCapFlags);
      // Single compare-and-swap update that applies every userJutsu-row change at once:
      // - jutsuId/level/experience/finishTraining — the evolution itself
      // - equipped — force off for restricted types to avoid cap overflows
      // - reskinId — on reskin-collision, re-point to the existing historical row so
      //   the user's evolved jutsu activates the slot they already own
      // The CAS WHERE guards against double-evolve on retry/double-submit.
      const evolveResult = await ctx.drizzle
        .update(userJutsu)
        .set({
          jutsuId: input.evolutionJutsuId,
          level: 1,
          experience: 0,
          finishTraining: null,
          updatedAt: new Date(),
          ...(isRestrictedEquipType ? { equipped: false } : {}),
          ...(userJutsuObj.reskinId && conflictingReskin
            ? { reskinId: conflictingReskin.id }
            : {}),
        })
        .where(
          and(
            eq(userJutsu.id, input.userJutsuId),
            eq(userJutsu.userId, ctx.userId),
            eq(userJutsu.jutsuId, userJutsuObj.jutsu.id),
            eq(userJutsu.level, userJutsuObj.level),
          ),
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
        ctx.drizzle
          .update(userData)
          .set({ questData: questDataForDb })
          .where(eq(userData.userId, ctx.userId)),
        ...loadoutsToUpdate.map((loadout) =>
          ctx.drizzle
            .update(jutsuLoadout)
            .set({ jutsuIds: loadout.jutsuIds })
            .where(eq(jutsuLoadout.id, loadout.id)),
        ),
        // No-collision reskin carry-forward: update the reskin row's jutsuId so
        // createReskin's by-jutsuId lookup still works after evolution. (The
        // collision case is already handled above in the merged userJutsu update,
        // where reskinId is re-pointed to the pre-existing historical row. The
        // parent reskin row is left as an orphaned historical record there,
        // consistent with removeReskin behaviour.)
        ...(userJutsuObj.reskinId && !conflictingReskin
          ? [
              ctx.drizzle
                .update(jutsuReskin)
                .set({ jutsuId: input.evolutionJutsuId, updatedAt: new Date() })
                .where(
                  and(
                    eq(jutsuReskin.id, userJutsuObj.reskinId),
                    eq(jutsuReskin.userId, ctx.userId),
                  ),
                ),
            ]
          : []),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "userJutsu",
          changes: [`Evolved ${userJutsuObj.jutsu.name} into ${evolutionJutsu.name}`],
          relatedId: input.evolutionJutsuId,
          relatedMsg: "JutsuEvolution",
          relatedImage: evolutionJutsu.image,
        }),
      ]);
      return { success: true, message: `Evolved into ${evolutionJutsu.name}!` };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string(), data: JutsuValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query in parallel for performance
      const [
        user,
        entry,
        relations,
        jutsuWithName,
        parent,
        siblings,
        evolutionGraph,
        requiredItem,
      ] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchJutsu(ctx.drizzle, input.id),
        getJutsuRelations(ctx.drizzle, input.id),
        ctx.drizzle.query.jutsu.findFirst({
          columns: { name: true, id: true },
          where: eq(jutsu.name, input.data.name),
        }),
        input.data.parentJutsuId
          ? fetchJutsu(ctx.drizzle, input.data.parentJutsuId)
          : Promise.resolve(null),
        input.data.parentJutsuId
          ? ctx.drizzle.query.jutsu.findMany({
              columns: { id: true },
              where: eq(jutsu.parentJutsuId, input.data.parentJutsuId),
            })
          : Promise.resolve([]),
        input.data.parentJutsuId
          ? ctx.drizzle.query.jutsu.findMany({
              columns: { id: true, parentJutsuId: true },
              where: isNotNull(jutsu.parentJutsuId),
            })
          : Promise.resolve([]),
        input.data.requiredBloodlineItemId
          ? ctx.drizzle.query.item.findFirst({
              columns: { id: true, bloodlineId: true },
              where: eq(item.id, input.data.requiredBloodlineItemId),
            })
          : Promise.resolve(null),
      ]);
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
      if (input.data.requiredBloodlineItemId) {
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
        if (input.data.parentJutsuId === input.id)
          return errorResponse("A jutsu cannot be its own parent");
        if (!parent) return errorResponse("Parent jutsu not found");
        if (parent.jutsuType === "AI")
          return errorResponse("AI jutsus cannot be evolution parents");
        // Max 3 direct evolutions per parent (exclude self in case of re-save)
        const siblingCount = siblings.filter((s) => s.id !== input.id).length;
        if (siblingCount >= 3)
          return errorResponse("A jutsu can have a maximum of 3 evolutions");
        // Validate chain depth (max 3 levels: A -> B -> C).
        const jutsuById = new Map(
          evolutionGraph.map((node) => [node.id, node] as const),
        );
        // Walk upward from parent to get ancestor depth, checking for circular refs.
        // visitedAncestors guards against pre-existing cycles already in the DB.
        let ancestorDepth = 1;
        let ancestorParentId = parent.parentJutsuId;
        const visitedAncestors = new Set<string>([input.data.parentJutsuId]);
        while (ancestorParentId) {
          if (ancestorParentId === input.id)
            return errorResponse("Cannot create a circular evolution chain");
          if (visitedAncestors.has(ancestorParentId)) break;
          visitedAncestors.add(ancestorParentId);
          const nextAncestor = jutsuById.get(ancestorParentId);
          ancestorDepth++;
          if (!nextAncestor) break;
          ancestorParentId = nextAncestor.parentJutsuId;
        }
        // Walk downward from input.id to get the deepest descendant depth.
        // visitedDescendants guards against pre-existing cycles in the DB.
        const childrenByParent = new Map<string, string[]>();
        for (const node of evolutionGraph) {
          if (!node.parentJutsuId) continue;
          const children = childrenByParent.get(node.parentJutsuId) ?? [];
          children.push(node.id);
          childrenByParent.set(node.parentJutsuId, children);
        }
        let descendantDepth = 1;
        let frontier = [input.id];
        const visitedDescendants = new Set<string>([input.id]);
        while (frontier.length > 0) {
          const nextFrontier = frontier
            .flatMap((parentId) => childrenByParent.get(parentId) ?? [])
            .filter((id) => !visitedDescendants.has(id));
          if (nextFrontier.length === 0) break;
          for (const id of nextFrontier) visitedDescendants.add(id);
          frontier = nextFrontier;
          descendantDepth++;
        }
        if (ancestorDepth + descendantDepth > 3)
          return errorResponse("Maximum evolution chain depth is 3");
      }
      // Diff
      const diff = calculateContentDiff(entry, {
        id: entry.id,
        updatedAt: entry.updatedAt,
        createdAt: entry.createdAt,
        ...input.data,
      });
      // Update
      await Promise.all([
        ctx.drizzle.update(jutsu).set(input.data).where(eq(jutsu.id, input.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "jutsu",
          changes: diff,
          relatedId: entry.id,
          relatedMsg: `Update: ${entry.name}`,
          relatedImage: entry.image,
        }),
        ...(input.data.hidden
          ? [
              ctx.drizzle
                .update(userJutsu)
                .set({ equipped: false })
                .where(eq(userJutsu.jutsuId, entry.id)),
            ]
          : []),
      ]);
      if (process.env.NODE_ENV !== "development") {
        await callDiscordContent(user.username, entry.name, diff, entry.image);
      }
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),

  getUserJutsus: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get current user's jutsus" } })
    .input(jutsuFilteringSchema)
    .query(async ({ ctx, input }) => {
      return await fetchUserJutsus(ctx.drizzle, ctx.userId, input);
    }),
  // Lightweight endpoint returning only what's needed to determine jutsu ownership
  // and evolution ancestry. Used by UIs that need the full (unfiltered) owned set
  // without transferring every column of every userJutsu row.
  getUserJutsuOwnership: protectedProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Get current user's jutsu ownership (ids + ancestor ids)",
      },
    })
    .query(async ({ ctx }) => {
      const parentJutsuAlias = alias(jutsu, "parentJutsu");
      const rows = await ctx.drizzle
        .select({
          jutsuId: userJutsu.jutsuId,
          parentJutsuId: jutsu.parentJutsuId,
          grandparentJutsuId: parentJutsuAlias.parentJutsuId,
        })
        .from(userJutsu)
        .innerJoin(jutsu, eq(userJutsu.jutsuId, jutsu.id))
        .leftJoin(parentJutsuAlias, eq(jutsu.parentJutsuId, parentJutsuAlias.id))
        .where(and(eq(userJutsu.userId, ctx.userId), ne(jutsu.jutsuType, "AI")));
      return rows.map((row) => ({
        jutsuId: row.jutsuId,
        ancestorIds: [row.parentJutsuId, row.grandparentJutsuId].filter(
          (id): id is string => !!id,
        ),
      }));
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
      // Guard
      if (!canEditJutsus(user.role)) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Not allowed to edit public user",
        });
      }
      // Return
      return results;
    }),
  // Adjust jutsu level of public user (and optionally reskin)
  adjustUserJutsu: protectedProcedure
    .input(
      z.object({
        userId: z.string(),
        jutsuId: z.string(),
        level: z.number(),
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
              ctx.drizzle.query.jutsuReskin.findFirst({
                where: and(
                  eq(jutsuReskin.id, input.reskinId),
                  eq(jutsuReskin.jutsuId, input.jutsuId),
                ),
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
        ctx.drizzle
          .update(userJutsu)
          .set(updateFields)
          .where(
            and(
              eq(userJutsu.userId, input.userId),
              eq(userJutsu.jutsuId, input.jutsuId),
            ),
          ),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "user",
          changes,
          relatedId: input.userId,
          relatedMsg: `Update: ${userjutsu.jutsu.name}`,
          relatedImage: userjutsu.jutsu.image,
        }),
      ]);
      return { success: true, message: `Jutsu updated` };
    }),
  // Start training a given jutsu
  startTraining: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Start training a jutsu" } })
    .input(z.object({ jutsuId: z.string() }))
    .output(
      baseServerResponse.extend({
        data: z
          .object({ money: z.number(), questData: z.array(QuestTracker).nullable() })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [data, info, userjutsus, students] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchJutsu(ctx.drizzle, input.jutsuId),
        fetchUserJutsus(ctx.drizzle, ctx.userId),
        fetchStudents(ctx.drizzle, ctx.userId),
      ]);
      const { user } = data;
      if (!user) return errorResponse("User not found");

      // Derived
      const userjutsuObj = userjutsus.find((j) => j.jutsuId === input.jutsuId);
      const equippedJutsus = userjutsus.filter((uj) => uj.equipped);
      const curEquip = equippedJutsus.length;
      const maxEquip = calcJutsuEquipLimit(user);
      const equippedCapCounts = countEquippedByCap(equippedJutsus);

      if (!info) return errorResponse("Jutsu not found");
      if (!canTrainJutsu(info, user) && !info.parentJutsuId)
        return errorResponse("Jutsu not for you");
      if (!userjutsuObj && isJutsuTrainToLearnRestricted(info.jutsuType)) {
        return errorResponse("This jutsu cannot be learned through training");
      }
      if (info.parentJutsuId && !userjutsuObj)
        return errorResponse(
          "Evolution jutsus can only be obtained by evolving the parent jutsu",
        );
      if (info.parentJutsuId && userjutsuObj && !canUseJutsu(info, user, true))
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

      const level = userjutsuObj ? userjutsuObj.level : 0;
      if (level >= JUTSU_LEVEL_CAP) {
        return errorResponse("Jutsu is already at max level");
      }
      if (info.hidden && !canChangeContent(user.role)) {
        return errorResponse("Jutsu is hidden, cannot be trained");
      }
      if (userjutsus.find((j) => j.finishTraining && j.finishTraining > new Date())) {
        return errorResponse("You are already training a jutsu");
      }

      // Time & cost
      const trainTime = calcJutsuTrainTime(info, level, user);
      const trainCost = calcJutsuTrainCost(info, level, user, students);

      // Quests
      let questDataFull = user.questData ?? [];
      if (!userjutsuObj) {
        const { trackers } = getNewTrackers(user, [
          { task: "jutsus_mastered", increment: 1 },
          { task: "train_specific_jutsu", increment: 1, contentId: input.jutsuId },
        ]);
        questDataFull = trackers;
      }
      const questDataForDb = filterQuestTrackersForDbPersist(questDataFull, user);
      // Pre-mutation snapshot for refund if the new-jutsu insert fails after deduct.
      const questDataBeforeTrain = filterQuestTrackersForDbPersist(
        user.questData ?? [],
        user,
      );

      // Deduct money
      const moneyUpdate = await ctx.drizzle
        .update(userData)
        .set({
          money: sql`${userData.money} - ${trainCost}`,
          questData: questDataForDb,
        })
        .where(and(eq(userData.userId, ctx.userId), gte(userData.money, trainCost)));
      if (moneyUpdate.rowsAffected !== 1) {
        return errorResponse("You don't have enough money");
      }

      // Insert or update user jutsu
      if (userjutsuObj) {
        await ctx.drizzle
          .update(userJutsu)
          .set({
            level: sql`${userJutsu.level} + 1`,
            finishTraining: new Date(Date.now() + trainTime),
            updatedAt: new Date(),
          })
          .where(
            and(eq(userJutsu.id, userjutsuObj.id), eq(userJutsu.userId, ctx.userId)),
          );
      } else {
        // Soft pre-check whether auto-equip is likely to succeed. Insert already
        // equipped when the snapshot says yes; only the over-cap rollback CAS
        // runs afterward to handle concurrent equips (under-cap re-check would
        // duplicate what the rollback covers a moment later).
        const capFlags = getJutsuCapFlags(info);
        const canAutoEquip =
          curEquip < maxEquip &&
          checkJutsuBloodlineItem(info, user.items) &&
          canEquipUnderCaps(capFlags, equippedCapCounts);

        const newUserJutsuId = nanoid();
        // onDuplicateKeyUpdate no-op (`id = id`) absorbs unique-index races. PlanetScale
        // reports changed rows, so a duplicate yields rowsAffected === 0 (not 2). Deduct
        // already happened above — refund money + quest snapshot when this request did
        // not insert (otherwise jutsus_mastered / train_specific_jutsu stay incremented).
        const refundTrainCost = () =>
          ctx.drizzle
            .update(userData)
            .set({
              money: sql`${userData.money} + ${trainCost}`,
              questData: questDataBeforeTrain,
            })
            .where(eq(userData.userId, ctx.userId));

        try {
          const insertResult = await ctx.drizzle
            .insert(userJutsu)
            .values({
              id: newUserJutsuId,
              userId: ctx.userId,
              jutsuId: input.jutsuId,
              finishTraining: new Date(Date.now() + trainTime),
              equipped: canAutoEquip,
            })
            .onDuplicateKeyUpdate({ set: { id: sql`id` } });

          if (insertResult.rowsAffected !== 1) {
            await refundTrainCost();
            return errorResponse(
              "You already own this jutsu — please refresh and try again",
            );
          }
        } catch {
          await refundTrainCost();
          return errorResponse("Failed to start training — please try again");
        }

        if (canAutoEquip) {
          await rollbackEquipIfOverCap({
            client: ctx.drizzle,
            userId: ctx.userId,
            userJutsuId: newUserJutsuId,
            maxEquip,
            flags: capFlags,
          });
        }
      }

      return {
        success: true,
        message: `You started training: ${info.name}`,
        data: { money: user.money - trainCost, questData: questDataFull },
      };
    }),

  stopTraining: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Stop training current jutsu" } })
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      const userjutsus = await fetchUserJutsus(ctx.drizzle, ctx.userId);
      const userjutsuObj = userjutsus.find(
        (j) => j.finishTraining && j.finishTraining > new Date(),
      );
      if (!userjutsuObj) {
        return { success: false, message: "Not training any jutsu" };
      }
      await ctx.drizzle
        .update(userJutsu)
        .set({
          level: sql`${userJutsu.level} - 1`,
          finishTraining: null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(userJutsu.id, userjutsuObj.id), eq(userJutsu.userId, ctx.userId)),
        );

      return {
        success: true,
        message: `You stopped training: ${userjutsuObj.jutsu?.name}`,
      };
    }),

  unequipAll: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Unequip all jutsus" } })
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
        ctx.drizzle
          .update(userJutsu)
          .set({ equipped: false })
          .where(eq(userJutsu.userId, ctx.userId)),
        loadout
          ? ctx.drizzle
              .update(jutsuLoadout)
              .set({ jutsuIds: [] })
              .where(eq(jutsuLoadout.id, loadout.id))
          : null,
      ]);

      return { success: true, message: "All jutsu unequipped" };
    }),

  toggleEquip: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Toggle jutsu equip status" } })
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
      if (!isEquipped && !canUseJutsu(userjutsuObj.jutsu, user, true)) {
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
            const rolledBack = await ctx.drizzle
              .update(userJutsu)
              .set({ equipped: false })
              .where(
                and(
                  eq(userJutsu.id, input.userJutsuId),
                  eq(userJutsu.userId, ctx.userId),
                  eq(userJutsu.equipped, true),
                  sql`NOT EXISTS (
                    SELECT 1 FROM (
                      SELECT ${jutsuLoadout.jutsuIds} AS ids
                      FROM ${userData}
                      INNER JOIN ${jutsuLoadout} ON ${jutsuLoadout.id} = ${userData.jutsuLoadout}
                      WHERE ${userData.userId} = ${ctx.userId}
                        AND ${jutsuLoadout.userId} = ${ctx.userId}
                    ) AS active_loadout
                    WHERE JSON_CONTAINS(active_loadout.ids, JSON_QUOTE(${userjutsuObj.jutsuId}))
                  )`,
                ),
              );
            if (rolledBack.rowsAffected === 1) {
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
          await ctx.drizzle
            .update(userJutsu)
            .set({ equipped: false })
            .where(
              and(
                eq(userJutsu.id, input.userJutsuId),
                eq(userJutsu.userId, ctx.userId),
                eq(userJutsu.equipped, true),
              ),
            );
        } catch {
          const [row] = await ctx.drizzle
            .select({ equipped: userJutsu.equipped })
            .from(userJutsu)
            .where(
              and(
                eq(userJutsu.id, input.userJutsuId),
                eq(userJutsu.userId, ctx.userId),
              ),
            )
            .limit(1);
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
    .meta({ mcp: { enabled: true, description: "Reorder jutsu in loadout" } })
    .input(
      z.object({
        jutsuId: z.string(),
        loadoutId: z.string(),
        moveForward: z.boolean(),
      }),
    )
    .output(baseServerResponse)
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

      await ctx.drizzle
        .update(jutsuLoadout)
        .set({ jutsuIds: newOrder })
        .where(eq(jutsuLoadout.id, loadout.id));

      return { success: true, message: `Order updated` };
    }),

  renameLoadout: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Rename a jutsu loadout" } })
    .input(renameLoadoutSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [loadouts, user] = await Promise.all([
        fetchJutsuLoadouts(ctx.drizzle, ctx.userId),
        fetchLoadoutUser(ctx.drizzle, ctx.userId),
      ]);
      return applyLoadoutRename(
        decideRename(loadouts, fedJutsuLoadouts(user), input),
        (name) =>
          ctx.drizzle
            .update(jutsuLoadout)
            .set({ name })
            .where(
              and(eq(jutsuLoadout.id, input.id), eq(jutsuLoadout.userId, ctx.userId)),
            ),
        () =>
          ctx.drizzle.query.jutsuLoadout
            .findFirst({
              columns: { id: true },
              where: and(
                eq(jutsuLoadout.id, input.id),
                eq(jutsuLoadout.userId, ctx.userId),
              ),
            })
            .then((row) => !!row),
      );
    }),

  createReskin: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Create a jutsu reskin" } })
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
          ctx.drizzle
            .update(jutsuReskin)
            .set({
              name: input.name,
              description: input.description,
              battleDescription: input.battleDescription,
              image: resolvedImage,
              updatedAt: new Date(),
            })
            .where(eq(jutsuReskin.id, existingReskin.id)),
          ctx.drizzle
            .update(userJutsu)
            .set({
              reskinId: existingReskin.id,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(userJutsu.jutsuId, jutsuData.id),
                eq(userJutsu.userId, ctx.userId),
              ),
            ),
        ]);
        return { success: true, message: "Jutsu reskin updated successfully" };
      } else {
        const reskinId = nanoid();
        await Promise.all([
          ctx.drizzle
            .update(userJutsu)
            .set({
              reskinId: reskinId,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(userJutsu.jutsuId, jutsuData.id),
                eq(userJutsu.userId, ctx.userId),
              ),
            ),
          ctx.drizzle.insert(jutsuReskin).values({
            id: reskinId,
            userId: ctx.userId,
            jutsuId: jutsuData.id,
            name: input.name ?? jutsuData.name,
            description: input.description ?? jutsuData.description,
            battleDescription: input.battleDescription ?? jutsuData.battleDescription,
            image: resolvedImage,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
          ...(canReskinFreely(user.role)
            ? []
            : [
                ctx.drizzle
                  .update(userData)
                  .set({
                    reputationPoints: sql`${userData.reputationPoints} - ${COST_RESKIN_JUTSU}`,
                  })
                  .where(eq(userData.userId, ctx.userId)),
              ]),
        ]);

        return { success: true, message: "Jutsu reskin created successfully" };
      }
    }),

  updateReskin: protectedProcedure
    .input(z.object({ reskinId: z.string(), data: jutsuReskinUpdateSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch current user and reskin
      const [user, reskin] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserReskin(ctx.drizzle, ctx.userId, input.reskinId),
      ]);
      // Guards
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!reskin) return errorResponse("Reskin not found");
      if (!canModerateReskin(user.role)) {
        return errorResponse("Unauthorized");
      }
      // Prepare old/new objects for diff (exclude reason from new)
      const oldData = {
        name: reskin.name,
        description: reskin.description,
        battleDescription: reskin.battleDescription,
        image: reskin.image,
      };
      const { reason, ...rest } = input.data;
      const newData = { ...rest };
      const diff = calculateContentDiff(oldData, newData);

      // AI moderation of reason
      const aiCheck = await validateUserUpdateReason(diff.join(". "), reason);
      if (!aiCheck.allowUpdate) {
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "jutsu",
          changes: [`Reskin update rejected by AI: ${aiCheck.comment}`],
          relatedId: reskin.jutsuId,
          relatedMsg: `Reskin update rejected by AI: ${reason}`,
          relatedImage: reskin.image,
        });
        return errorResponse(aiCheck.comment);
      }

      // Update database and log
      await Promise.all([
        ctx.drizzle
          .update(jutsuReskin)
          .set({
            name: newData.name,
            description: newData.description,
            battleDescription: newData.battleDescription,
            image: newData.image ?? reskin.image,
            updatedAt: new Date(),
          })
          .where(eq(jutsuReskin.id, reskin.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "jutsu",
          changes: diff,
          relatedId: reskin.jutsuId,
          relatedMsg: `Reskin updated: ${reskin.jutsu?.name || reskin.name}`,
          relatedImage: newData.image ?? reskin.image,
        }),
      ]);

      return { success: true, message: "Jutsu reskin updated successfully" };
    }),

  getAllReskins: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get paginated jutsu reskins" } })
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

      // Query reskins joined with jutsu to allow filtering via jutsuDatabaseFilter
      const rows = await ctx.drizzle
        .select({
          reskin: jutsuReskin,
          jutsu: jutsu,
          bloodlineName: bloodline.name,
          userUsername: userData.username,
        })
        .from(jutsuReskin)
        .innerJoin(jutsu, eq(jutsuReskin.jutsuId, jutsu.id))
        .leftJoin(bloodline, eq(jutsu.bloodlineId, bloodline.id))
        .innerJoin(userData, eq(jutsuReskin.userId, userData.userId))
        .where(
          and(...baseFilters, ...(input.hideAi ? [ne(jutsu.jutsuType, "AI")] : [])),
        )
        .orderBy(desc(jutsuReskin.updatedAt))
        .offset(skip)
        .limit(input.limit);

      // Map back to the previous shape used by the frontend consumer
      const results = rows
        .filter((row) => filterByEffectConstraints([row.jutsu], input).length > 0)
        .map((row) => ({
          ...row.reskin,
          jutsu: {
            ...row.jutsu,
            bloodline: row.bloodlineName ? { name: row.bloodlineName } : null,
          },
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
    .meta({ mcp: { enabled: true, description: "Get user's jutsu reskins" } })
    .query(async ({ ctx }) => {
      return await fetchUserReskins(ctx.drizzle, ctx.userId);
    }),

  // List all reskins available for a given base jutsu
  getReskinsForJutsu: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get all reskins for a jutsu" } })
    .input(z.object({ jutsuId: z.string() }))
    .query(async ({ ctx, input }) => {
      const reskins = await ctx.drizzle.query.jutsuReskin.findMany({
        where: eq(jutsuReskin.jutsuId, input.jutsuId),
        orderBy: (table, { desc }) => [desc(table.updatedAt)],
        with: {
          user: {
            columns: { username: true },
          },
        },
      });
      return reskins;
    }),

  getReskin: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get a specific jutsu reskin" } })
    .input(z.object({ reskinId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Query
      const reskin = await fetchUserReskin(ctx.drizzle, ctx.userId, input.reskinId);

      // Return
      if (!reskin) {
        return errorResponse("Reskin not found");
      }
      // Return
      return reskin;
    }),
  removeReskin: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Remove reskin from a jutsu" } })
    .input(z.object({ userJutsuId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Query
      const userJutsuData = await ctx.drizzle.query.userJutsu.findFirst({
        where: and(
          eq(userJutsu.id, input.userJutsuId),
          eq(userJutsu.userId, ctx.userId),
        ),
        with: { activeReskin: true },
      });
      // Guard
      if (!userJutsuData) {
        return errorResponse("User jutsu not found");
      }
      if (!userJutsuData.activeReskin) {
        return errorResponse("No reskin found for this jutsu");
      }
      // Remove the reskin (but keep the record for history + free future updates)
      await Promise.all([
        ctx.drizzle
          .update(userJutsu)
          .set({
            reskinId: null,
            updatedAt: new Date(),
          })
          .where(
            and(eq(userJutsu.id, input.userJutsuId), eq(userJutsu.userId, ctx.userId)),
          ),
      ]);
      // Return
      return {
        success: true,
        message: "Jutsu reskin removed successfully",
      };
    }),

  getJutsuRelations: publicProcedure
    .meta({
      mcp: { enabled: true, description: "Get jutsu relations and dependencies" },
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
  ] = await Promise.all([
    client.query.jutsu.findMany({
      columns: { id: true, name: true },
      where: sql`JSON_SEARCH(${jutsu.effects}, 'one', ${jutsuId}, NULL, '$[*].jutsuIds[*]') IS NOT NULL
               AND JSON_SEARCH(${jutsu.effects}, 'one', 'injectjutsus', NULL, '$[*].type') IS NOT NULL`,
    }),
    client.query.bloodline.findMany({
      columns: { id: true, name: true },
      where: sql`JSON_SEARCH(${bloodline.effects}, 'one', ${jutsuId}, NULL, '$[*].jutsuIds[*]') IS NOT NULL
               AND JSON_SEARCH(${bloodline.effects}, 'one', 'injectjutsus', NULL, '$[*].type') IS NOT NULL`,
    }),
    client.query.skillTree.findMany({
      columns: { id: true, name: true },
      where: sql`JSON_SEARCH(${skillTree.effects}, 'one', ${jutsuId}, NULL, '$[*].jutsuIds[*]') IS NOT NULL
               AND JSON_SEARCH(${skillTree.effects}, 'one', 'injectjutsus', NULL, '$[*].type') IS NOT NULL`,
    }),
    client.query.item.findMany({
      columns: { id: true, name: true },
      where: sql`JSON_SEARCH(${item.effects}, 'one', ${jutsuId}, NULL, '$[*].jutsuIds[*]') IS NOT NULL
               AND JSON_SEARCH(${item.effects}, 'one', 'injectjutsus', NULL, '$[*].type') IS NOT NULL`,
    }),
    client
      .select({
        name: userData.username,
        id: userData.userId,
      })
      .from(userJutsu)
      .innerJoin(userData, eq(userJutsu.userId, userData.userId))
      .where(and(eq(userJutsu.jutsuId, jutsuId), eq(userData.isAi, true))),
    client.query.quest.findMany({
      columns: { id: true, name: true },
      where: sql`(
        JSON_SEARCH(${quest.content}, 'one', ${jutsuId}, NULL, '$.reward.reward_jutsus[*]') IS NOT NULL
        OR JSON_SEARCH(${quest.content}, 'one', ${jutsuId}, NULL, '$.objectives[*].reward_jutsus[*]') IS NOT NULL
      )`,
    }),
    client.query.jutsu.findMany({
      columns: { id: true, name: true },
      where: eq(jutsu.parentJutsuId, jutsuId),
    }),
  ]);

  return {
    jutsuInjectors,
    bloodlineInjectors,
    skillInjectors,
    itemInjectors,
    aiUsingJutsu,
    questsUsingJutsu,
    childEvolutions,
  };
};
export type JutsuRelations = Awaited<ReturnType<typeof getJutsuRelations>>;

/**
 * Fetch all loadouts for a user
 * @param client - The database client
 * @param userId - The ID of the user to fetch loadouts for
 * @returns A promise that resolves to the result of the select
 */
export const fetchJutsuLoadouts = async (client: DrizzleClient, userId: string) => {
  return await client.query.jutsuLoadout.findMany({
    where: eq(jutsuLoadout.userId, userId),
    // id is the deterministic tie-breaker so ties on createdAt (possible after a
    // batched backfill) keep a stable order across reads.
    orderBy: (table) => [asc(table.createdAt), asc(table.id)],
  });
};

/**
 * Fetch a jutsu by id (for reskin update)
 * @param client - The database client
 * @param id - The ID of the jutsu to fetch
 * @returns A promise that resolves to the result of the select
 */
export const fetchJutsu = async (client: DrizzleClient, id: string) => {
  return await client.query.jutsu.findFirst({
    where: eq(jutsu.id, id),
  });
};

/**
 * Fetch a reskin for a user
 * @param client - The database client
 * @param userId - The ID of the user to fetch the reskin for
 * @param reskinId - The ID of the reskin to fetch
 * @returns A promise that resolves to the result of the select
 */
export const fetchUserReskin = async (
  client: DrizzleClient,
  userId: string,
  reskinId: string,
) => {
  return await client.query.jutsuReskin.findFirst({
    where: and(eq(jutsuReskin.userId, userId), eq(jutsuReskin.id, reskinId)),
    with: {
      jutsu: {
        with: {
          bloodline: {
            columns: {
              name: true,
            },
          },
        },
      },
      user: {
        columns: {
          username: true,
        },
      },
    },
  });
};

/**
 * Fetch all reskins for a user
 * @param client - The database client
 * @param userId - The ID of the user to fetch reskins for
 * @returns A promise that resolves to the result of the select
 */
export const fetchUserReskins = async (client: DrizzleClient, userId: string) => {
  return await client.query.jutsuReskin.findMany({
    where: eq(jutsuReskin.userId, userId),
  });
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
  input?: JutsuFilteringSchema,
) => {
  // Self-join alias to get the parent jutsu's parentJutsuId (grandparent)
  const parentJutsuAlias = alias(jutsu, "parentJutsu");
  // Grab all userJutsus with Jutsu data and reskin data
  const userjutsus = await client
    .select()
    .from(userJutsu)
    .innerJoin(jutsu, eq(userJutsu.jutsuId, jutsu.id))
    .leftJoin(bloodline, eq(jutsu.bloodlineId, bloodline.id))
    .leftJoin(jutsuReskin, eq(userJutsu.reskinId, jutsuReskin.id))
    .leftJoin(parentJutsuAlias, eq(jutsu.parentJutsuId, parentJutsuAlias.id))
    .where(
      and(
        eq(userJutsu.userId, userId),
        ne(jutsu.jutsuType, "AI"),
        ...jutsuDatabaseFilter(input, true),
      ),
    )
    .orderBy(desc(userJutsu.level));
  // First map to query-format
  const unskinnedUserJutsus = userjutsus.map((result) => ({
    ...result.UserJutsu,
    jutsu: {
      ...result.Jutsu,
      bloodline: result.Bloodline,
    },
    activeReskin: result.JutsuReskin,
    // Grandparent ID — allows frontend to walk the full ancestor chain
    parentJutsuParentId: result.parentJutsu?.parentJutsuId ?? null,
    ancestorIds: [
      result.Jutsu.parentJutsuId,
      result.parentJutsu?.parentJutsuId ?? null,
    ].filter((id): id is string => !!id),
  }));
  // Then map to reskinned format
  return unskinnedUserJutsus.map((userjutsu) => getReskinnedUserJutsu(userjutsu));
};

/**
 * Build the DB filtering array, including new EXCLUSIONS.
 */
export const jutsuDatabaseFilter = (
  input?: JutsuFilteringSchema,
  includeHidden = false,
) => {
  return [
    // -----------------------------
    // Existing "include" conditions
    // -----------------------------
    ...(input?.name
      ? [like(sql`LOWER(${jutsu.name})`, `%${input.name.toLowerCase()}%`)]
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
                sql`JSON_SEARCH(${jutsu.effects}, 'one', ${e}, NULL, '$[*].elements[*]') IS NOT NULL`,
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
            c as "Highest" | "Ninjutsu" | "Genjutsu" | "Taijutsu" | "Bukijutsu",
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
            sql`JSON_SEARCH(${jutsu.effects}, 'one', ${excludedEl}, NULL, '$[*].elements[*]') IS NULL`,
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
const filterByEffectConstraints = <T extends { effects: ZodAllTags[] }>(
  rows: T[],
  input: JutsuFilteringSchema,
) => {
  return rows.filter((row) => {
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
  // combat passes a slimmer required-item validator against its battle state.
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

  // Equip first, then advance the pointer (mirrors selectItemLoadout). The equip
  // is one atomic statement, so serializing keeps the jutsuLoadout pointer from
  // racing ahead and pointing at a loadout whose jutsus were not equipped.
  await client
    .update(userJutsu)
    .set({
      equipped:
        equipIds.length > 0
          ? sql`CASE WHEN ${inArray(userJutsu.jutsuId, equipIds)} THEN 1 ELSE 0 END`
          : false,
    })
    .where(eq(userJutsu.userId, user.userId));
  await client
    .update(userData)
    .set({ jutsuLoadout: loadout.id })
    .where(eq(userData.userId, user.userId));

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
 * Materialized equip-cap counts for MySQL UPDATE guards. Wrapping in a derived
 * table avoids ERROR 1093 (can't select from the table being updated).
 *
 * All counters share one UserJutsu ⨝ Jutsu pass driven by JUTSU_EQUIP_CAPS.
 * jutsuType != 'AI' mirrors fetchUserJutsus so CAS guards agree with JS pre-checks.
 *
 * residualModifier is numeric JSON, so JSON_SEARCH (string-only) cannot detect it,
 * and PlanetScale has no JSON_TABLE. One `$[*].residualModifier` extract returns
 * every match; REGEXP `[1-9]` then tests for any non-zero value in that array
 * (matches getJutsuCapFlags truthiness; combat schema is 0..2).
 */
const residualModifierOnAliasSql = (alias: string) =>
  sql.raw(
    `CAST(JSON_EXTRACT(${alias}.effects, '$[*].residualModifier') AS CHAR) REGEXP '[1-9]'`,
  );

const equipCapCategorySql = (cap: JutsuEquipCap, alias: string) => {
  const kind = cap.sql;
  if (kind.kind === "residual") return residualModifierOnAliasSql(alias);
  if (kind.kind === "jutsuType") {
    return sql.raw(`${alias}.jutsuType = '${kind.jutsuType}'`);
  }
  return sql`JSON_SEARCH(${sql.raw(`${alias}.effects`)}, 'one', ${kind.effectType}, NULL, '$[*].type') IS NOT NULL`;
};

const equippedCapCountsDerivedSql = (userId: string) => {
  const sumCols = JUTSU_EQUIP_CAPS.map(
    (cap) =>
      sql`COALESCE(SUM(CASE WHEN ${equipCapCategorySql(cap, "j_cap")} THEN 1 ELSE 0 END), 0) AS ${sql.raw(cap.countAlias)}`,
  );
  return sql`(
    SELECT
      COUNT(*) AS total,
      ${sql.join(
        sumCols,
        sql`,
      `,
      )}
    FROM ${userJutsu} AS uj_cap
    INNER JOIN ${jutsu} AS j_cap ON j_cap.id = uj_cap.jutsuId
    WHERE uj_cap.userId = ${userId}
      AND uj_cap.equipped = true
      AND j_cap.jutsuType != 'AI'
  )`;
};

/** Under-cap predicate: all applicable counts must still have room (AND). */
const equipCapUnderGuardSql = (
  userId: string,
  maxEquip: number,
  flags: JutsuCapFlags,
) => {
  const parts = [sql`c.total < ${maxEquip}`];
  for (const cap of JUTSU_EQUIP_CAPS) {
    if (flags[cap.key]) {
      parts.push(sql`${sql.raw(`c.${cap.countAlias}`)} < ${cap.max}`);
    }
  }
  return sql`(
    SELECT ${sql.join(parts, sql` AND `)}
    FROM ${equippedCapCountsDerivedSql(userId)} AS c
  )`;
};

/**
 * True when this updated row's rank among equipped peers (updatedAt ASC, id ASC)
 * exceeds `cap`. Optional `categorySql` restricts the peer set (heal/event/…).
 * Derived-table wrapper avoids ERROR 1093 on the table being updated.
 */
const equippedRankExceedsCapSql = (
  userId: string,
  cap: number,
  categorySql?: ReturnType<typeof sql>,
) => sql`(
  SELECT cnt FROM (
    SELECT COUNT(*) AS cnt
    FROM ${userJutsu} AS uj_rank
    INNER JOIN ${jutsu} AS j_rank ON j_rank.id = uj_rank.jutsuId
    WHERE uj_rank.userId = ${userId}
      AND uj_rank.equipped = true
      AND j_rank.jutsuType != 'AI'
      ${categorySql ? sql`AND ${categorySql}` : sql``}
      AND (
        uj_rank.updatedAt < ${userJutsu.updatedAt}
        OR (
          uj_rank.updatedAt = ${userJutsu.updatedAt}
          AND uj_rank.id <= ${userJutsu.id}
        )
      )
  ) AS equip_rank_cnt
) > ${cap}`;

/**
 * Rollback predicate: unequip this row only when it sits outside the first N
 * kept slots for an exceeded cap. Concurrent racers that both passed under-cap
 * then both equip no longer both lose — earlier (updatedAt, id) keeps the slot.
 */
const equipCapRollbackGuardSql = (
  userId: string,
  maxEquip: number,
  flags: JutsuCapFlags,
) => {
  const parts = [equippedRankExceedsCapSql(userId, maxEquip)];
  for (const cap of JUTSU_EQUIP_CAPS) {
    if (flags[cap.key]) {
      parts.push(
        equippedRankExceedsCapSql(userId, cap.max, equipCapCategorySql(cap, "j_rank")),
      );
    }
  }
  return sql`(${sql.join(parts, sql` OR `)})`;
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
  const rollback = await client
    .update(userJutsu)
    .set({ equipped: false })
    .where(
      and(
        eq(userJutsu.id, userJutsuId),
        eq(userJutsu.userId, userId),
        eq(userJutsu.equipped, true),
        equipCapRollbackGuardSql(userId, maxEquip, flags),
      ),
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

  const result = await client
    .update(userJutsu)
    .set({ equipped: true, updatedAt: new Date() })
    .where(
      and(
        eq(userJutsu.id, userJutsuId),
        eq(userJutsu.userId, userId),
        eq(userJutsu.equipped, false),
        equipCapUnderGuardSql(userId, maxEquip, flags),
      ),
    );
  if (result.rowsAffected !== 1) {
    // Distinguish double-click / concurrent equip from a genuine cap rejection.
    const [row] = await client
      .select({ equipped: userJutsu.equipped })
      .from(userJutsu)
      .where(and(eq(userJutsu.id, userJutsuId), eq(userJutsu.userId, userId)))
      .limit(1);
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
 * Returns true when the loadout ends up containing jutsuId (append or already present).
 */
const appendJutsuIdToLoadoutAtomically = async (args: {
  client: DrizzleClient;
  loadoutId: string;
  userId: string;
  jutsuId: string;
}): Promise<boolean> => {
  const { client, loadoutId, userId, jutsuId } = args;
  try {
    const result = await client
      .update(jutsuLoadout)
      .set({
        jutsuIds: sql`JSON_ARRAY_APPEND(${jutsuLoadout.jutsuIds}, '$', ${jutsuId})`,
      })
      .where(
        and(
          eq(jutsuLoadout.id, loadoutId),
          eq(jutsuLoadout.userId, userId),
          sql`NOT JSON_CONTAINS(${jutsuLoadout.jutsuIds}, JSON_QUOTE(${jutsuId}))`,
        ),
      );
    if (result.rowsAffected === 1) return true;
    // Already present (PlanetScale reports 0 changed rows) or missing loadout — verify.
    const row = await client.query.jutsuLoadout.findFirst({
      where: and(eq(jutsuLoadout.id, loadoutId), eq(jutsuLoadout.userId, userId)),
      columns: { jutsuIds: true },
    });
    return !!row?.jutsuIds.includes(jutsuId);
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
 * Returns true when the loadout no longer contains jutsuId (removed or already absent).
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
    const result = await client
      .update(jutsuLoadout)
      .set({
        jutsuIds: sql`JSON_REMOVE(
          ${jutsuLoadout.jutsuIds},
          JSON_UNQUOTE(JSON_SEARCH(${jutsuLoadout.jutsuIds}, 'one', ${searchPattern}, ${"\\"}))
        )`,
      })
      .where(
        and(
          eq(jutsuLoadout.id, loadoutId),
          eq(jutsuLoadout.userId, userId),
          // Exact membership — do not use unescaped JSON_SEARCH (LIKE wildcards).
          sql`JSON_CONTAINS(${jutsuLoadout.jutsuIds}, JSON_QUOTE(${jutsuId}))`,
        ),
      );
    if (result.rowsAffected === 1) return true;
    const row = await client.query.jutsuLoadout.findFirst({
      where: and(eq(jutsuLoadout.id, loadoutId), eq(jutsuLoadout.userId, userId)),
      columns: { jutsuIds: true },
    });
    // Missing loadout is fine (nothing to keep in sync); otherwise require absence.
    return !row || !row.jutsuIds.includes(jutsuId);
  } catch {
    return false;
  }
};
