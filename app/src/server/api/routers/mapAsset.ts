import { nanoid } from "nanoid";
import { z } from "zod";
import { callDiscordContent } from "@/libs/socials";
import {
  deleteMapAssetForDelete,
  fetchMapAsset,
  findMapAssetForGet,
  findMapAssetForUpdate,
  insertActionLogForDelete,
  insertActionLogForUpdate,
  insertMapAssetForCreate,
  listMapAssetForGetAll,
  updateMapAssetForUpdate,
} from "@/queries/mapAsset";
import { fetchUser } from "@/queries/profile";

import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import {
  isStructureAssetUsed,
  notifyMapLocationsChanged,
} from "@/server/utils/mapLocations";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { mapAssetValidator } from "@/validators/mapAsset";
import { idSchema } from "@/validators/misc";

/** Omission preserves decoration defaults; structure creation uses building-sized artwork. */
const createMapAssetSchema = z
  .object({ category: z.enum(["prop", "structure"]) })
  .optional();

export const mapAssetRouter = createTRPCRouter({
  /** Shared decoration and structure sprites; travel refreshes artwork after content edits. */
  getAll: publicProcedure
    .meta({
      mcp: {
        description: "Get all map decoration assets (the shared sprite library)",
      },
    })
    .query(async ({ ctx }) => {
      // Public/MCP-exposed: omit the internal authoring user-id
      return await listMapAssetForGetAll(ctx.drizzle);
    }),
  /** Single map asset by id; throws NOT_FOUND (query, not baseServerResponse) */
  get: publicProcedure.input(idSchema).query(async ({ ctx, input }) => {
    // Public/MCP-exposed: omit the internal authoring user-id
    const entry = await findMapAssetForGet(ctx.drizzle, input);
    if (!entry) throw serverError("NOT_FOUND", "Map asset not found");
    return entry;
  }),
  /**
   * Insert a placeholder asset with a generated unique key (new.asset.<id>)
   * and the default avatar image. The new row's id is returned in `message`,
   * which callers use to open the editor for it.
   */
  create: protectedProcedure
    .input(createMapAssetSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Query + guards
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned) return errorResponse("You are banned");
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to create map assets");
      }
      // Mutation: placeholder row. The key is sanitized to lowercase alphanumerics
      // because map decoration objects reference assets by key (must stay url-safe).
      const id = nanoid();
      await insertMapAssetForCreate(ctx.drizzle, id, input, ctx);
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
        findMapAssetForUpdate(ctx.drizzle, input),
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
      // Mutation: asset update and audit log are independent writes, issued in parallel.
      await Promise.all([
        updateMapAssetForUpdate(ctx.drizzle, input, entry),
        insertActionLogForUpdate(ctx.drizzle, ctx, diff, entry),
      ]);
      await notifyMapLocationsChanged();
      await callDiscordContent(user.username, entry.name, diff, entry.imageUrl);
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),
  /**
   * Reject saved quest/dungeon references before hard deletion; decoration references
   * are skipped at render time. Audit-logged to actionLog.
   */
  delete: protectedProcedure
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries (parallel: editor, target row and saved structure references)
      const [user, entry, inUse] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchMapAsset(ctx.drizzle, input.id),
        isStructureAssetUsed(ctx.drizzle, input.id),
      ]);
      // Guards
      if (user.isBanned) return errorResponse("You are banned");
      if (!entry) return errorResponse("Map asset not found");
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to delete map assets");
      }
      // A concurrent author save can race this preflight. Missing art retains the arrival
      // pin and Inspect action, and staff can repair it by choosing replacement artwork.
      if (inUse)
        return errorResponse(
          "This asset is used by a quest structure or dungeon entrance. Replace those references first.",
        );
      // Mutation: hard-delete + audit log in parallel
      await Promise.all([
        deleteMapAssetForDelete(ctx.drizzle, input),
        insertActionLogForDelete(ctx.drizzle, ctx, entry),
      ]);
      await notifyMapLocationsChanged();
      return { success: true, message: `Deleted ${entry.name}` };
    }),
});
