import { randomInt } from "crypto";
import { and, eq, gte, isNotNull, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/api/trpc";
import type { LetterRank } from "@/drizzle/constants";
import {
  COST_SWAP_SAGE_MODE,
  IMG_AVATAR_DEFAULT,
  LetterRanks,
  PITY_SAGE_MODE_ROLLS,
  PITY_SYSTEM_ENABLED,
  REMOVAL_COST,
  ROLL_CHANCE,
  SAGE_MODE_COST,
  SAGE_MODE_SWAP_COOLDOWN_HOURS,
  SAGE_MODE_SWAP_FREE_AMOUNT,
  SAGE_MODE_SWAP_FREE_DAYS,
  SAGE_MODE_SWAP_FREE_GOLD,
  SAGE_MODE_SWAP_FREE_NORMAL,
  SAGE_MODE_SWAP_FREE_SILVER,
} from "@/drizzle/constants";
import type { SageMode, UserData } from "@/drizzle/schema";
import { actionLog, sageMode, sageModeRolls, userData } from "@/drizzle/schema";
import {
  fetchItemSageModeRolls,
  fetchSageModes,
  filterRollableSageModes,
} from "@/libs/sageMode";
import { callDiscordContent } from "@/libs/socials";
import { fetchUpdatedUser, fetchUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { getRandomElement } from "@/utils/array";
import { calculateContentDiff } from "@/utils/diff";
import { getUnique } from "@/utils/grouping";
import { getUserFederalStatus } from "@/utils/paypal";
import { canChangeContent, canEditBloodline } from "@/utils/permissions";
import {
  DAY_S,
  getDaysHoursMinutesSeconds,
  getTimeLeftStr,
  secondsFromDate,
  secondsPassed,
} from "@/utils/time";
import { setEmptyStringsToNulls } from "@/utils/typeutils";
import type { ZodAllTags } from "@/validators/combat";
import { SageModeValidator } from "@/validators/combat";
import type { SageModeFilteringSchema } from "@/validators/sageMode";
import { sageModeFilteringSchema } from "@/validators/sageMode";

export const sageModeRouter = createTRPCRouter({
  getAllNames: publicProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.sageMode.findMany({
      columns: { id: true, name: true, image: true },
      where: eq(sageMode.hidden, false),
      orderBy: (table, { asc }) => [asc(table.name)],
    });
  }),

  /** All sage modes (including hidden) for staff editing user data — same permission as bloodline edit. */
  getAllNamesForEdit: protectedProcedure.query(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!user || !canEditBloodline(user.role)) {
      throw serverError("FORBIDDEN", "Not allowed to list sage modes for editing");
    }
    return await ctx.drizzle.query.sageMode.findMany({
      columns: { id: true, name: true, image: true },
      orderBy: (table, { asc }) => [asc(table.name)],
    });
  }),

  getAll: publicProcedure
    .input(
      sageModeFilteringSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const user = ctx.userId ? await fetchUser(ctx.drizzle, ctx.userId) : null;
      const allowHiddenFilter = user ? canChangeContent(user.role) : false;
      const baseFilters = sageModeDatabaseFilter(input, allowHiddenFilter);
      const results = await ctx.drizzle.query.sageMode.findMany({
        with: { village: { columns: { name: true } } },
        where: and(...baseFilters),
        orderBy: (table, { asc }) => [asc(table.name)],
        offset: skip,
        limit: input.limit,
      });
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),

  // Get a specific sage mode
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchSageMode(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Sage Mode not found");
      }
      return result as Omit<typeof result, "effects" | "afterEffects"> & {
        effects: ZodAllTags[];
        afterEffects: ZodAllTags[];
      };
    }),

  // Create new sage mode
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (user.isBanned)
      return errorResponse("You are banned and cannot perform this action");
    if (canChangeContent(user.role)) {
      const id = nanoid();
      await ctx.drizzle.insert(sageMode).values({
        id: id,
        name: `New Sage Mode - ${id}`,
        image: IMG_AVATAR_DEFAULT,
        description: "New sage mode description",
        effects: [],
        afterEffects: [],
        rank: "D",
        level: 1,
        hidden: true,
      });
      return { success: true, message: id };
    } else {
      return { success: false, message: `Not allowed to create sage mode` };
    }
  }),

  // Get all sage modes a user has ever had
  getUserHistoricSageModes: protectedProcedure.query(async ({ ctx }) => {
    return await fetchUserHistoricSageModes(ctx.drizzle, ctx.userId);
  }),

  // Get sage mode swap info
  getSwapInfo: protectedProcedure.query(async ({ ctx }) => {
    const [{ user }, recentSwaps] = await Promise.all([
      fetchUpdatedUser({
        client: ctx.drizzle,
        userId: ctx.userId,
      }),
      fetchMonthlySageModeSwaps(ctx.drizzle, ctx.userId),
    ]);
    if (!user)
      return {
        isFree: false,
        freeSwapsUsed: 0,
        freeSwapsRemaining: 0,
        recentSwaps: [],
      };
    const federalStatus = getUserFederalStatus(user);
    const freeSwaps = getFreeSageModeSwaps(federalStatus);
    const freeSwapsUsed = recentSwaps.length;
    const rawRemaining = freeSwaps - freeSwapsUsed;
    const freeSwapsRemaining = Math.max(0, rawRemaining);
    const isFree = freeSwapsRemaining > 0;
    return { isFree, freeSwapsUsed, freeSwapsRemaining, recentSwaps };
  }),

  // Swap sage mode of session user
  swapSageMode: protectedProcedure
    .input(z.object({ sageModeId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [updatedUser, mode, historicSageModes, lastTransfer, monthlySwaps] =
        await Promise.all([
          fetchUpdatedUser({
            client: ctx.drizzle,
            userId: ctx.userId,
          }),
          fetchSageMode(ctx.drizzle, input.sageModeId),
          fetchUserHistoricSageModes(ctx.drizzle, ctx.userId),
          ctx.drizzle.query.actionLog.findFirst({
            where: and(
              eq(actionLog.userId, ctx.userId),
              eq(actionLog.tableName, "user"),
              eq(actionLog.relatedMsg, "SageMode Changed"),
            ),
            orderBy: (table, { desc }) => [desc(table.createdAt)],
          }),
          fetchMonthlySageModeSwaps(ctx.drizzle, ctx.userId),
        ]);
      const user = updatedUser.user;
      if (!user) return errorResponse("User does not exist");
      if (!mode) return errorResponse("Sage Mode does not exist");
      if (user.sageModeId === mode.id) {
        return errorResponse("You already have this sage mode");
      }

      const federalStatus = getUserFederalStatus(user);
      const freeSwaps = getFreeSageModeSwaps(federalStatus);
      const freeSwapsUsed = monthlySwaps.length;
      const hasFreeSwapAvailable = freeSwapsUsed < freeSwaps;
      const isFreeSwap = hasFreeSwapAvailable;

      if (!isFreeSwap && COST_SWAP_SAGE_MODE > user.reputationPoints) {
        return errorResponse("Not enough reputation points");
      }
      if (!historicSageModes.find((b) => b.id === mode.id)) {
        return errorResponse("Sage Mode is not in your history");
      }
      if (lastTransfer) {
        const canTransferAgainDate = secondsFromDate(
          SAGE_MODE_SWAP_COOLDOWN_HOURS * 60 * 60,
          lastTransfer.createdAt,
        );
        if (canTransferAgainDate > new Date()) {
          const msLeft = -secondsPassed(canTransferAgainDate) * 1000;
          const timeLeft = getTimeLeftStr(...getDaysHoursMinutesSeconds(msLeft));
          return errorResponse(`You can swap again in ${timeLeft}`);
        }
      }

      const swapCost = isFreeSwap ? 0 : COST_SWAP_SAGE_MODE;
      const currentSageMode = user.sageModeId
        ? await fetchSageMode(ctx.drizzle, user.sageModeId)
        : null;
      const swapMessage = `Sage Mode Swapped from ${currentSageMode?.name ?? "None"} to ${mode.name}`;
      await updateSageMode(ctx.drizzle, user, mode, swapCost, swapMessage);

      if (isFreeSwap) {
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "sageModeSwap",
          changes: [`Sage Mode swap (free Gold - ${SAGE_MODE_SWAP_FREE_DAYS} days)`],
          relatedId: mode.id,
          relatedMsg: `Free swap for Gold supporter (${SAGE_MODE_SWAP_FREE_DAYS} day cooldown)`,
          relatedImage: user.avatarLight,
          relatedValue: 0,
        });
      }

      return {
        success: true,
        message: `Sage Mode swapped${isFreeSwap ? " (Free for Gold supporter)" : ""}`,
      };
    }),

  // Delete a sage mode
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry, usersWithSageMode] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchSageMode(ctx.drizzle, input.id),
        ctx.drizzle.query.userData.findMany({
          where: and(eq(userData.sageModeId, input.id), eq(userData.isAi, false)),
        }),
      ]);
      const usernames = usersWithSageMode.map((u) => u.username).join(", ");
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Sage Mode does not exist");
      if (!user) return errorResponse("User does not exist");
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to delete sage mode");
      }
      if (usersWithSageMode.length > 0) {
        return errorResponse(`Sage Mode used by users: ${usernames}, cannot delete`);
      }
      await Promise.all([
        ctx.drizzle.delete(sageMode).where(eq(sageMode.id, input.id)),
        ctx.drizzle
          .update(userData)
          .set({ sageModeId: null })
          .where(eq(userData.sageModeId, input.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "sageMode",
          changes: [`Deleted: ${entry.name}`],
          relatedId: entry.id,
          relatedMsg: `Delete: ${entry.name}`,
          relatedImage: entry.image,
        }),
      ]);
      return { success: true, message: `Sage Mode deleted` };
    }),

  // Update a sage mode
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: SageModeValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry, sageModeWithName] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchSageMode(ctx.drizzle, input.id),
        ctx.drizzle.query.sageMode.findFirst({
          columns: { name: true, id: true },
          where: eq(sageMode.name, input.data.name),
        }),
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Sage Mode not found");
      if (sageModeWithName && sageModeWithName.id !== entry.id)
        return errorResponse("Sage Mode name already exists");
      if (canChangeContent(user.role)) {
        setEmptyStringsToNulls(input.data as unknown as Record<string, unknown>);
        const newData = {
          ...input.data,
          effects: input.data.effects.map((e) => {
            delete e.rounds;
            delete e.friendlyFire;
            return e;
          }),
          afterEffects: input.data.afterEffects.map((e) => {
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
        await ctx.drizzle
          .update(sageMode)
          .set(newData)
          .where(eq(sageMode.id, input.id));
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "sageMode",
          changes: diff,
          relatedId: entry.id,
          relatedMsg: `Update: ${entry.name}`,
          relatedImage: entry.image,
        });
        if (process.env.NODE_ENV !== "development") {
          await callDiscordContent(user.username, entry.name, diff, entry.image);
        }
        return { success: true, message: `Data updated: ${diff.join(". ")}` };
      } else {
        return { success: false, message: `Not allowed to edit sage mode` };
      }
    }),

  // Get sage mode roll of a specific user
  getNaturalRolls: protectedProcedure.query(async ({ ctx }) => {
    return (await fetchNaturalSageModeRoll(ctx.drizzle, ctx.userId)) ?? null;
  }),

  getItemRolls: protectedProcedure.query(async ({ ctx }) => {
    return await fetchItemSageModeRolls(ctx.drizzle, ctx.userId);
  }),

  // Roll a sage mode
  roll: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const [user, prevRoll, allSageModes] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      fetchNaturalSageModeRoll(ctx.drizzle, ctx.userId),
      fetchSageModes(ctx.drizzle),
    ]);
    if (prevRoll) return errorResponse("You have already rolled for sage mode");
    if (user.status !== "AWAKE") {
      return errorResponse(`Cannot roll sage mode while ${user.status.toLowerCase()}`);
    }
    if (user.rank === "STUDENT") {
      return errorResponse(
        "Academy students cannot roll for sage mode. You must graduate first.",
      );
    }

    const doRoll = async () => {
      const rand = randomInt(0, 1_000_000) / 1_000_000;
      let sageModeRank: LetterRank | undefined;
      if (rand < ROLL_CHANCE.S) {
        sageModeRank = "S";
      } else if (rand < ROLL_CHANCE.A) {
        sageModeRank = "A";
      } else if (rand < ROLL_CHANCE.B) {
        sageModeRank = "B";
      } else if (rand < ROLL_CHANCE.C) {
        sageModeRank = "C";
      }
      if (sageModeRank) {
        const sageModePool = filterRollableSageModes({
          sageModes: allSageModes,
          rank: sageModeRank,
          user,
          previousRolls: [],
        });
        const randomSageMode = getRandomElement(sageModePool);
        if (randomSageMode) {
          await Promise.all([
            ctx.drizzle
              .update(userData)
              .set({ sageModeId: randomSageMode.id })
              .where(eq(userData.userId, ctx.userId)),
            ctx.drizzle.insert(sageModeRolls).values({
              id: nanoid(),
              userId: ctx.userId,
              used: 0,
              sageModeId: randomSageMode.id,
            }),
          ]);
          return {
            success: true,
            message: `After meditation, you have awakened a sage mode: ${randomSageMode.name}`,
          };
        }
      }
      await ctx.drizzle.insert(sageModeRolls).values({
        id: nanoid(),
        used: 0,
        userId: ctx.userId,
      });
      return {
        success: false,
        message:
          "After deep meditation, you were unable to connect with natural energy",
      };
    };
    return doRoll();
  }),

  // Pity Roll a sage mode
  pityRoll: protectedProcedure
    .input(z.object({ rank: z.enum(LetterRanks).optional().nullish() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, sageModes, previousRolls] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchSageModes(ctx.drizzle),
        fetchItemSageModeRolls(ctx.drizzle, ctx.userId),
      ]);
      const sageModePool = filterRollableSageModes({
        sageModes,
        user,
        previousRolls,
        rank: input.rank,
      });
      if (!PITY_SYSTEM_ENABLED) return errorResponse("Pity system is disabled");
      const prevRoll = previousRolls.find(
        (r) => r.goal === input.rank && !r.sageModeId,
      );
      if (!prevRoll) return errorResponse("No previous roll found");
      const availablePityRolls = getSageModePityRolls(prevRoll);
      if (availablePityRolls <= 0) return errorResponse("No pity rolls available");
      const randomSageMode = getRandomElement(sageModePool);
      if (!randomSageMode) return errorResponse("No sage modes in the pool?");
      await updateSageMode(
        ctx.drizzle,
        user,
        randomSageMode,
        0,
        `Pity roll for ${input.rank}: ${randomSageMode.name}`,
      );
      await Promise.all([
        ctx.drizzle
          .update(sageModeRolls)
          .set({
            pityRolls: prevRoll.pityRolls + 1,
            updatedAt: new Date(),
          })
          .where(eq(sageModeRolls.id, prevRoll.id)),
        ctx.drizzle.insert(sageModeRolls).values({
          id: nanoid(),
          userId: ctx.userId,
          type: "PITY",
          sageModeId: randomSageMode.id,
          goal: input.rank,
          used: 1,
        }),
      ]);
      return {
        success: true,
        message: `You have been granted a sage mode: ${randomSageMode.name}`,
      };
    }),

  // Remove a sage mode from session user
  removeSageMode: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      const [user, roll] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchNaturalSageModeRoll(ctx.drizzle, ctx.userId),
      ]);
      if (!user.sageModeId) {
        throw serverError("PRECONDITION_FAILED", "You do not have a sage mode");
      }
      if (user.sageModeId === roll?.sageModeId) {
        await updateSageMode(ctx.drizzle, user, null, 0, "SageMode Removed");
        return { success: true, message: "Sage Mode removed for free" };
      } else {
        if (user.reputationPoints < REMOVAL_COST) {
          return errorResponse("You do not have enough reputation points");
        }
        await updateSageMode(ctx.drizzle, user, null, REMOVAL_COST, "SageMode Removed");
        return { success: true, message: `Sage Mode removed for ${REMOVAL_COST} reps` };
      }
    }),

  // Purchase a sage mode for session user
  purchaseSageMode: protectedProcedure
    .input(z.object({ sageModeId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, mode] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchSageMode(ctx.drizzle, input.sageModeId),
      ]);
      if (!mode) return errorResponse("Sage Mode does not exist");
      if (user.sageModeId) {
        return errorResponse("Already have sage mode, please remove first");
      }
      if (SAGE_MODE_COST[mode.rank] > user.reputationPoints) {
        return errorResponse("You do not have enough reputation points");
      }
      if (mode.villageId && mode.villageId !== user.villageId) {
        return errorResponse("Sage Mode does not belong to your village");
      }
      await updateSageMode(
        ctx.drizzle,
        user,
        mode,
        SAGE_MODE_COST[mode.rank],
        `Sage Mode Purchased: ${mode.name}`,
      );
      await ctx.drizzle.insert(sageModeRolls).values({
        id: nanoid(),
        userId: ctx.userId,
        type: "DIRECT",
        sageModeId: mode.id,
        goal: mode.rank,
        used: 1,
      });
      return { success: true, message: "Sage Mode purchased" };
    }),
});

/**
 * Update sage mode of user
 */
export const updateSageMode = async (
  client: DrizzleClient,
  user: UserData,
  mode: SageMode | null,
  repCost: number,
  logMsg: string,
) => {
  const updateResult = await client
    .update(userData)
    .set({
      sageModeId: mode?.id || null,
      reputationPoints: user.reputationPoints - repCost,
    })
    .where(
      and(eq(userData.userId, user.userId), gte(userData.reputationPoints, repCost)),
    );

  if (!updateResult.rowsAffected) {
    throw serverError("BAD_REQUEST", "Unable to update sage mode");
  }

  await client.insert(actionLog).values({
    id: nanoid(),
    userId: user.userId,
    tableName: "user",
    changes: [logMsg],
    relatedId: user.userId,
    relatedMsg: "SageMode Changed",
    relatedImage: user.avatarLight || user.avatar || IMG_AVATAR_DEFAULT,
  });
};

/**
 * Fetch natural sage mode roll of a user
 */
export const fetchNaturalSageModeRoll = async (
  client: DrizzleClient,
  userId: string,
) => {
  return await client.query.sageModeRolls.findFirst({
    where: and(eq(sageModeRolls.userId, userId), eq(sageModeRolls.type, "NATURAL")),
    with: { sageMode: true },
  });
};

/**
 * Fetch user's historic sage modes
 */
export const fetchUserHistoricSageModes = async (
  client: DrizzleClient,
  userId: string,
) => {
  const userRolls = await client.query.sageModeRolls.findMany({
    where: and(eq(sageModeRolls.userId, userId), isNotNull(sageModeRolls.sageModeId)),
    with: { sageMode: { with: { village: true } } },
  });
  const userSageModes = getUnique(userRolls, "sageModeId")
    .filter((roll) => roll.sageMode)
    .map((roll) => roll.sageMode!);
  return userSageModes;
};

/**
 * Fetch monthly sage mode swaps
 */
export const fetchMonthlySageModeSwaps = async (
  client: DrizzleClient,
  userId: string,
) => {
  const results = await client.query.actionLog.findMany({
    where: and(
      eq(actionLog.userId, userId),
      eq(actionLog.tableName, "sageModeSwap"),
      gte(
        actionLog.createdAt,
        secondsFromDate(-SAGE_MODE_SWAP_FREE_DAYS * DAY_S, new Date()),
      ),
    ),
    columns: { id: true, createdAt: true },
  });
  return results;
};

export const fetchSageMode = async (client: DrizzleClient, sageModeId: string) => {
  return await client.query.sageMode.findFirst({
    where: eq(sageMode.id, sageModeId),
  });
};

/** Re-export for callers that imported from the router module */
export { fetchItemSageModeRolls, fetchSageModes, filterRollableSageModes };

/**
 * Get free sage mode swaps based on federal status
 */
export const getFreeSageModeSwaps = (
  federalStatus: "NONE" | "NORMAL" | "SILVER" | "GOLD",
) => {
  switch (federalStatus) {
    case "GOLD":
      return SAGE_MODE_SWAP_FREE_GOLD;
    case "SILVER":
      return SAGE_MODE_SWAP_FREE_SILVER;
    case "NORMAL":
      return SAGE_MODE_SWAP_FREE_NORMAL;
    default:
      return SAGE_MODE_SWAP_FREE_AMOUNT;
  }
};

/**
 * Get pity rolls for sage mode
 */
export const getSageModePityRolls = (roll: { pityRolls: number; used: number }) => {
  const totalRolls = roll.used + roll.pityRolls;
  const pityThreshold = PITY_SAGE_MODE_ROLLS;
  if (totalRolls >= pityThreshold) {
    return Math.floor(totalRolls / pityThreshold) - roll.pityRolls;
  }
  return 0;
};

/**
 * Build database filters for sage mode queries.
 * @param allowHiddenFilter - When false (public / non–content staff), `hidden` is always
 *   treated as false so clients cannot list hidden sage modes. When true, `input.hidden`
 *   is applied for manual / admin UIs.
 */
export const sageModeDatabaseFilter = (
  input?: SageModeFilteringSchema,
  allowHiddenFilter = false,
) => {
  return [
    ...(input?.name ? [like(sageMode.name, `%${input.name}%`)] : []),
    ...(input?.village ? [eq(sageMode.villageId, input.village)] : []),
    ...(input?.rank ? [eq(sageMode.rank, input.rank)] : [isNotNull(sageMode.rank)]),
    ...(input?.level ? [eq(sageMode.level, input.level)] : []),
    ...(allowHiddenFilter
      ? input?.hidden !== undefined
        ? [eq(sageMode.hidden, input.hidden)]
        : [eq(sageMode.hidden, false)]
      : [eq(sageMode.hidden, false)]),
  ];
};
