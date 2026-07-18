import { asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { baseServerResponse, serverError } from "@/api/trpc";
import { actionLog, mapTerrain } from "@/drizzle/schema";
import { callDiscordContent } from "@/libs/socials";
import { fetchUser } from "@/routers/profile";
import type { DrizzleClient } from "@/server/db";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { mapTerrainValidator } from "@/validators/mapTerrain";
import {
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
} from "../trpc";

export const mapTerrainRouter = createTRPCRouter({
  /** The whole terrain library (public; the travel page session-caches it) */
  getAll: publicProcedure
    .meta({
      mcp: {
        enabled: true,
        description: "Get all map terrain kinds (the shared terrain library)",
      },
    })
    .query(async ({ ctx }) => {
      // Public/MCP-exposed: omit the internal authoring user-id
      return await ctx.drizzle.query.mapTerrain.findMany({
        columns: { createdByUserId: false },
        orderBy: [asc(mapTerrain.key)],
      });
    }),
  /** Single terrain by id; throws NOT_FOUND (query, not baseServerResponse) */
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Public/MCP-exposed: omit the internal authoring user-id
      const entry = await ctx.drizzle.query.mapTerrain.findFirst({
        columns: { createdByUserId: false },
        where: eq(mapTerrain.id, input.id),
      });
      if (!entry) throw serverError("NOT_FOUND", "Terrain not found");
      return entry;
    }),
  /**
   * Insert a placeholder terrain with a generated unique key
   * (new.terrain.<id>) and a default green color ramp; the new row's id is
   * returned in `message` so callers can open the editor. Created terrains are
   * never `protected` — only the seeded built-ins are.
   */
  create: protectedProcedure.output(baseServerResponse).mutation(async ({ ctx }) => {
    // Query + guards
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (user.isBanned) return errorResponse("You are banned");
    if (!canChangeContent(user.role)) {
      return errorResponse("Not allowed to create terrain");
    }
    // Mutation: placeholder row. The key is sanitized to lowercase alphanumerics
    // because the world map and combat reference terrains by key (must stay safe).
    const id = nanoid();
    await ctx.drizzle.insert(mapTerrain).values({
      id,
      key: `new.terrain.${id.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      name: "New Terrain",
      colors: ["#48bd48", "#37aa37", "#239623"],
      swatchColor: "#37aa37",
      battleBiome: "ground",
      createdByUserId: ctx.userId,
    });
    return { success: true, message: id };
  }),
  /**
   * Update a terrain. Protected (built-in) terrains cannot have their KEY
   * changed — the world map and combat reference keys directly — but their
   * look/behaviour fields remain editable. Also enforces key uniqueness,
   * audit-logs the diff to actionLog, and Discord-notifies outside development.
   */
  update: protectedProcedure
    .input(z.object({ id: z.string(), data: mapTerrainValidator }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries (parallel: editor, target row, any row already holding the new key)
      const [user, entry, withKey] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchMapTerrain(ctx.drizzle, input.id),
        ctx.drizzle.query.mapTerrain.findFirst({
          columns: { id: true, key: true },
          where: eq(mapTerrain.key, input.data.key),
        }),
      ]);
      // Guards
      if (user.isBanned) return errorResponse("You are banned");
      if (!entry) return errorResponse("Terrain not found");
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to edit terrain");
      }
      // Keys are globally unique, and built-in (protected) keys cannot be renamed
      // because the world map and combat reference them directly
      if (withKey && withKey.id !== entry.id) {
        return errorResponse(`Terrain key ${input.data.key} already exists`);
      }
      if (entry.protected && input.data.key !== entry.key) {
        return errorResponse(
          "Built-in terrain keys are protected (the world map and combat reference them); the look and behaviour can still be edited",
        );
      }
      // Derived: field-level diff for the audit log
      const diff = calculateContentDiff(entry, {
        id: entry.id,
        protected: entry.protected,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        createdByUserId: entry.createdByUserId,
        ...input.data,
      });
      // Mutation: update + audit log in parallel (no transaction on PlanetScale)
      await Promise.all([
        ctx.drizzle
          .update(mapTerrain)
          .set(input.data)
          .where(eq(mapTerrain.id, entry.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "mapTerrain",
          changes: diff,
          relatedId: entry.id,
          relatedMsg: `Update: ${entry.name}`,
          relatedImage: entry.textureUrl,
        }),
      ]);
      // Broadcast the change to the content Discord outside development
      if (process.env.NODE_ENV !== "development") {
        await callDiscordContent(
          user.username,
          entry.name,
          diff,
          entry.textureUrl ?? undefined,
        );
      }
      return { success: true, message: `Data updated: ${diff.join(". ")}` };
    }),
  /**
   * Hard-delete a custom terrain with an actionLog entry. Protected built-in
   * terrains cannot be deleted — the world map and combat fall back to them.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Queries (parallel: editor + target row)
      const [user, entry] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchMapTerrain(ctx.drizzle, input.id),
      ]);
      // Guards (protected built-ins are undeletable — the map/combat fall back to them)
      if (user.isBanned) return errorResponse("You are banned");
      if (!entry) return errorResponse("Terrain not found");
      if (!canChangeContent(user.role)) {
        return errorResponse("Not allowed to delete terrain");
      }
      if (entry.protected) {
        return errorResponse(
          "Built-in terrains cannot be deleted - the world map and combat fall back to them",
        );
      }
      // Mutation: hard-delete + audit log in parallel
      await Promise.all([
        ctx.drizzle.delete(mapTerrain).where(eq(mapTerrain.id, input.id)),
        ctx.drizzle.insert(actionLog).values({
          id: nanoid(),
          userId: ctx.userId,
          tableName: "mapTerrain",
          changes: [`Deleted terrain ${entry.name} (${entry.key})`],
          relatedId: entry.id,
          relatedMsg: `Delete: ${entry.name}`,
          relatedImage: entry.textureUrl,
        }),
      ]);
      return { success: true, message: `Deleted ${entry.name}` };
    }),
});

/** COMMON QUERIES WHICH ARE REUSED */

/** Fetch a terrain row by id; undefined when it does not exist */
export const fetchMapTerrain = async (client: DrizzleClient, id: string) => {
  return await client.query.mapTerrain.findFirst({ where: eq(mapTerrain.id, id) });
};
