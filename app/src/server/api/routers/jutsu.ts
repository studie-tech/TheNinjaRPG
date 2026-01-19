import { z } from "zod";
import { nanoid } from "nanoid";
import { eq, inArray, sql, and, or, gte, ne, like, desc } from "drizzle-orm";
import {
  jutsu,
  userJutsu,
  userData,
  actionLog,
  jutsuLoadout,
  bloodline,
  jutsuReskin,
  skillTree,
  item,
  quest,
} from "@/drizzle/schema";
import { fetchUser, fetchUpdatedUser } from "./profile";
import { canTrainJutsu } from "@/libs/train";
import { getNewTrackers } from "@/libs/quest";
import {
  JUTSU_LEVEL_CAP,
  JUTSU_TRANSFER_COST,
  JUTSU_TRANSFER_DAYS,
  JUTSU_TRANSFER_MAX_LEVEL,
  JUTSU_TRANSFER_MINIMUM_LEVEL,
  JUTSU_MAX_RESIDUAL_EQUIPPED,
  JUTSU_MAX_PIERCE_EQUIPPED,
  JUTSU_MAX_EVENT_EQUIPPED,
  JUTSU_MAX_BARRIER_EQUIPPED,
  JUTSU_MAX_STUN_EQUIPPED,
  TUTORIAL_JUTSU_ID,
} from "@/drizzle/constants";
import {
  calcJutsuTrainTime,
  calcJutsuTrainCost,
  calcJutsuEquipLimit,
} from "@/libs/train";
import { DAY_S, secondsFromDate } from "@/utils/time";
import { getFreeTransfers, getReskinnedUserJutsu } from "@/libs/jutsu";
import { JutsuValidator } from "@/libs/combat/types";
import {
  canChangeContent,
  canEditJutsus,
  canTransferJutsu,
  canReskinFreely,
  canModerateReskin,
  canOnlyEditSelf,
} from "@/utils/permissions";
import { callDiscordContent } from "@/libs/socials";
import { createTRPCRouter, errorResponse } from "@/server/api/trpc";
import { protectedProcedure, publicProcedure } from "@/server/api/trpc";
import { serverError, baseServerResponse } from "@/server/api/trpc";
import { fedJutsuLoadouts } from "@/utils/paypal";
import {
  IMG_AVATAR_DEFAULT,
  RESKIN_LIMIT,
  COST_RESKIN_JUTSU,
} from "@/drizzle/constants";
import { calculateContentDiff } from "@/utils/diff";
import {
  jutsuFilteringSchema,
  jutsuReskinCreateSchema,
  jutsuReskinUpdateSchema,
} from "@/validators/jutsu";
import { QuestTracker } from "@/validators/objectives";
import type { JutsuFilteringSchema } from "@/validators/jutsu";
import type { ZodAllTags } from "@/libs/combat/types";
import type { UserData, JutsuLoadout, UserJutsuWithRelations } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { TRPCError } from "@trpc/server";
import { fetchStudents } from "@/routers/sensei";
import { validateUserUpdateReason } from "@/libs/moderator";

export const jutsuRouter = createTRPCRouter({
  getRecentTransfers: protectedProcedure.query(async ({ ctx }) => {
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

  getAllNames: publicProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.jutsu.findMany({
      columns: { id: true, name: true, image: true, injectableInBattle: true },
      orderBy: (table, { asc }) => [asc(table.name)],
    });
  }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchJutsu(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Jutsu not found");
      }
      return result as Omit<typeof result, "effects"> & { effects: ZodAllTags[] };
    }),

  getAll: publicProcedure
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

  getLoadouts: protectedProcedure.query(async ({ ctx }) => {
    const [loadouts, user] = await Promise.all([
      fetchJutsuLoadouts(ctx.drizzle, ctx.userId),
      fetchUser(ctx.drizzle, ctx.userId),
    ]);
    const maxLoadouts = fedJutsuLoadouts(user);

    // Create missing loadouts if needed
    if (loadouts.length < maxLoadouts) {
      for (let i = loadouts.length; i < maxLoadouts; i++) {
        const loadout = {
          id: nanoid(),
          userId: ctx.userId,
          jutsuIds: [],
          createdAt: new Date(),
        };
        await ctx.drizzle.insert(jutsuLoadout).values(loadout);
        loadouts.push(loadout);
      }
    }

    // If more than one loadout, and no user loadout, set it to the first
    if (loadouts?.[0] && !user.jutsuLoadout) {
      await ctx.drizzle
        .update(userData)
        .set({ jutsuLoadout: loadouts[0].id })
        .where(eq(userData.userId, ctx.userId));
    }

    return maxLoadouts < loadouts.length ? loadouts.slice(0, maxLoadouts) : loadouts;
  }),

  selectJutsuLoadout: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [loadouts, user, userjutsus] = await Promise.all([
        fetchJutsuLoadouts(ctx.drizzle, ctx.userId),
        fetchUser(ctx.drizzle, ctx.userId),
        fetchUserJutsus(ctx.drizzle, ctx.userId),
      ]);
      // Mutate & return result
      const id = input.id;
      return await selectJutsuLoadout(ctx.drizzle, id, loadouts, userjutsus, user);
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
        relations.aiUsingJutsu.length;
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

  update: protectedProcedure
    .input(z.object({ id: z.string(), data: JutsuValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query in parallel for performance
      const [user, entry, relations, jutsuWithName] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchJutsu(ctx.drizzle, input.id),
        getJutsuRelations(ctx.drizzle, input.id),
        ctx.drizzle.query.jutsu.findFirst({
          columns: { name: true, id: true },
          where: eq(jutsu.name, input.data.name),
        }),
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
    .input(jutsuFilteringSchema)
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
      const filteredJutsus = userjutsus.filter((uj) => canTrainJutsu(uj.jutsu, user));
      const curEquip = filteredJutsus?.filter((j) => j.equipped).length || 0;
      const maxEquip = userData && calcJutsuEquipLimit(user);
      const equippedJutsus = userjutsus.filter((uj) => uj.equipped);
      const residualJutsus = equippedJutsus.filter((uj) =>
        uj.jutsu.effects.some((e) => "residualModifier" in e && e.residualModifier),
      );
      const pierceJutsus = equippedJutsus.filter((uj) =>
        uj.jutsu.effects.some((e) => e.type === "pierce"),
      );
      const eventJutsus = equippedJutsus.filter((uj) => uj.jutsu.jutsuType === "EVENT");
      const barrierJutsus = equippedJutsus.filter((uj) =>
        uj.jutsu.effects.some((e) => e.type === "barrier"),
      );
      const stunJutsus = equippedJutsus.filter((uj) =>
        uj.jutsu.effects.some((e) => e.type === "stun"),
      );

      if (!info) return errorResponse("Jutsu not found");
      if (!canTrainJutsu(info, user)) return errorResponse("Jutsu not for you");
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
      let questData = user.questData;
      if (!userjutsuObj) {
        const { trackers } = getNewTrackers(user, [
          { task: "jutsus_mastered", increment: 1 },
        ]);
        questData = trackers;
      }

      // Deduct money
      const moneyUpdate = await ctx.drizzle
        .update(userData)
        .set({ money: sql`${userData.money} - ${trainCost}`, questData: questData })
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
        // Check if jutsu can be auto-equipped
        const jutsuHasResidual = info.effects.some(
          (e) => "residualModifier" in e && e.residualModifier,
        );
        const jutsuHasPierce = info.effects.some((e) => e.type === "pierce");
        const jutsuIsEvent = info.jutsuType === "EVENT";
        const jutsuHasBarrier = info.effects.some((e) => e.type === "barrier");
        const jutsuHasStun = info.effects.some((e) => e.type === "stun");

        const canAutoEquip =
          curEquip < maxEquip &&
          (!jutsuHasResidual ||
            residualJutsus.length < JUTSU_MAX_RESIDUAL_EQUIPPED) &&
          (!jutsuHasPierce || pierceJutsus.length < JUTSU_MAX_PIERCE_EQUIPPED) &&
          (!jutsuIsEvent || eventJutsus.length < JUTSU_MAX_EVENT_EQUIPPED) &&
          (!jutsuHasBarrier || barrierJutsus.length < JUTSU_MAX_BARRIER_EQUIPPED) &&
          (!jutsuHasStun || stunJutsus.length < JUTSU_MAX_STUN_EQUIPPED);

        // Use onDuplicateKeyUpdate to handle race conditions
        await ctx.drizzle
          .insert(userJutsu)
          .values({
            id: nanoid(),
            userId: ctx.userId,
            jutsuId: input.jutsuId,
            finishTraining: new Date(Date.now() + trainTime),
            equipped: canAutoEquip,
          })
          .onDuplicateKeyUpdate({ set: { id: sql`id` } });
      }

      return {
        success: true,
        message: `You started training: ${info.name}`,
        data: { money: user.money - trainCost, questData },
      };
    }),

  stopTraining: protectedProcedure
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

      const filteredJutsus = userjutsus.filter((uj) => canTrainJutsu(uj.jutsu, user));
      const userjutsuObj = filteredJutsus.find((j) => j.id === input.userJutsuId);
      const isEquipped = userjutsuObj?.equipped || false;
      const equippedJutsus = filteredJutsus.filter((j) => j.equipped);
      const curEquip = equippedJutsus.length || 0;
      const maxEquip = userData && calcJutsuEquipLimit(user);
      const pierceEquipped = equippedJutsus.filter((j) =>
        j.jutsu.effects.some((e) => e.type === "pierce"),
      ).length;
      const curJutsuIsPierce = userjutsuObj?.jutsu.effects.some(
        (e) => e.type === "pierce",
      );
      const eventEquipped = equippedJutsus.filter(
        (j) => j.jutsu.jutsuType === "EVENT",
      ).length;
      const curJutsuIsEvent = userjutsuObj?.jutsu.jutsuType === "EVENT";
      const barrierEquipped = equippedJutsus.filter((j) =>
        j.jutsu.effects.some((e) => e.type === "barrier"),
      ).length;
      const curJutsuIsBarrier = userjutsuObj?.jutsu.effects.some(
        (e) => e.type === "barrier",
      );
      const stunEquipped = equippedJutsus.filter((j) =>
        j.jutsu.effects.some((e) => e.type === "stun"),
      ).length;
      const curJutsuIsStun = userjutsuObj?.jutsu.effects.some(
        (e) => e.type === "stun",
      );
      const newEquippedState = isEquipped ? false : true;
      const loadout = loadouts.find((l) => l.id === user.jutsuLoadout);
      const isLoaded = userjutsuObj && loadout?.jutsuIds.includes(userjutsuObj.jutsuId);
      const residualJutsus = userjutsus.filter(
        (uj) =>
          uj.equipped &&
          uj.jutsu.effects.some((e) => "residualModifier" in e && e.residualModifier),
      );

      // Guards
      if (residualJutsus.length >= JUTSU_MAX_RESIDUAL_EQUIPPED && newEquippedState) {
        return errorResponse(
          `You cannot equip more than ${JUTSU_MAX_RESIDUAL_EQUIPPED} residual jutsu. Please unequip first.`,
        );
      }
      if (!userjutsuObj) return errorResponse("Jutsu not found");

      // Check if jutsu can be equipped (including bloodline check)
      if (!isEquipped && !canTrainJutsu(userjutsuObj.jutsu, user)) {
        return errorResponse("You cannot equip this jutsu due to missing requirements");
      }

      if (!isEquipped && curEquip >= maxEquip) {
        return errorResponse("You cannot equip more jutsu");
      }
      if (
        !isEquipped &&
        curJutsuIsPierce &&
        pierceEquipped >= JUTSU_MAX_PIERCE_EQUIPPED
      ) {
        return errorResponse(
          `You cannot equip more than ${JUTSU_MAX_PIERCE_EQUIPPED} piercing jutsu`,
        );
      }
      if (!isEquipped && curJutsuIsEvent && eventEquipped >= JUTSU_MAX_EVENT_EQUIPPED) {
        return errorResponse(
          `You cannot equip more than ${JUTSU_MAX_EVENT_EQUIPPED} event jutsu`,
        );
      }
      if (
        !isEquipped &&
        curJutsuIsBarrier &&
        barrierEquipped >= JUTSU_MAX_BARRIER_EQUIPPED
      ) {
        return errorResponse(
          `You cannot equip more than ${JUTSU_MAX_BARRIER_EQUIPPED} barrier jutsu`,
        );
      }
      if (
        !isEquipped &&
        curJutsuIsStun &&
        stunEquipped >= JUTSU_MAX_STUN_EQUIPPED
      ) {
        return errorResponse(
          `You cannot equip more than ${JUTSU_MAX_STUN_EQUIPPED} stun jutsu`,
        );
      }

      // Calculate loadout
      if (loadout && isLoaded && !newEquippedState) {
        loadout.jutsuIds = loadout.jutsuIds.filter((id) => id !== userjutsuObj.jutsuId);
      } else if (loadout && !isLoaded && newEquippedState) {
        loadout.jutsuIds.push(userjutsuObj.jutsuId);
      }

      await Promise.all([
        ctx.drizzle
          .update(userJutsu)
          .set({ equipped: newEquippedState })
          .where(eq(userJutsu.id, input.userJutsuId)),
        loadout
          ? ctx.drizzle
              .update(jutsuLoadout)
              .set({ jutsuIds: loadout.jutsuIds })
              .where(eq(jutsuLoadout.id, loadout.id))
          : null,
      ]);

      return {
        success: true,
        message: `Jutsu ${isEquipped ? "unequipped" : "equipped"}`,
        data: { equipped: newEquippedState, jutsuId: userjutsuObj.jutsuId },
      };
    }),

  updateUserJutsuOrder: protectedProcedure
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

  createReskin: protectedProcedure
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

  getUserReskins: protectedProcedure.query(async ({ ctx }) => {
    return await fetchUserReskins(ctx.drizzle, ctx.userId);
  }),

  // List all reskins available for a given base jutsu
  getReskinsForJutsu: protectedProcedure
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
  ]);

  return {
    jutsuInjectors,
    bloodlineInjectors,
    skillInjectors,
    itemInjectors,
    aiUsingJutsu,
    questsUsingJutsu,
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
    orderBy: (table) => desc(table.createdAt),
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
  // Grab all userJutsus with Jutsu data and reskin data
  const userjutsus = await client
    .select()
    .from(userJutsu)
    .innerJoin(jutsu, eq(userJutsu.jutsuId, jutsu.id))
    .leftJoin(bloodline, eq(jutsu.bloodlineId, bloodline.id))
    .leftJoin(jutsuReskin, eq(userJutsu.reskinId, jutsuReskin.id))
    .where(
      and(
        eq(userJutsu.userId, userId),
        ne(jutsu.jutsuType, "AI"),
        ...jutsuDatabaseFilter(input),
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
  }));
  // Then map to reskinned format
  return unskinnedUserJutsus.map((userjutsu) => getReskinnedUserJutsu(userjutsu));
};

/**
 * Build the DB filtering array, including new EXCLUSIONS.
 */
export const jutsuDatabaseFilter = (input?: JutsuFilteringSchema) => {
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

    // If hidden not specified, show hidden=false
    ...(input?.hidden !== undefined
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
) => {
  const loadout = loadouts.find((l) => l.id === loadoutId);
  const maxLoadouts = fedJutsuLoadouts(user);

  if (!loadout) return errorResponse("Loadout not found");
  if (maxLoadouts <= 0) return errorResponse("Loadouts not available");

  await Promise.all([
    client
      .update(userData)
      .set({ jutsuLoadout: loadout.id })
      .where(eq(userData.userId, user.userId)),
    client
      .update(userJutsu)
      .set({
        equipped:
          loadout.jutsuIds.length > 0
            ? sql`CASE WHEN ${inArray(userJutsu.jutsuId, loadout.jutsuIds)} THEN 1 ELSE 0 END`
            : false,
      })
      .where(eq(userJutsu.userId, user.userId)),
  ]);

  return {
    success: true,
    message: `Loadout selected`,
    jutsus: userjutsus.filter((u) => loadout.jutsuIds.includes(u.jutsuId)),
  };
};
