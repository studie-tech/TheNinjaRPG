import { eq, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { GameAssetTypes } from "@/drizzle/constants";
import { gameAsset } from "@/drizzle/schema";
import {
  deletedReason,
  editedReason,
  outdateProposalsFor,
} from "@/libs/contentReview/outdate";
import { prepareLpcSheet, validateLpcImages } from "@/libs/lpc/import";
import { reservedContentDeletionError } from "@/libs/reservedContent";
import { callDiscordContent } from "@/libs/socials";
import {
  deleteGameAssetForDelete,
  deleteUnreferencedLpcAsset,
  fetchGameAsset,
  insertActionLogForDelete,
  insertActionLogForUpdate,
  insertGameAssetForCreate,
  listGameAssetForGetAllNames,
  listGameAssetForGetNameTags,
  listGameAssetForGetSceneAssets,
  listLpcAssets,
  selectDistinctGameAssetTagForGetAllGameAssetContentTagNames,
  selectGameAssetForGetAll,
  selectGameAssetForGetAllFolders,
  updateGameAssetForUpdate,
} from "@/queries/asset";
import { fetchUser } from "@/queries/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import { invalidateBattlefieldAssets } from "@/server/utils/caches/battlefieldAssets";
import {
  fetchLpcSceneCatalog,
  invalidateLpcSceneCatalog,
} from "@/server/utils/caches/lpcSceneCatalog";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { gameAssetValidator } from "@/validators/asset";
import { lpcLayoutValidator, lpcSheetValidator } from "@/validators/lpcAsset";
import { idSchema } from "@/validators/misc";

/** Public asset discovery and authenticated staff mutations through asset query helpers. */
export const gameAssetRouter = createTRPCRouter({
  /** Publish referenceable artwork, including hidden designs still worn by existing characters. */
  getLpcCatalog: publicProcedure
    .meta({
      mcp: { description: "Get LPC character designs, variants and attribution" },
    })
    .query(({ ctx }) => listLpcAssets(ctx.drizzle)),
  /** Renderers share frame layouts and omit design-editor metadata from their network snapshot. */
  getLpcSceneCatalog: publicProcedure
    .meta({ mcp: { description: "Get the compiled LPC scene artwork catalog" } })
    .query(({ ctx }) => fetchLpcSceneCatalog(ctx.drizzle)),
  /** Prepare immutable image files; only the separate asset save persists their design settings. */
  prepareLpcSheet: protectedProcedure
    .input(
      z.object({
        image: z.url(),
        format: z.enum(["standard", "packed"]),
        layout: lpcLayoutValidator.optional(),
        z: z.number().int().min(-1000).max(1000),
      }),
    )
    .output(baseServerResponse.extend({ sheet: lpcSheetValidator.optional() }))
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned || !canChangeContent(user.role))
        return errorResponse("Not allowed to upload LPC sheets.");
      try {
        return {
          success: true,
          message: "Sheet prepared. Save the design to apply it.",
          sheet: await prepareLpcSheet(input),
        };
      } catch (error) {
        return errorResponse(
          error instanceof Error ? error.message : "Could not process this sheet.",
        );
      }
    }),
  /** Name pieces of matching assets; an empty `exactFolder` selects Unfiled exactly. */
  getNameTags: publicProcedure
    .meta({ mcp: { description: "Get game asset name tags" } })
    .input(
      z.object({
        type: z.enum(GameAssetTypes).optional(),
        selected: z.array(z.string()).optional(),
        exactFolder: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const whereClauses = [
        ...(input.type ? [eq(gameAsset.type, input.type)] : []),
        ...(input.exactFolder !== undefined
          ? [eq(gameAsset.folder, input.exactFolder)]
          : []),
        ...(input.selected
          ? input.selected.map((t) => like(gameAsset.name, `%${t}%`))
          : []),
      ];
      const names = await listGameAssetForGetNameTags(ctx.drizzle, whereClauses);

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
    .meta({ mcp: { description: "Get all game asset names" } })
    .input(
      z.object({
        type: z.enum(GameAssetTypes).optional(),
        folderPrefix: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Query
      let assets = await listGameAssetForGetAllNames(ctx.drizzle, input);
      // Filter by folder prefix
      if (input.folderPrefix) {
        assets = assets.map((a) => ({ ...a, name: `${a.folder}/${a.name}` }));
      }
      // Sort by name
      assets.sort((a, b) => a.name.localeCompare(b.name));
      // Return
      return assets;
    }),
  /** List assigned content tags for discovery and asset filtering. */
  getAllGameAssetContentTagNames: publicProcedure
    .meta({
      mcp: { description: "Get all game asset content tag names" },
    })
    .query(async ({ ctx }) => {
      return await selectDistinctGameAssetTagForGetAllGameAssetContentTagNames(
        ctx.drizzle,
      );
    }),
  getAllFolders: publicProcedure
    .meta({ mcp: { description: "Get all game asset folders" } })
    .input(z.object({ type: z.enum(GameAssetTypes).optional() }).nullish())
    .query(async ({ ctx, input }) => {
      // Return unique folders with counts
      return await selectGameAssetForGetAllFolders(ctx.drizzle, input ?? undefined);
    }),
  getAll: publicProcedure
    .meta({ mcp: { description: "Get all game assets with filtering" } })
    .input(
      z.object({
        name: z.string().optional(),
        tags: z.array(z.string()).optional(),
        type: z.enum(GameAssetTypes).optional(),
        folder: z.string().optional(),
        cursor: z.number().int().min(0).nullish(),
        limit: z.number().int().min(1).max(500),
        nameTokens: z.array(z.string()).optional(),
        includeAnimations: z.boolean().optional(),
        exactFolder: z.string().optional(),
        sort: z.enum(["newest", "oldest", "name-asc", "name-desc"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const currentCursor = input.cursor ?? 0;
      const { limit } = input;
      const skip = currentCursor * limit;
      // Look ahead one row to avoid an empty final page or a separate count query.
      const results = await selectGameAssetForGetAll(
        ctx.drizzle,
        input,
        limit + 1,
        skip,
      );

      const nextCursor = results.length > limit ? currentCursor + 1 : null;
      return {
        data: results.slice(0, limit),
        nextCursor: nextCursor,
      };
    }),
  getSceneAssets: publicProcedure
    .meta({ mcp: { description: "Get scene assets by IDs" } })
    .input(z.object({ assetIds: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      return await listGameAssetForGetSceneAssets(ctx.drizzle, input);
    }),
  get: publicProcedure
    .meta({ mcp: { description: "Get a game asset by ID" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      const result = await fetchGameAsset(ctx.drizzle, input.id);
      if (!result) {
        throw serverError("NOT_FOUND", "gameAsset not found");
      }
      return result;
    }),
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: gameAssetValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchGameAsset(ctx.drizzle, input.id),
      ]);
      if (!entry || !canChangeContent(user.role) || user.isBanned) {
        return errorResponse(`Not allowed to edit gameAsset`);
      }
      if (entry.type === "LPC" && input.data.type !== "LPC")
        return errorResponse("LPC designs must remain LPC assets.");
      if (input.data.type === "LPC" && entry.id.length > 32)
        return errorResponse(
          "LPC design IDs must be at most 32 characters. Create a new LPC asset instead.",
        );
      if (input.data.type === "LPC" && !input.data.lpcConfig)
        return errorResponse("Configure both body styles before saving this design.");
      if (input.data.type !== "LPC" && input.data.lpcConfig)
        return errorResponse("LPC settings require an LPC asset.");
      if (input.data.lpcConfig) {
        try {
          await validateLpcImages(input.data.lpcConfig, entry.lpcConfig);
        } catch (error) {
          return errorResponse(
            error instanceof Error
              ? error.message
              : "Could not validate the sprite sheets.",
          );
        }
      }
      if (input.data.lpcConfig)
        input.data.image =
          input.data.lpcConfig.variants[
            `male/${input.data.lpcConfig.defaultColor}/${input.data.lpcConfig.defaultEyes}`
          ]![0]!.image;
      // Calculate diff
      const diff = calculateContentDiff(entry, {
        id: entry.id,
        createdAt: entry.createdAt,
        ...input.data,
      });
      // Update database
      const writes = await Promise.allSettled([
        updateGameAssetForUpdate(ctx.drizzle, input, entry).then(async () => {
          // Earlier snapshots cannot prove eligibility after overlapping staff writes.
          const caches = await Promise.allSettled([
            entry.type === "LPC" || input.data.type === "LPC"
              ? invalidateLpcSceneCatalog()
              : null,
            invalidateBattlefieldAssets(),
          ]);
          const failed = caches.find((result) => result.status === "rejected");
          if (failed) throw failed.reason;
        }),
        insertActionLogForUpdate(ctx.drizzle, ctx, diff, entry),
      ]);
      const failed = writes.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;
      await outdateProposalsFor(
        ctx.drizzle,
        "GAME_ASSET",
        [entry.id],
        editedReason("GAME_ASSET", entry.name, user.username),
      );
      await callDiscordContent(user.username, entry.name, diff, entry.image);
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),
  create: protectedProcedure
    // Preserve no-input placeholder creation alongside named library creation.
    .input(gameAssetValidator.pick({ name: true, type: true, folder: true }).nullish())
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role) || user.isBanned) {
        return errorResponse(`Not allowed to create gameAsset`);
      }
      const id = nanoid();
      await insertGameAssetForCreate(ctx.drizzle, id, ctx, input ?? undefined);
      if (input?.type === "LPC") await invalidateLpcSceneCatalog();
      return { success: true, message: id };
    }),
  delete: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchGameAsset(ctx.drizzle, input.id),
      ]);
      if (!canChangeContent(user.role) || user.isBanned) {
        return errorResponse(`Not allowed to delete gameAsset`);
      }
      if (!entry) {
        // A prior delete may have committed before its shared invalidation failed.
        await invalidateBattlefieldAssets();
        return errorResponse(`Not allowed to delete gameAsset`);
      }
      const reservedError = reservedContentDeletionError("asset", entry.id);
      if (reservedError) return errorResponse(reservedError);
      if (entry.type === "LPC") {
        const deleted = await deleteUnreferencedLpcAsset(ctx.drizzle, entry.id);
        if (!deleted.rowsAffected)
          return errorResponse(
            "This design is used by an item or variant. Reassign its appearances before deleting it.",
          );
        // Finish shared invalidation before returning an independent log failure.
        const writes = await Promise.allSettled([
          invalidateLpcSceneCatalog(),
          invalidateBattlefieldAssets(),
          insertActionLogForDelete(ctx.drizzle, ctx, entry),
        ]);
        const failed = writes.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
      } else {
        // Finish shared invalidation before returning an independent log failure.
        const writes = await Promise.allSettled([
          deleteGameAssetForDelete(ctx.drizzle, input).then(
            invalidateBattlefieldAssets,
          ),
          insertActionLogForDelete(ctx.drizzle, ctx, entry),
        ]);
        const failed = writes.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
      }
      await outdateProposalsFor(
        ctx.drizzle,
        "GAME_ASSET",
        [entry.id],
        deletedReason("GAME_ASSET", entry.name, user.username),
      );
      return { success: true, message: `gameAsset deleted` };
    }),
});
