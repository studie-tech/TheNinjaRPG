import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { baseServerResponse, serverError } from "@/api/trpc";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { actionLog, mapAsset } from "@/drizzle/schema";
import { callDiscordContent } from "@/libs/socials";
import { fetchUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { mapAssetValidator } from "@/validators/mapAsset";
import {
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "../trpc";

export const mapAssetRouter = createTRPCRouter({
  /** The whole decoration sprite library (public; the travel page session-caches it) */
  getAll: publicProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Get all map decoration assets (the shared sprite library)",
      },
    })
    .query(async ({ ctx }) => {
      // Public/MCP-exposed: omit the internal authoring user-id
      return await ctx.drizzle.query.mapAsset.findMany({
        columns: { createdByUserId: false },
        orderBy: [asc(mapAsset.category), asc(mapAsset.key)],
      });
    }),
  /** Single map asset by id; throws NOT_FOUND (query, not baseServerResponse) */
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Public/MCP-exposed: omit the internal authoring user-id
      const entry = await ctx.drizzle.query.mapAsset.findFirst({
        columns: { createdByUserId: false },
        where: eq(mapAsset.id, input.id),
      });
      if (!entry) throw serverError("NOT_FOUND", "Map asset not found");
      return entry;
    }),
  /**
   * Insert a placeholder asset with a generated unique key (new.asset.<id>)
   * and the default avatar image. The new row's id is returned in `message`,
   * which callers use to open the editor for it.
   */
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    // Query + guards
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (user.isBanned) return errorResponse("You are banned");
    if (!canChangeContent(user.role)) {
      return errorResponse("Not allowed to create map assets");
    }
    // Mutation: placeholder row. The key is sanitized to lowercase alphanumerics
    // because map decoration objects reference assets by key (must stay url-safe).
    const id = nanoid();
    await ctx.drizzle.insert(mapAsset).values({
      id,
      key: `new.asset.${id.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      name: "New Map Asset",
      category: "prop",
      imageUrl: IMG_AVATAR_DEFAULT,
      createdByUserId: ctx.userId,
    });
    return { success: true, message: id };
  }),
  /**
   * Update an asset. Enforces global key uniqueness (map decoration objects
   * reference assets by key), audit-logs the field diff to actionLog, and
   * posts the diff to Discord outside development.
   */
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: mapAssetValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries (parallel: editor, target row, any row already holding the new key)
      const [user, entry, withKey] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchMapAsset(ctx.drizzle, input.id),
        ctx.drizzle.query.mapAsset.findFirst({
          columns: { id: true, key: true },
          where: eq(mapAsset.key, input.data.key),
        }),
      ]);
      // Guards
      if (user.isBanned) return errorResponse("You are banned");
      if (!entry) return errorResponse("Map asset not found");
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to edit map assets");
      }
      // Keys are globally unique (maps reference assets by key)
      if (withKey && withKey.id !== entry.id) {
        return errorResponse(`Asset key ${input.data.key} already exists`);
      }
      // Derived: field-level diff for the audit log
      const diff = calculateContentDiff(entry, {
        id: entry.id,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        createdByUserId: entry.createdByUserId,
        ...input.data,
      });
      // Mutation: update + audit log in parallel (no transaction on PlanetScale)
      await Promise.all([
        ctx.drizzle.update(mapAsset).set(input.data).where(eq(mapAsset.id, entry.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "mapAsset",
          changes: diff,
          relatedId: entry.id,
          relatedMsg: `Update: ${entry.name}`,
          relatedImage: entry.imageUrl,
        }),
      ]);
      // Broadcast the change to the content Discord outside development
      if (process.env.NODE_ENV !== "development") {
        await callDiscordContent(user.username, entry.name, diff, entry.imageUrl);
      }
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),
  /**
   * Hard-delete an asset (no soft delete); maps still referencing its key are
   * skipped at render time. Audit-logged to actionLog.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries (parallel: editor + target row)
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchMapAsset(ctx.drizzle, input.id),
      ]);
      // Guards
      if (user.isBanned) return errorResponse("You are banned");
      if (!entry) return errorResponse("Map asset not found");
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to delete map assets");
      }
      // Mutation: hard-delete + audit log in parallel
      await Promise.all([
        ctx.drizzle.delete(mapAsset).where(eq(mapAsset.id, input.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "mapAsset",
          changes: [`Deleted map asset ${entry.name} (${entry.key})`],
          relatedId: entry.id,
          relatedMsg: `Delete: ${entry.name}`,
          relatedImage: entry.imageUrl,
        }),
      ]);
      return { success: true, message: `Deleted ${entry.name}` };
    }),
});

/** COMMON QUERIES WHICH ARE REUSED */

/** Fetch a map asset row by id; undefined when it does not exist */
export const fetchMapAsset = async (client: DrizzleClient, id: string) => {
  return await client.query.mapAsset.findFirst({ where: eq(mapAsset.id, id) });
};
