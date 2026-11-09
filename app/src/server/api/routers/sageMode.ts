import { eq, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getRemoveSageModeUserUpdate } from "@/deltas/sageMode";
import { REMOVAL_COST, SAGE_MODE_MAX_LEVEL } from "@/drizzle/constants";
import { sageMode } from "@/drizzle/schema";

import { callDiscordContent } from "@/libs/socials";
import { fetchActionUser } from "@/queries/actionReadiness";
import { fetchAllGameSettings, fetchUser, fetchViewerRole } from "@/queries/profile";
import {
  deleteSageModeForDelete,
  fetchSageMode,
  findSageModeForUpdate,
  insertActionLogForDelete,
  insertActionLogForRemoveSageMode,
  insertActionLogForUpdate,
  insertSageModeForCreate,
  listSageModeForGetAll,
  listSageModeForGetAllNames,
  listUserDataForDelete,
  updateSageModeForUpdate,
  updateUserDataForDelete,
  updateUserDataForRemoveSageMode,
} from "@/queries/sageMode";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import {
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { setEmptyStringsToNulls } from "@/server/utils/emptyStrings";
import { offsetPage } from "@/server/utils/pagination";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import type { ZodAllTags } from "@/validators/combat";
import { SageModeValidator } from "@/validators/combat";
import { idSchema } from "@/validators/misc";
import { userDeltaResponseSchema } from "@/validators/userCache";

/**
 * Query input for `sageMode.getAll` / `sageModeDatabaseFilter`.
 * `hidden` is a tri-state: `undefined` = all (staff only), `true`/`false` = that set.
 */
const sageModeFilteringSchema = z.object({
  name: z.string().max(256).optional(),
  village: z.string().optional(),
  level: z.coerce.number().min(1).max(SAGE_MODE_MAX_LEVEL).optional(),
  hidden: z.boolean().optional(),
});

type SageModeFilteringSchema = z.infer<typeof sageModeFilteringSchema>;

export const sageModeRouter = createTRPCRouter({
  /**
   * Name/image list for quest, objective and staff user-edit pickers. Hidden modes are included
   * only for content staff (`canChangeContent`); everyone else sees visible rows.
   */
  getAllNames: publicProcedure.query(async ({ ctx }) => {
    const viewerRole = await fetchViewerRole(ctx.drizzle, ctx.userId);
    const allowHidden = canChangeContent(viewerRole);
    return await listSageModeForGetAllNames(ctx.drizzle, allowHidden);
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
      const { skip, cursorAfter } = offsetPage(input);
      const viewerRole = await fetchViewerRole(ctx.drizzle, ctx.userId);
      const allowHiddenFilter = canChangeContent(viewerRole);
      const baseFilters = sageModeDatabaseFilter(input, allowHiddenFilter);
      const results = await listSageModeForGetAll(
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

  /**
   * Single catalog row by id, including hidden. Matches bloodline `get` so the
   * equipped-mode removal UI can still load a hidden mode the player already wears.
   */
  get: publicProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const result = await fetchSageMode(ctx.drizzle, input.id);
    if (!result) {
      throw serverError("NOT_FOUND", "Sage Mode not found");
    }
    return result;
  }),

  /** Create a hidden placeholder row and return its id for the staff editor. */
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (user.isBanned)
      return errorResponse("You are banned and cannot perform this action");
    if (canChangeContent(user.role)) {
      const id = nanoid();
      await insertSageModeForCreate(ctx.drizzle, id);
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
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry, usersWithSageMode] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchSageMode(ctx.drizzle, input.id),
        listUserDataForDelete(ctx.drizzle, input),
      ]);
      const usernames = usersWithSageMode.map((u) => u.username).join(", ");
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!entry) return errorResponse("Sage Mode does not exist");
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to delete sage mode");
      }
      if (usersWithSageMode.length > 0) {
        return errorResponse(`Sage Mode used by users: ${usernames}, cannot delete`);
      }
      await Promise.all([
        deleteSageModeForDelete(ctx.drizzle, input),
        updateUserDataForDelete(ctx.drizzle, input),
        insertActionLogForDelete(ctx.drizzle, ctx, entry),
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
        findSageModeForUpdate(ctx.drizzle, input),
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
          updateSageModeForUpdate(ctx.drizzle, newData, input),
          insertActionLogForUpdate(ctx.drizzle, ctx, diff, entry),
        ]);
        await callDiscordContent(user.username, entry.name, diff, entry.image);
        return { success: true, message: `Data updated: ${diff.join(". ")}` };
      } else {
        return { success: false, message: `Not allowed to edit sage mode` };
      }
    }),

  /**
   * Paid unequip for the session user. Compare-and-swap: clears `sageModeId` and debits
   * reputation only while the player is ready, still wears the snapshotted mode and can
   * afford `REMOVAL_COST`. Zero rows means a concurrent change won; do not retry the debit.
   */
  removeSageMode: protectedProcedure
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx }) => {
      const [initialUser, settings] = await Promise.all([
        fetchActionUser(ctx.drizzle, ctx.userId),
        fetchAllGameSettings(ctx.drizzle),
      ]);
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      if (!user.sageModeId) {
        return errorResponse("You do not have a sage mode");
      }
      if (user.reputationPoints < REMOVAL_COST) {
        return errorResponse("You do not have enough reputation points");
      }
      const removed = await updateUserDataForRemoveSageMode(
        ctx.drizzle,
        REMOVAL_COST,
        { userId: user.userId, sageModeId: user.sageModeId },
        readiness,
      );
      if (!removed.rowsAffected) {
        return errorResponse("Unable to update sage mode");
      }
      await insertActionLogForRemoveSageMode(ctx.drizzle, user, "SageMode Removed");
      return actionReadinessResponse(
        {
          success: true,
          message: `Sage Mode removed for ${REMOVAL_COST} reps`,
          ...getRemoveSageModeUserUpdate({ user }),
        },
        readiness,
        ctx.drizzle,
      );
    }),
});

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
