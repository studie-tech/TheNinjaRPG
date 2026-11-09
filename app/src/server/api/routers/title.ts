import { nanoid } from "nanoid";
import { z } from "zod";
import { editedReason, outdateProposalsFor } from "@/libs/contentReview/outdate";
import { callDiscordContent } from "@/libs/socials";
import { fetchUser } from "@/queries/profile";
import {
  findTitleForGet,
  insertActionLogForArchive,
  insertActionLogForCreate,
  insertActionLogForUpdate,
  insertTitleForCreate,
  listTitleForGetAll,
  listTitleForGetAllNames,
  updateTitleForArchive,
  updateTitleForUpdate,
  updateUserDataForSelect,
} from "@/queries/title";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { idSchema } from "@/validators/misc";
import { TitleValidator } from "@/validators/title";

/** Identify the staff catalog row and validate its complete editable payload. */
const UpdateTitleSchema = z.object({
  id: z.string().min(1),
  data: TitleValidator,
});

/** Null clears the displayed label; the mutation verifies ownership for every selected ID. */
const SelectTitleSchema = z.object({ titleId: z.string().min(1).nullable() });

/** Public reward options, staff catalog management and ownership-guarded label selection. */
export const titleRouter = createTRPCRouter({
  /** Public reward selectors offer only active, staff-authored titles. */
  getAllNames: publicProcedure.query(({ ctx }) => listTitleForGetAllNames(ctx.drizzle)),
  /** Staff can inspect archived catalog entries; private legacy labels stay excluded. */
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!canChangeContent(user.role))
      throw serverError("FORBIDDEN", "Not allowed to manage titles");
    return listTitleForGetAll(ctx.drizzle);
  }),
  /** Authorize the editor read and exclude per-player legacy rows. */
  get: protectedProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const [user, entry] = await Promise.all([
      fetchUser(ctx.drizzle, ctx.userId),
      findTitleForGet(ctx.drizzle, input),
    ]);
    if (!canChangeContent(user.role))
      throw serverError("FORBIDDEN", "Not allowed to manage titles");
    if (!entry) throw serverError("NOT_FOUND", "Title not found");
    return entry;
  }),
  /** Change only the displayed label; null clears it without removing any owned bonus. */
  select: protectedProcedure
    .input(SelectTitleSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Ownership and account eligibility are checked by the write, including archived/legacy ownership.
      const result = await updateUserDataForSelect(ctx.drizzle, input, ctx);
      if (result.rowsAffected === 0) {
        // MySQL may report no changed rows when selecting the current label.
        const user = await fetchUser(ctx.drizzle, ctx.userId);
        if (user.isBanned || user.isAi || user.activeTitleId !== input.titleId)
          return errorResponse("You can only select a title you own");
      }
      return {
        success: true,
        message: input.titleId ? "Title selected" : "Title cleared",
      };
    }),
  /** Create a catalog entry and return its ID for the shared content editor. */
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (user.isBanned || !canChangeContent(user.role))
      return errorResponse("Not allowed to create titles");
    const id = nanoid();
    await Promise.all([
      insertTitleForCreate(ctx.drizzle, id),
      insertActionLogForCreate(ctx.drizzle, ctx, id),
    ]);
    return { success: true, message: id };
  }),
  /** Stop future grants without deleting ownership or its snapshotted bonuses. */
  archive: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findTitleForGet(ctx.drizzle, input),
      ]);
      if (user.isBanned || !canChangeContent(user.role))
        return errorResponse("Not allowed to archive titles");
      if (!entry) return errorResponse("Title not found");
      await Promise.all([
        updateTitleForArchive(ctx.drizzle, entry),
        insertActionLogForArchive(ctx.drizzle, ctx, entry),
      ]);
      await outdateProposalsFor(
        ctx.drizzle,
        "TITLE",
        [entry.id],
        editedReason("TITLE", entry.name, user.username),
      );
      return { success: true, message: "Title archived" };
    }),
  /** Save future award content and outdate proposals based on the previous catalog version. */
  update: protectedProcedure
    .input(UpdateTitleSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findTitleForGet(ctx.drizzle, input),
      ]);
      if (user.isBanned || !canChangeContent(user.role))
        return errorResponse("Not allowed to edit titles");
      if (!entry) return errorResponse("Title not found");
      const diff = calculateContentDiff(entry, { ...entry, ...input.data });
      await Promise.all([
        updateTitleForUpdate(ctx.drizzle, input),
        insertActionLogForUpdate(ctx.drizzle, ctx, entry, input, diff),
      ]);
      await outdateProposalsFor(
        ctx.drizzle,
        "TITLE",
        [entry.id],
        editedReason("TITLE", entry.name, user.username),
      );
      await callDiscordContent(user.username, entry.name, diff, "");
      return { success: true, message: "Title saved" };
    }),
});
