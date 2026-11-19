import { nanoid } from "nanoid";
import { z } from "zod";
import { editedReason, outdateProposalsFor } from "@/libs/contentReview/outdate";
import {
  nextSplashChangeAt,
  splashEditable,
  visibleSplashAnnouncements,
} from "@/libs/splash";
import { fetchUser } from "@/queries/profile";
import {
  deleteSplashEntryForRollback,
  findSplashEntry,
  findSplashTopic,
  insertSplashEntry,
  listSplashEntries,
  logSplashUpdate,
  setSplashEntryEnabled,
  updateSplashEntry,
} from "@/queries/splash";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import { canChangeContent } from "@/utils/permissions";
import { splashSchema } from "@/validators/splash";

export const splashRouter = createTRPCRouter({
  get: protectedProcedure.query(async ({ ctx }) => {
    const entries = await listSplashEntries(ctx.drizzle, true);
    const now = new Date();
    return {
      announcements: visibleSplashAnnouncements(entries, now),
      nextChangeAt: nextSplashChangeAt(entries, now),
      fetchedAt: now,
    };
  }),
  getForEdit: protectedProcedure
    .meta({
      mcp: {
        description:
          "Search all splash announcements, including disabled topics that must not be suggested again",
      },
    })
    .input(z.object({ search: z.string().trim().max(200).optional() }).nullish())
    .query(async ({ ctx, input }) => {
      const [user, entries] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        listSplashEntries(ctx.drizzle),
      ]);
      if (!canChangeContent(user.role))
        throw serverError("FORBIDDEN", "Only content staff can manage announcements");
      const search = input?.search?.toLowerCase();
      return search
        ? entries.filter((entry) =>
            [entry.name, entry.description, entry.topicKey, entry.href].some((value) =>
              value.toLowerCase().includes(search),
            ),
          )
        : entries;
    }),
  create: protectedProcedure
    .input(z.object({ data: splashSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, topic] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findSplashTopic(ctx.drizzle, input.data.topicKey),
      ]);
      if (user.isBanned || !canChangeContent(user.role))
        return errorResponse("Only content staff can manage announcements");
      if (topic)
        return errorResponse(
          "This topic already exists, including disabled announcements. Edit its existing entry.",
        );
      const id = nanoid();
      try {
        await insertSplashEntry(ctx.drizzle, id, input.data);
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("This topic already exists. Reload the announcements.");
        throw error;
      }
      try {
        await logSplashUpdate(ctx.drizzle, ctx.userId, id, {}, input.data);
      } catch (error) {
        // Creation is incomplete without its audit record; do not publish a partial write.
        await deleteSplashEntryForRollback(ctx.drizzle, id);
        throw error;
      }
      return { success: true, message: id };
    }),
  update: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(191), data: splashSchema }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findSplashEntry(ctx.drizzle, input.id),
      ]);
      if (user.isBanned || !canChangeContent(user.role))
        return errorResponse("Only content staff can manage announcements");
      if (!entry) return errorResponse("Announcement not found");
      if (input.data.topicKey !== entry.topicKey)
        return errorResponse(
          "The topic key stays with its announcement. Create a new entry for a different topic.",
        );
      await updateSplashEntry(ctx.drizzle, input.id, input.data);
      await Promise.all([
        logSplashUpdate(
          ctx.drizzle,
          ctx.userId,
          input.id,
          splashEditable(entry),
          input.data,
        ),
        outdateProposalsFor(
          ctx.drizzle,
          "SPLASH",
          [input.id],
          editedReason("SPLASH", input.data.name, user.username),
        ),
      ]);
      return { success: true, message: "Announcement saved" };
    }),
  setEnabled: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(191), enabled: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findSplashEntry(ctx.drizzle, input.id),
      ]);
      if (user.isBanned || !canChangeContent(user.role))
        return errorResponse("Only content staff can manage announcements");
      if (!entry) return errorResponse("Announcement not found");
      await setSplashEntryEnabled(ctx.drizzle, input.id, input.enabled);
      await Promise.all([
        logSplashUpdate(
          ctx.drizzle,
          ctx.userId,
          input.id,
          { enabled: entry.enabled },
          { enabled: input.enabled },
        ),
        outdateProposalsFor(
          ctx.drizzle,
          "SPLASH",
          [input.id],
          editedReason("SPLASH", entry.name, user.username),
        ),
      ]);
      return {
        success: true,
        message: input.enabled ? "Announcement enabled" : "Announcement disabled",
      };
    }),
});
