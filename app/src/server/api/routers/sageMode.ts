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
import type { UserData } from "@/drizzle/schema";
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

/**
 * Strip per-tag duration before writing a SageMode row. Duration lives on
 * `activationRounds` / `afterEffectRounds`; `rounds === 0` is kept so one-shot
 * tags stay instant through `realizeSageTags`.
 *
 * @param effect - Authored tag from the staff editor.
 * @returns The same object, mutated for persist.
 */
const persistSageTagDuration = (effect: ZodAllTags) => {
  if (effect.rounds !== 0) {
    delete effect.rounds;
  }
  delete effect.friendlyFire;
  return effect;
};

export const sageModeRouter = createTRPCRouter({
  /**
   * Name/image list for quest and objective pickers. Hidden modes are included
   * only for content staff (`canChangeContent`); everyone else sees visible rows.
   */
  getAllNames: publicProcedure.query(async ({ ctx }) => {
    const user = ctx.userId
      ? await ctx.drizzle.query.userData.findFirst({
          where: eq(userData.userId, ctx.userId),
          columns: { role: true },
        })
      : null;
    const allowHidden = user ? canChangeContent(user.role) : false;
    return await ctx.drizzle.query.sageMode.findMany({
      columns: { id: true, name: true, image: true },
      where: allowHidden ? undefined : eq(sageMode.hidden, false),
      orderBy: (table, { asc }) => [asc(table.name)],
    });
  }),

  /**
   * Full name/image list including hidden modes, for staff user-edit. Same
   * permission as assigning a bloodline (`canEditBloodline`).
   */
  getAllNamesForEdit: protectedProcedure.query(async ({ ctx }) => {
    const [user, results] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      ctx.drizzle.query.sageMode.findMany({
        columns: { id: true, name: true, image: true },
        orderBy: (table, { asc }) => [asc(table.name)],
      }),
    ]);
    if (!user || !canEditBloodline(user.role)) {
      throw serverError("FORBIDDEN", "Not allowed to list sage modes for editing");
    }
    return results;
  }),

  /**
   * Paginated catalog for the manual list. Non-staff always have `hidden=false`
   * forced; staff may filter by the tri-state visibility control.
   */
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
      const user = ctx.userId
        ? await ctx.drizzle.query.userData.findFirst({
            where: eq(userData.userId, ctx.userId),
            columns: { role: true },
          })
        : null;
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

  /**
   * Single catalog row by id, including hidden. Matches bloodline `get` so the
   * equipped-mode removal UI can still load a hidden mode the player already wears.
   */
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchSageMode(ctx.drizzle, input.id);
      if (!result) {
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

  /** Create a hidden placeholder row and return its id for the staff editor. */
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

  /**
   * Delete a catalog row. Refuses if any non-AI player still has it equipped
   * (up to 10 usernames are listed in the error).
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry, usersWithSageMode] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchSageMode(ctx.drizzle, input.id),
        ctx.drizzle.query.userData.findMany({
          columns: { username: true },
          where: and(eq(userData.sageModeId, input.id), eq(userData.isAi, false)),
          limit: 10,
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

  /**
   * Staff save of a catalog row. Empty strings become nulls via the Drizzle
   * table so nullable columns stay valid; tag `rounds` are persisted through
   * `persistSageTagDuration`.
   */
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
        setEmptyStringsToNulls(
          input.data as unknown as Record<string, unknown>,
          sageMode,
        );
        const newData = {
          ...input.data,
          effects: input.data.effects.map(persistSageTagDuration),
          afterEffects: input.data.afterEffects.map(persistSageTagDuration),
          level2Effects: input.data.level2Effects.map(persistSageTagDuration),
        };
        const diff = calculateContentDiff(entry, {
          id: entry.id,
          updatedAt: entry.updatedAt,
          createdAt: entry.createdAt,
          ...newData,
        });
        await Promise.all([
          ctx.drizzle.update(sageMode).set(newData).where(eq(sageMode.id, input.id)),
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "sageMode",
            changes: diff,
            relatedId: entry.id,
            relatedMsg: `Update: ${entry.name}`,
            relatedImage: entry.image,
          }),
        ]);
        if (process.env.NODE_ENV !== "development") {
          await callDiscordContent(user.username, entry.name, diff, entry.image);
        }
        return { success: true, message: `Data updated: ${diff.join(". ")}` };
      } else {
        return { success: false, message: `Not allowed to edit sage mode` };
      }
    }),

  /**
   * Paid unequip for the session user. Requires AWAKE and `REMOVAL_COST` reps;
   * the write is compare-and-swapped in `updateSageMode`.
   */
  removeSageMode: protectedProcedure
    .output(baseServerResponse)
    .mutation(async ({ ctx }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!user.sageModeId) {
        throw serverError("PRECONDITION_FAILED", "You do not have a sage mode");
      }
      if (user.status !== "AWAKE") {
        return errorResponse(
          `Cannot remove sage mode while ${user.status.toLowerCase()}`,
        );
      }
      if (user.reputationPoints < REMOVAL_COST) {
        return errorResponse("You do not have enough reputation points");
      }
      await updateSageMode(ctx.drizzle, user, REMOVAL_COST, "SageMode Removed");
      return { success: true, message: `Sage Mode removed for ${REMOVAL_COST} reps` };
    }),
});

/**
 * Compare-and-swap unequip: clears `sageModeId` and debits reputation only while
 * the player is AWAKE, still wears the snapshotted mode, and can afford `repCost`.
 * `rowsAffected === 0` means a concurrent change already won — do not retry the debit.
 *
 * @param client - Drizzle client.
 * @param user - Snapshot used for the CAS predicates.
 * @param repCost - Reputation to subtract (`REMOVAL_COST` from the public mutation).
 * @param logMsg - Action-log line written after a successful write.
 */
export const updateSageMode = async (
  client: DrizzleClient,
  user: UserData,
  repCost: number,
  logMsg: string,
) => {
  const updateResult = await client
    .update(userData)
    .set({
      sageModeId: null,
      reputationPoints: sql`${userData.reputationPoints} - ${repCost}`,
      // Advance the whole-user version so a concurrent claimUserSnapshot CAS detects this write.
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userData.userId, user.userId),
        eq(userData.status, "AWAKE"),
        gte(userData.reputationPoints, repCost),
        // Compare-and-swap on the current mode: if another request already changed
        // it, rowsAffected is 0 and we abort rather than double-debit reputation.
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

/**
 * Load one catalog row by id, including hidden. Used by `get` / `update` / `delete`.
 *
 * @param client - Drizzle client.
 * @param sageModeId - `SageMode.id`.
 */
export const fetchSageMode = async (client: DrizzleClient, sageModeId: string) => {
  return await client.query.sageMode.findFirst({
    where: eq(sageMode.id, sageModeId),
  });
};

/**
 * Drizzle `where` clauses for the paginated catalog.
 *
 * @param input - Optional name / village / level / hidden filters from the UI.
 * @param allowHiddenFilter - When false, `hidden` is forced to false so public
 *   clients cannot list hidden modes. When true, `input.hidden` is applied
 *   (unset = staff "All Visibility").
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
