import { and, desc, eq, getTableColumns, inArray, like, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { baseServerResponse, serverError } from "@/api/trpc";
import { GameAssetTypes, IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { actionLog, contentTag, gameAsset, gameAssetTag } from "@/drizzle/schema";
import { callDiscordContent } from "@/libs/socials";
import { fetchUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { gameAssetSchema, gameAssetValidator } from "@/validators/asset";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";

export const gameAssetRouter = createTRPCRouter({
  getNameTags: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get game asset name tags" } })
    .input(
      z.object({
        type: z.enum(GameAssetTypes).optional(),
        selected: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const whereClauses = [
        ...(input.type ? [eq(gameAsset.type, input.type)] : []),
        ...(input.selected
          ? input.selected.map((t) => like(gameAsset.name, `%${t}%`))
          : []),
      ];
      const names = await ctx.drizzle.query.gameAsset.findMany({
        columns: { name: true },
        where: and(...whereClauses),
      });

      const tokenSet = new Set<string>();
      for (const n of names) {
        if (!n.name) continue;
        const parts = n.name
          .replace(/\d+/g, "")
          .split(/[-_]+/)
          .map((p) => p.trim())
          .filter((p) => p.length > 1);
        for (const p of parts) tokenSet.add(p);
      }
      const tags = Array.from(tokenSet);
      tags.sort((a, b) => a.localeCompare(b));
      return { tags };
    }),
  getAllNames: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get all game asset names" } })
    .input(
      z.object({
        type: z.enum(GameAssetTypes).optional(),
        folderPrefix: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query
      let assets = await ctx.drizzle.query.gameAsset.findMany({
        columns: { id: true, name: true, image: true, folder: true },
        where: input.type ? eq(gameAsset.type, input.type) : undefined,
      });
      // Filter by folder prefix
      if (input.folderPrefix) {
        assets = assets.map((a) => ({ ...a, name: `${a.folder}/${a.name}` }));
      }
      // Sort by name
      assets.sort((a, b) => a.name.localeCompare(b.name));
      // Return
      return assets;
    }),
  getAllGameAssetContentTagNames: publicProcedure
    .meta({
      mcp: { enabled: true, description: "Get all game asset content tag names" },
    })
    .query(async ({ ctx }) => {
      return await ctx.drizzle
        .selectDistinct({ name: contentTag.name })
        .from(gameAssetTag)
        .innerJoin(contentTag, eq(gameAssetTag.tagId, contentTag.id));
    }),
  getAllFolders: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get all game asset folders" } })
    .query(async ({ ctx }) => {
      // Return unique folders with counts
      return await ctx.drizzle
        .select({
          folder: gameAsset.folder,
          count: sql`count(*)`.mapWith(Number),
        })
        .from(gameAsset)
        .where(sql`${gameAsset.folder} != ''`)
        .groupBy(gameAsset.folder)
        .orderBy(gameAsset.folder);
    }),
  getAll: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get all game assets with filtering" } })
    .input(
      gameAssetSchema.extend({
        cursor: z.number().nullish(),
        limit: z.number().min(1).max(500),
        nameTokens: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input?.cursor ? input.cursor : 0;
      const limit = input?.limit ? input.limit : 100;
      const skip = currentCursor * limit;
      const results = await ctx.drizzle
        .select({ ...getTableColumns(gameAsset) })
        .from(gameAsset)
        .leftJoin(gameAssetTag, eq(gameAsset.id, gameAssetTag.assetId))
        .leftJoin(contentTag, eq(gameAssetTag.tagId, contentTag.id))
        .where(
          and(
            ...(input.name ? [like(gameAsset.name, `%${input.name}%`)] : []),
            ...(input.type
              ? [eq(gameAsset.type, input.type)]
              : [ne(gameAsset.type, "ANIMATION")]),
            ...(input.tags ? [inArray(contentTag.name, input.tags)] : []),
            ...(input.nameTokens
              ? input.nameTokens.map((t) => like(gameAsset.name, `%${t}%`))
              : []),
            ...(input.folder ? [like(gameAsset.folder, `%${input.folder}%`)] : []),
          ),
        )
        .groupBy(gameAsset.id)
        .orderBy(desc(gameAsset.name))
        .limit(limit)
        .offset(skip);

      const nextCursor = results.length < limit ? null : currentCursor + 1;
      return {
        data: results,
        nextCursor: nextCursor,
      };
    }),
  getSceneAssets: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get scene assets by IDs" } })
    .input(z.object({ assetIds: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      return await ctx.drizzle.query.gameAsset.findMany({
        where: inArray(gameAsset.id, input.assetIds),
      });
    }),
  get: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get a game asset by ID" } })
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await fetchgameAsset(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "gameAsset not found");
      }
      return result;
    }),
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: gameAssetValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const entry = await fetchgameAsset(ctx.drizzle, input.id);
      if (entry && canChangeContent(user.role)) {
        // Calculate diff
        const diff = calculateContentDiff(entry, {
          id: entry.id,
          createdAt: entry.createdAt,
          ...input.data,
        });
        // Update database
        await Promise.all([
          ctx.drizzle
            .update(gameAsset)
            .set(input.data)
            .where(eq(gameAsset.id, entry.id)),
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "gameAsset",
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
        return { success: false, message: `Not allowed to edit gameAsset` };
      }
    }),
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (canChangeContent(user.role)) {
      const id = nanoid();
      await ctx.drizzle.insert(gameAsset).values({
        id: id,
        name: "Placeholder",
        type: "STATIC",
        image: IMG_AVATAR_DEFAULT,
        url: IMG_AVATAR_DEFAULT,
        createdByUserId: ctx.userId,
      });
      return { success: true, message: id };
    } else {
      return { success: false, message: `Not allowed to create gameAsset` };
    }
  }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const entry = await fetchgameAsset(ctx.drizzle, input.id);
      if (entry && canChangeContent(user.role)) {
        await Promise.all([
          ctx.drizzle.delete(gameAsset).where(eq(gameAsset.id, input.id)),
          ctx.drizzle.insert(actionLog).values({
            id: nanoid(),
            userId: ctx.userId,
            tableName: "gameAsset",
            changes: [`Deleted: ${entry.name}`],
            relatedId: entry.id,
            relatedMsg: `Delete: ${entry.name}`,
            relatedImage: entry.image,
          }),
        ]);
        return { success: true, message: `gameAsset deleted` };
      } else {
        return { success: false, message: `Not allowed to delete gameAsset` };
      }
    }),
});

/**
 * COMMON QUERIES WHICH ARE REUSED
 */

export const fetchgameAsset = async (client: DrizzleClient, id: string) => {
  return await client.query.gameAsset.findFirst({
    where: eq(gameAsset.id, id),
  });
};
