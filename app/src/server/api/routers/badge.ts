import { and, asc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { actionLog, badge, userBadge, userData } from "@/drizzle/schema";
import { callDiscordContent } from "@/libs/socials";
import { fetchUser } from "@/routers/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { idSchema } from "@/validators/misc";
import {
  BadgeValidator,
  badgeSnapshotSchema,
  updateBadgeSchema,
} from "@/validators/badge";
type BadgeDocument = z.infer<typeof badgeSnapshotSchema>;

type BadgeReceipt = {
  requestId: string;
  actorUserId: string;
  badgeId: string;
  expectedUpdatedAt: string;
  submittedBadge: z.infer<typeof BadgeValidator>;
  previousBadge: BadgeReceiptDocument;
  committedBadge: BadgeReceiptDocument;
  auditId: string;
};

type BadgeReceiptDocument = Omit<BadgeDocument, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

const badgeReceiptDocumentSchema = badgeSnapshotSchema.extend({
  id: z.string().min(1).max(191),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const badgeReceiptSchema = z.object({
  requestId: z.string().uuid(),
  actorUserId: z.string(),
  badgeId: z.string(),
  expectedUpdatedAt: z.string().datetime(),
  submittedBadge: BadgeValidator,
  previousBadge: badgeReceiptDocumentSchema,
  committedBadge: badgeReceiptDocumentSchema,
  auditId: z.string(),
});

const badgeDocument = (entry: BadgeDocument): BadgeDocument => ({
  id: entry.id,
  image: entry.image,
  name: entry.name,
  description: entry.description,
  createdAt: new Date(entry.createdAt),
  updatedAt: new Date(entry.updatedAt),
});

const receiptDocument = (entry: BadgeDocument): BadgeReceiptDocument => ({
  ...badgeDocument(entry),
  createdAt: entry.createdAt.toISOString(),
  updatedAt: entry.updatedAt.toISOString(),
});

const badgeDocumentsMatch = (left: BadgeDocument, right: BadgeDocument) =>
  left.id === right.id &&
  left.image === right.image &&
  left.name === right.name &&
  left.description === right.description &&
  left.createdAt.getTime() === right.createdAt.getTime() &&
  left.updatedAt.getTime() === right.updatedAt.getTime();

const badgeFormDataMatch = (
  left: z.infer<typeof BadgeValidator>,
  right: z.infer<typeof BadgeValidator>,
) =>
  left.image === right.image &&
  left.name === right.name &&
  left.description === right.description;

const receiptToDocument = (entry: BadgeReceiptDocument): BadgeDocument => ({
  ...entry,
  createdAt: new Date(entry.createdAt),
  updatedAt: new Date(entry.updatedAt),
});

const updateBadgeResponseSchema = baseServerResponse.extend({
  requestId: z.string().uuid().optional(),
  actorUserId: z.string().optional(),
  badgeId: z.string().optional(),
  expectedUpdatedAt: z.date().optional(),
  submittedBadge: BadgeValidator.optional(),
  previousBadge: badgeSnapshotSchema.optional(),
  committedBadge: badgeSnapshotSchema.optional(),
});

const affectedRows = (result: unknown) => {
  if (result && typeof result === "object" && "rowsAffected" in result) {
    return Number(result.rowsAffected);
  }
  if (
    Array.isArray(result) &&
    result[0] &&
    typeof result[0] === "object" &&
    "affectedRows" in result[0]
  ) {
    return Number(result[0].affectedRows);
  }
  return 0;
};

export const badgeRouter = createTRPCRouter({
  getAllNames: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get all badge names and images" } })
    .query(async ({ ctx }) => {
      return await ctx.drizzle.query.badge.findMany({
        columns: { id: true, name: true, image: true },
        orderBy: (table, { asc }) => [asc(table.name)],
      });
    }),
  getAll: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get all badges with pagination" } })
    .input(
      z
        .object({
          cursor: z.number().nullish(),
          limit: z.number().min(1).max(500),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input?.cursor ? input.cursor : 0;
      const limit = input?.limit ? input.limit : 100;
      const skip = currentCursor * limit;
      const results = await ctx.drizzle.query.badge.findMany({
        offset: skip,
        limit: limit,
        orderBy: asc(badge.name),
      });
      const nextCursor = results.length < limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),
  get: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get badge by ID" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const result = await fetchBadge(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "Badge not found");
      }
      return result;
    }),
  update: protectedProcedure
    .input(updateBadgeSchema)
    .output(updateBadgeResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const receiptId = `update-badge:${input.requestId}`;
      type Outcome = {
        response: z.infer<typeof updateBadgeResponseSchema>;
        notification?: {
          username: string;
          originalName: string;
          diff: string[];
          image: string;
        };
      };
      const fail = (message: string): Outcome => ({ response: errorResponse(message) });

      let outcome: Outcome;
      try {
        outcome = await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx): Promise<Outcome> => {
            // All content-admin mutations lock actor, target, then receipt in the same order.
            // Statements stay sequential because a transaction uses one physical connection.
            await tx.execute(
              sql`SELECT ${userData.userId} FROM ${userData} WHERE ${userData.userId} = ${ctx.userId} FOR UPDATE`,
            );
            await tx.execute(
              sql`SELECT ${badge.id} FROM ${badge} WHERE ${badge.id} = ${input.id} FOR UPDATE`,
            );
            await tx.execute(
              sql`SELECT ${actionLog.id} FROM ${actionLog} WHERE ${actionLog.id} = ${receiptId} FOR UPDATE`,
            );

            // Authorization is intentionally read after the lock. A role or ban change that
            // committed before this save reached the boundary must be honored by this request.
            const user = await tx.query.userData.findFirst({
              where: eq(userData.userId, ctx.userId),
            });
            const entry = await tx.query.badge.findFirst({
              where: eq(badge.id, input.id),
            });
            const previousRequest = await tx.query.actionLog.findFirst({
              where: eq(actionLog.id, receiptId),
            });

            if (!user) return fail("Updating user not found");
            if (user.isBanned) {
              return fail("You are banned and cannot update badges");
            }
            if (!canChangeContent(user.role)) {
              return fail("Not allowed to edit badge");
            }

            if (previousRequest) {
              const parsedReceipt = badgeReceiptSchema.safeParse(
                previousRequest.changes,
              );
              if (!parsedReceipt.success) {
                return fail("Invalid badge update request ID");
              }
              const receipt: BadgeReceipt = parsedReceipt.data;
              const previousBadge = receiptToDocument(receipt.previousBadge);
              const committedBadge = receiptToDocument(receipt.committedBadge);
              const exactReplay =
                previousRequest.userId === ctx.userId &&
                previousRequest.tableName === "badgeUpdateReceipt" &&
                previousRequest.relatedId === input.id &&
                receipt.requestId === input.requestId &&
                receipt.actorUserId === ctx.userId &&
                receipt.badgeId === input.id &&
                receipt.expectedUpdatedAt === input.expectedUpdatedAt.toISOString() &&
                badgeDocumentsMatch(previousBadge, input.expectedBadge) &&
                badgeFormDataMatch(receipt.submittedBadge, input.data) &&
                entry !== undefined &&
                badgeDocumentsMatch(badgeDocument(entry), committedBadge);
              if (!exactReplay) {
                return fail("Invalid badge update request ID");
              }

              return {
                response: {
                  success: true,
                  message: "Badge update was already saved",
                  requestId: input.requestId,
                  actorUserId: ctx.userId,
                  badgeId: input.id,
                  expectedUpdatedAt: input.expectedUpdatedAt,
                  submittedBadge: input.data,
                  previousBadge,
                  committedBadge,
                },
              };
            }

            if (!entry) return fail("Badge not found");
            const currentBadge = badgeDocument(entry);
            if (
              entry.updatedAt.getTime() !== input.expectedUpdatedAt.getTime() ||
              !badgeDocumentsMatch(currentBadge, input.expectedBadge)
            ) {
              return fail(
                "This badge changed after the editor opened. Refresh it before saving.",
              );
            }

            const badgeWithName = await tx.query.badge.findFirst({
              columns: { id: true },
              where: eq(badge.name, input.data.name),
            });
            if (badgeWithName && badgeWithName.id !== entry.id) {
              return fail("Badge name already exists");
            }

            const diff = calculateContentDiff(entry, {
              ...entry,
              ...input.data,
            });
            if (diff.length === 0) return fail("No badge changes to save");

            const updatedAt = new Date(
              Math.max(Date.now(), entry.updatedAt.getTime() + 1),
            );
            const updateResult = await tx
              .update(badge)
              .set({ ...input.data, updatedAt })
              .where(
                and(
                  eq(badge.id, input.id),
                  eq(badge.updatedAt, input.expectedUpdatedAt),
                ),
              );
            if (affectedRows(updateResult) !== 1) {
              return fail(
                "This badge changed while it was being saved. Refresh it before retrying.",
              );
            }

            const committedBadge: BadgeDocument = {
              ...currentBadge,
              ...input.data,
              updatedAt,
            };
            const auditId = nanoid();
            await tx.insert(actionLog).values({
              id: auditId,
              userId: ctx.userId,
              tableName: "badge",
              changes: diff,
              relatedId: entry.id,
              relatedMsg: `Update: ${entry.name}`,
              relatedImage: entry.image,
            });
            await tx.insert(actionLog).values({
              id: receiptId,
              userId: ctx.userId,
              tableName: "badgeUpdateReceipt",
              changes: {
                requestId: input.requestId,
                actorUserId: ctx.userId,
                badgeId: input.id,
                expectedUpdatedAt: input.expectedUpdatedAt.toISOString(),
                submittedBadge: input.data,
                previousBadge: receiptDocument(currentBadge),
                committedBadge: receiptDocument(committedBadge),
                auditId,
              } satisfies BadgeReceipt,
              relatedId: entry.id,
              relatedMsg: "Updated badge",
              relatedImage: entry.image,
            });

            return {
              response: {
                success: true,
                message: `Data updated: ${diff.join(". ")}`,
                requestId: input.requestId,
                actorUserId: ctx.userId,
                badgeId: input.id,
                expectedUpdatedAt: input.expectedUpdatedAt,
                submittedBadge: input.data,
                previousBadge: currentBadge,
                committedBadge,
              },
              notification: {
                username: user.username,
                originalName: entry.name,
                diff,
                image: entry.image,
              },
            };
          }),
        );
      } catch (error) {
        if (!isMysqlDuplicateKeyError(error)) throw error;
        const collidedReceipt = await ctx.drizzle.query.actionLog.findFirst({
          columns: { id: true },
          where: eq(actionLog.id, receiptId),
        });
        return errorResponse(
          collidedReceipt
            ? "Invalid badge update request ID"
            : "Badge name already exists",
        );
      }

      if (outcome.notification && process.env.NODE_ENV !== "development") {
        const notification = outcome.notification;
        await callDiscordContent(
          notification.username,
          notification.originalName,
          notification.diff,
          notification.image,
        ).catch(() => undefined);
      }
      return outcome.response;
    }),
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (canChangeContent(user.role)) {
      const id = nanoid();
      await ctx.drizzle.insert(badge).values({
        id: id,
        name: `New Badge - ${id}`,
        image: IMG_AVATAR_DEFAULT,
        description: "",
      });
      return { success: true, message: id };
    } else {
      return { success: false, message: `Not allowed to create badge` };
    }
  }),
  delete: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchBadge(ctx.drizzle, input.id),
      ]);
      if (entry && canChangeContent(user.role)) {
        await Promise.all([
          ctx.drizzle.delete(badge).where(eq(badge.id, input.id)),
          ctx.drizzle.delete(userBadge).where(eq(userBadge.badgeId, input.id)),
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "badge",
            changes: [`Deleted: ${entry.name}`],
            relatedId: entry.id,
            relatedMsg: `Delete: ${entry.name}`,
            relatedImage: entry.image,
          }),
        ]);
        return { success: true, message: `Badge deleted` };
      } else {
        return { success: false, message: `Not allowed to delete badge` };
      }
    }),
});

/**
 * COMMON QUERIES WHICH ARE REUSED
 */

export const fetchBadge = async (client: DrizzleClient, id: string) => {
  return await client.query.badge.findFirst({
    where: eq(badge.id, id),
  });
};
