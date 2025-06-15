import { z } from "zod";
import { nanoid } from "nanoid";
import { randomInt } from "crypto";
import { eq, or, sql, gte, and, inArray, isNull, isNotNull, like } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import { bloodline, bloodlineRolls, actionLog } from "@/drizzle/schema";
import { userJutsu, jutsu } from "@/drizzle/schema";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "@/api/trpc";
import { serverError, baseServerResponse, errorResponse } from "@/api/trpc";
import { fetchUser, fetchUpdatedUser } from "@/routers/profile";
import { BloodlineValidator } from "@/libs/combat/types";
import { getRandomElement } from "@/utils/array";
import { canChangeContent } from "@/utils/permissions";
import { callDiscordContent } from "@/libs/discord";
import { ROLL_CHANCE, REMOVAL_COST, BLOODLINE_COST } from "@/drizzle/constants";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { calculateContentDiff } from "@/utils/diff";
import { bloodlineFilteringSchema } from "@/validators/bloodline";
import { filterRollableBloodlines, getPityRolls } from "@/libs/bloodline";
import { LetterRanks, PITY_SYSTEM_ENABLED } from "@/drizzle/constants";
import { COST_SWAP_BLOODLINE } from "@/drizzle/constants";
import { BLOODLINE_SWAP_COOLDOWN_HOURS } from "@/drizzle/constants";
import { getUnique } from "@/utils/grouping";
import { canSwapBloodline } from "@/utils/permissions";
import { secondsFromDate, secondsPassed } from "@/utils/time";
import { getTimeLeftStr, getDaysHoursMinutesSeconds } from "@/utils/time";
import type { ZodAllTags } from "@/libs/combat/types";
import type { BloodlineRank, Bloodline, UserData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

export const bloodlineRouter = createTRPCRouter({
  getAllNames: publicProcedure.query(async ({ ctx }) => {
    return await ctx.drizzle.query.bloodline.findMany({
      columns: { id: true, name: true, image: true },
    });
  }),
  getAll: publicProcedure
    .input(
      bloodlineFilteringSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ? input.cursor : 0;
      const skip = currentCursor * input.limit;
      const results = await ctx.drizzle.query.bloodline.findMany({
        with: { village: { columns: { name: true } } },
        where: and(
          ...(input.name ? [like(bloodline.name, `%${input.name}%`)] : []),
          ...(input.classification
            ? [eq(bloodline.statClassification, input.classification)]
            : []),
          ...(input.village ? [eq(bloodline.villageId, input.village)] : []),
          ...(input.stat && input.stat.length > 0
            ? [
                and(
                  ...input.stat.map(
                    (s) =>
                      sql`JSON_SEARCH(${bloodline.effects},'one',${s}) IS NOT NULL`,
                  ),
                ),
              ]
            : []),
          ...(input.effect && input.effect.length > 0
            ? [
                or(
                  ...input.effect.map(
                    (e) =>
                      sql`JSON_SEARCH(${bloodline.effects},'one',${e}) IS NOT NULL`,
                  ),
                ),
              ]
            : []),
          ...[input.rank ? eq(bloodline.rank, input.rank) : isNotNull(bloodline.rank)],
          ...(input.element && input.element.length > 0
            ? [
                and(
                  ...input.element.map(
                    (e) =>
                      sql`JSON_SEARCH(${bloodline.effects},'one',${e},NULL,'$[*].elements') IS NOT NULL`,
                  ),
                ),
              ]
            : []),
          ...(input?.hidden !== undefined
            ? [eq(bloodline.hidden, input.hidden)]
            : [eq(bloodline.hidden, false)]),
        ),
        offset: skip,
        limit: input.limit,
      });
      const nextCursor = results.length < input.limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),
  // Get a specific bloodline
  get: publicProcedure
    .input(z.object({ id: z.string() }))
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
    if (canChangeContent(user.role)) {
      const id = nanoid();
      await ctx.drizzle.insert(bloodline).values({
        id: id,
        name: `New Bloodline - ${id}`,
        image: IMG_AVATAR_DEFAULT,
        description: "New bloodline description",
        effects: [],
        rank: "D",
        hidden: true,
      });
      return { success: true, message: id };
    } else {
      return { success: false, message: `Not allowed to create bloodline` };
    }
  }),
  // Get all bloodlines a user has ever had
  getUserHistoricBloodlines: protectedProcedure.query(async ({ ctx }) => {
    return await fetchUserHistoricBloodlines(ctx.drizzle, ctx.userId);
  }),
  // Swap bloodline of session user
  swapBloodline: protectedProcedure
    .input(z.object({ bloodlineId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [updatedUser, line, historicBloodlines, lastTransfer] = await Promise.all([
        fetchUpdatedUser({
          client: ctx.drizzle,
          userId: ctx.userId,
        }),
        fetchBloodline(ctx.drizzle, input.bloodlineId),
        fetchUserHistoricBloodlines(ctx.drizzle, ctx.userId),
        ctx.drizzle.query.actionLog.findFirst({
          where: and(
            eq(actionLog.userId, ctx.userId),
            eq(actionLog.tableName, "user"),
            eq(actionLog.relatedMsg, "Bloodline Changed"),
          ),
        }),
      ]);
      const user = updatedUser.user;
      // Guards
      if (!user) return errorResponse("User does not exist");
      if (!line) return errorResponse("Bloodline does not exist");
      if (user.bloodlineId === line.id) {
        return errorResponse("You already have this bloodline");
      }
      if (COST_SWAP_BLOODLINE > user.reputationPoints) {
        return errorResponse("Not enough reputation points");
      }
      if (!canSwapBloodline(user.role)) {
        return errorResponse("Not allowed to swap bloodline");
      }
      if (!historicBloodlines.find((b) => b.id === line.id)) {
        return errorResponse("Bloodline is not in your history");
      }
      // Check if cooldown is over
      if (lastTransfer) {
        console.log(lastTransfer);
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

      // Update
      await updateBloodline(
        ctx.drizzle,
        user,
        line,
        COST_SWAP_BLOODLINE,
        `Bloodline Swapped from ${user.bloodline?.name} to ${line.name}`,
      );
      return { success: true, message: "Bloodline swapped" };
    }),
  // Delete a bloodline
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, entry, usersWithBloodline] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBloodline(ctx.drizzle, input.id),
        ctx.drizzle.query.userData.findMany({
          where: and(eq(userData.bloodlineId, input.id), eq(userData.isAi, false)),
        }),
      ]);
      // Derived
      const usernames = usersWithBloodline.map((u) => u.username).join(", ");
      // Guard
      if (!entry) return errorResponse("Bloodline does not exist");
      if (!user) return errorResponse("User does not exist");
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to delete bloodline");
      }
      if (usersWithBloodline.length > 0) {
        return errorResponse(`Bloodline used by users: ${usernames}, cannot delete`);
      }
      // Mutate
      await Promise.all([
        ctx.drizzle.delete(bloodline).where(eq(bloodline.id, input.id)),
        ctx.drizzle
          .update(userData)
          .set({ bloodlineId: null })
          .where(eq(userData.bloodlineId, input.id)),
      ]);
      return { success: true, message: `Bloodline deleted` };
    }),
  // Update a bloodline
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: BloodlineValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const entry = await fetchBloodline(ctx.drizzle, input.id);
      if (entry && canChangeContent(user.role)) {
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
        await ctx.drizzle
          .update(bloodline)
          .set(newData)
          .where(eq(bloodline.id, input.id));
        await ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "bloodline",
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
        return { success: false, message: `Not allowed to edit bloodline` };
      }
    }),
  // Get bloodline roll of a specific user
  getNaturalRolls: protectedProcedure.query(async ({ ctx }) => {
    return (await fetchNaturalBloodlineRoll(ctx.drizzle, ctx.userId)) ?? null;
  }),
  getItemRolls: protectedProcedure.query(async ({ ctx }) => {
    return await fetchItemBloodlineRolls(ctx.drizzle, ctx.userId);
  }),
  // Get statistics about natural bloodline rolls grouped by rank
  getNaturalRollStatistics: publicProcedure.query(async ({ ctx }) => {
    const stats = await ctx.drizzle
      .select({
        rank: bloodline.rank,
        count: sql<number>`count(${bloodlineRolls.id})`,
      })
      .from(bloodlineRolls)
      .leftJoin(bloodline, eq(bloodlineRolls.bloodlineId, bloodline.id))
      .where(eq(bloodlineRolls.type, "NATURAL"))
      .groupBy(bloodline.rank);

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
    const noBloodlineCount = await ctx.drizzle
      .select({
        count: sql<number>`count(${bloodlineRolls.id})`,
      })
      .from(bloodlineRolls)
      .where(
        and(eq(bloodlineRolls.type, "NATURAL"), isNull(bloodlineRolls.bloodlineId)),
      );

    return {
      ...result,
      none: noBloodlineCount[0]?.count || 0,
    };
  }),
  // Roll a bloodline
  roll: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    // Query
    const [user, prevRoll, allBloodlines] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      fetchNaturalBloodlineRoll(ctx.drizzle, ctx.userId),
      fetchBloodlines(ctx.drizzle), // Fetch all bloodlines
    ]);
    // Guard
    if (prevRoll) return errorResponse("You have already rolled a bloodline");
    if (user.status !== "AWAKE") {
      return errorResponse(`Cannot roll bloodline while ${user.status.toLowerCase()}`);
    }
    if (user.rank === "STUDENT") {
      return errorResponse("Academy students cannot roll for bloodlines. You must graduate first.");
    }
    /**
     * Roll a bloodline. Defined like this to make testing of many rolls easier
     * @returns {Promise<{success: boolean, message: string}>}
     */
    const doRoll = async () => {
      const rand = randomInt(0, 1_000_000) / 1_000_000;
      let bloodlineRank: BloodlineRank | undefined = undefined;
      if (rand < ROLL_CHANCE.S) {
        bloodlineRank = "S";
      } else if (rand < ROLL_CHANCE.A) {
        bloodlineRank = "A";
      } else if (rand < ROLL_CHANCE.B) {
        bloodlineRank = "B";
      } else if (rand < ROLL_CHANCE.C) {
        bloodlineRank = "C";
      } else if (rand < ROLL_CHANCE.D) {
        bloodlineRank = "D";
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
          await Promise.all([
            ctx.drizzle
              .update(userData)
              .set({ bloodlineId: randomBloodline.id })
              .where(eq(userData.userId, ctx.userId)),
            ctx.drizzle.insert(bloodlineRolls).values({
              id: nanoid(),
              userId: ctx.userId,
              used: 0,
              bloodlineId: randomBloodline.id,
            }),
          ]);
          return {
            success: true,
            message: `After thorough examination, a bloodline was detected: ${randomBloodline.name}`,
          };
        }
      }
      // If no bloodline was found, proceed with the normal "no bloodline" case
      await ctx.drizzle.insert(bloodlineRolls).values({
        id: nanoid(),
        used: 0,
        userId: ctx.userId,
      });
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
    .input(z.object({ rank: z.enum(LetterRanks).optional().nullish() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Fetch
      const [user, bloodlines, previousRolls] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBloodlines(ctx.drizzle),
        fetchItemBloodlineRolls(ctx.drizzle, ctx.userId),
      ]);
      // Derived
      const bloodlinePool = filterRollableBloodlines({
        bloodlines,
        user,
        previousRolls,
        rank: input.rank,
      });
      // Guard
      if (!PITY_SYSTEM_ENABLED) return errorResponse("Pity system is disabled");
      const prevRoll = previousRolls.find((r) => r.goal === input.rank);
      if (!prevRoll) return errorResponse("No previous roll found");
      const availablePityRolls = getPityRolls(prevRoll);
      if (availablePityRolls <= 0) return errorResponse("No pity rolls available");
      const randomBloodline = getRandomElement(bloodlinePool);
      if (!randomBloodline) return errorResponse("No bloodlines in the pool?");
      // Update roll & user if successfull
      await Promise.all([
        updateBloodline(
          ctx.drizzle,
          user,
          randomBloodline,
          0,
          `Pity roll for ${input.rank}: ${randomBloodline.name}`,
        ),
        ctx.drizzle
          .update(bloodlineRolls)
          .set({
            pityRolls: sql`${bloodlineRolls.pityRolls} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(bloodlineRolls.id, prevRoll.id)),
        ctx.drizzle.insert(bloodlineRolls).values({
          id: nanoid(),
          userId: ctx.userId,
          type: "PITY",
          bloodlineId: randomBloodline.id,
          goal: input.rank,
          used: 1,
        }),
      ]);
      return {
        success: true,
        message: `You have been granted a bloodline: ${randomBloodline.name}`,
      };
    }),
  // Remove a bloodline from session user
  removeBloodline: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      // Query
      const [user, roll] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchNaturalBloodlineRoll(ctx.drizzle, ctx.userId),
      ]);
      // Guard
      if (!user.bloodlineId) {
        throw serverError("PRECONDITION_FAILED", "You do not have a bloodline");
      }
      if (user.bloodlineId === roll?.bloodlineId) {
        await updateBloodline(ctx.drizzle, user, null, 0, "Bloodline Removed");
        return { success: true, message: "Bloodline removed for free" };
      } else {
        if (user.reputationPoints < REMOVAL_COST) {
          throw serverError("FORBIDDEN", "You do not have enough reputation points");
        }
        await updateBloodline(
          ctx.drizzle,
          user,
          null,
          REMOVAL_COST,
          "Bloodline Removed",
        );
        return { success: true, message: `Bloodline removed for ${REMOVAL_COST} reps` };
      }
    }),
  // Purchase a bloodline for session user
  purchaseBloodline: protectedProcedure
    .input(z.object({ bloodlineId: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query
      const [user, line] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBloodline(ctx.drizzle, input.bloodlineId),
      ]);
      // Guard
      if (!line) return errorResponse("Bloodline does not exist");
      if (user.bloodlineId) {
        return errorResponse("Already have bloodline, please remove first");
      }
      if (BLOODLINE_COST[line.rank] > user.reputationPoints) {
        throw serverError("FORBIDDEN", "You do not have enough reputation points");
      }
      if (line.villageId && line.villageId !== user.villageId) {
        return errorResponse("Bloodline does not belong to your village");
      }
      // Update
      await Promise.all([
        updateBloodline(
          ctx.drizzle,
          user,
          line,
          BLOODLINE_COST[line.rank],
          `Bloodline Purchased: ${line.name}`,
        ),
        ctx.drizzle.insert(bloodlineRolls).values({
          id: nanoid(),
          userId: ctx.userId,
          type: "DIRECT",
          bloodlineId: line.id,
          goal: line.rank,
          used: 1,
        }),
      ]);
      return { success: true, message: "Bloodline purchased" };
    }),
});

/**
 * Update bloodline of user, ensuring the current blooline jutsus are unequipped
 */

export const updateBloodline = async (
  client: DrizzleClient,
  user: UserData,
  bloodline: Bloodline | null,
  repCost: number,
  logMsg: string,
) => {
  // Get current bloodline jutsus
  const bloodlineJutsus = user.bloodlineId
    ? (
        await client.query.jutsu.findMany({
          columns: { id: true },
          where: eq(jutsu.bloodlineId, user.bloodlineId),
        })
      ).map((j) => j.id)
    : [];
  // Run queries in parallel
  await Promise.all([
    // Update bloodline jutsus currently being trained
    ...(bloodlineJutsus.length > 0
      ? [
          client
            .update(userJutsu)
            .set({
              level: sql`CASE WHEN finishTraining > NOW() THEN level - 1 ELSE level END`,
              finishTraining: null,
              equipped: 0,
            })
            .where(
              and(
                eq(userJutsu.userId, user.userId),
                inArray(userJutsu.jutsuId, bloodlineJutsus),
              ),
            ),
        ]
      : []),
    // Update user to remove bloodline
    client
      .update(userData)
      .set({
        bloodlineId: bloodline?.id || null,
        reputationPoints: user.reputationPoints - repCost,
      })
      .where(
        and(eq(userData.userId, user.userId), gte(userData.reputationPoints, repCost)),
      ),
    // Create a log entry for this action
    client.insert(actionLog).values({
      id: nanoid(),
      userId: user.userId,
      tableName: "user",
      changes: [logMsg],
      relatedId: user.userId,
      relatedMsg: "Bloodline Changed",
      relatedImage: user.avatarLight || user.avatar || IMG_AVATAR_DEFAULT,
    }),
  ]);
};
/**
 * COMMON QUERIES WHICH ARE REUSED
 */
export const fetchNaturalBloodlineRoll = async (
  client: DrizzleClient,
  userId: string,
) => {
  return await client.query.bloodlineRolls.findFirst({
    where: and(eq(bloodlineRolls.userId, userId), eq(bloodlineRolls.type, "NATURAL")),
    with: { bloodline: true },
  });
};

export const fetchItemBloodlineRolls = async (
  client: DrizzleClient,
  userId: string,
) => {
  return await client.query.bloodlineRolls.findMany({
    where: and(eq(bloodlineRolls.userId, userId), eq(bloodlineRolls.type, "ITEM")),
    with: { bloodline: true },
  });
};

export const fetchUserHistoricBloodlines = async (
  client: DrizzleClient,
  userId: string,
) => {
  // Get all unique bloodlineIds the user has ever rolled
  const userRolls = await client.query.bloodlineRolls.findMany({
    where: and(
      eq(bloodlineRolls.userId, userId),
      isNotNull(bloodlineRolls.bloodlineId),
    ),
    with: { bloodline: { with: { village: true } } },
  });
  const userBloodlines = getUnique(userRolls, "bloodlineId")
    .filter((roll) => roll.bloodline)
    .map((roll) => roll.bloodline!);
  // Return array of bloodline objects
  return userBloodlines;
};

export const fetchBloodline = async (client: DrizzleClient, bloodlineId: string) => {
  return await client.query.bloodline.findFirst({
    where: eq(bloodline.id, bloodlineId),
  });
};

export const fetchBloodlines = async (client: DrizzleClient) => {
  return await client.query.bloodline.findMany({ where: eq(bloodline.hidden, false) });
};
