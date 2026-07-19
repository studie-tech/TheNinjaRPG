import { and, eq, gte, isNull, like, sql } from "drizzle-orm";
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
import {
  IMG_AVATAR_DEFAULT,
  REMOVAL_COST,
  SAGE_MODE_DEFAULT_ACTIVATION_MESSAGE,
} from "@/drizzle/constants";
import type { SageMode, UserData } from "@/drizzle/schema";
import { actionLog, sageMode, userData } from "@/drizzle/schema";
import { callDiscordContent } from "@/libs/socials";
import { fetchUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent, canEditBloodline } from "@/utils/permissions";
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
        cursor: z.number().int().nonnegative().nullish(),
        limit: z.number().int().min(1).max(500),
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
      const [result, user] = await Promise.all([
        fetchSageMode(ctx.drizzle, input.id),
        ctx.userId ? fetchUser(ctx.drizzle, ctx.userId) : Promise.resolve(null),
      ]);
      // Hidden modes are staff-only, mirroring the getAll visibility gate; keep them
      // loadable for the staff edit page (create() marks new modes hidden).
      if (!result || (result.hidden && !(user && canChangeContent(user.role)))) {
        throw serverError("NOT_FOUND", "Sage Mode not found");
      }
      return result as Omit<
        typeof result,
        "effects" | "afterEffects" | "level2Effects"
      > & {
        effects: ZodAllTags[];
        afterEffects: ZodAllTags[];
        level2Effects: ZodAllTags[];
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
        battleDescription: SAGE_MODE_DEFAULT_ACTIVATION_MESSAGE,
        effects: [],
        afterEffects: [],
        level: 1,
        hidden: true,
      });
      return { success: true, message: id };
    } else {
      return { success: false, message: `Not allowed to create sage mode` };
    }
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
          level2Effects: input.data.level2Effects.map((e) => {
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

  // Remove a sage mode from session user
  removeSageMode: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!user.sageModeId) {
        throw serverError("PRECONDITION_FAILED", "You do not have a sage mode");
      }
      if (user.reputationPoints < REMOVAL_COST) {
        return errorResponse("You do not have enough reputation points");
      }
      await updateSageMode(ctx.drizzle, user, null, REMOVAL_COST, "SageMode Removed");
      return { success: true, message: `Sage Mode removed for ${REMOVAL_COST} reps` };
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
      reputationPoints: sql`${userData.reputationPoints} - ${repCost}`,
      // Advance the whole-user version so a concurrent claimUserSnapshot CAS detects this write.
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userData.userId, user.userId),
        gte(userData.reputationPoints, repCost),
        // Compare-and-swap on the current mode: if another request already changed
        // it (concurrent swap/purchase/remove), rowsAffected is 0 and we abort rather
        // than double-debit reputation or clobber the other write.
        user.sageModeId
          ? eq(userData.sageModeId, user.sageModeId)
          : isNull(userData.sageModeId),
      ),
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

export const fetchSageMode = async (client: DrizzleClient, sageModeId: string) => {
  return await client.query.sageMode.findFirst({
    where: eq(sageMode.id, sageModeId),
  });
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
    ...(input?.level ? [eq(sageMode.level, input.level)] : []),
    ...(allowHiddenFilter
      ? input?.hidden !== undefined
        ? [eq(sageMode.hidden, input.hidden)]
        : [] // "All Visibility" (default tri-state) — staff see both hidden and visible
      : [eq(sageMode.hidden, false)]),
  ];
};
