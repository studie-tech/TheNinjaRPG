import { and, desc, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { damageSimulation } from "@/drizzle/schema";
import {
  baseServerResponse,
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import { actSchema, statSchema } from "@/validators/combat";
import { idSchema } from "@/validators/misc";
import type { DrizzleClient } from "../../db";

export const simulatorRouter = createTRPCRouter({
  getDamageSimulations: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Get user's damage simulations" } })
    .query(async ({ ctx }) => {
      return await ctx.drizzle.query.damageSimulation.findMany({
        where: eq(damageSimulation.userId, ctx.userId),
        orderBy: [desc(damageSimulation.createdAt)],
      });
    }),
  getDamageSimulation: publicProcedure
    .meta({ mcp: { enabled: true, description: "Get a specific damage simulation" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      return await fetchEntry(ctx.drizzle, input.id);
    }),
  createDamageSimulation: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Create a new damage simulation" } })
    .input(
      z.object({
        attacker: statSchema,
        defender: statSchema,
        action: actSchema,
      }),
    )
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const maxEntries = 20;
      const [current] = await Promise.all([
        ctx.drizzle.query.damageSimulation.findMany({
          columns: { id: true, createdAt: true },
          where: eq(damageSimulation.userId, ctx.userId),
          orderBy: [desc(damageSimulation.createdAt)],
          limit: maxEntries + 1,
        }),
        ctx.drizzle.insert(damageSimulation).values({
          id: nanoid(),
          userId: ctx.userId,
          state: input,
        }),
      ]);
      const lastEntry = current.at(-1);
      if (current.length >= maxEntries && lastEntry) {
        await ctx.drizzle
          .delete(damageSimulation)
          .where(
            and(
              eq(damageSimulation.userId, ctx.userId),
              gt(damageSimulation.createdAt, lastEntry.createdAt),
            ),
          );
      }
      return { success: true, message: "Damage simulation saved" };
    }),
  updateDamageSimulation: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Update damage simulation active state" },
    })
    .input(z.object({ id: z.string().optional(), active: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        await ctx.drizzle
          .update(damageSimulation)
          .set({ active: input.active ? 1 : 0 })
          .where(
            and(
              eq(damageSimulation.id, input.id),
              eq(damageSimulation.userId, ctx.userId),
            ),
          );
      } else {
        await ctx.drizzle
          .update(damageSimulation)
          .set({ active: input.active ? 1 : 0 })
          .where(eq(damageSimulation.userId, ctx.userId));
      }
      return { success: true, message: "Damage simulation updated" };
    }),
  deleteDamageSimulation: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Delete a damage simulation" } })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const entry = await fetchEntry(ctx.drizzle, input.id, ctx.userId);
      const result = await ctx.drizzle
        .delete(damageSimulation)
        .where(eq(damageSimulation.id, entry.id));
      if (result.rowsAffected === 0) {
        throw serverError("NOT_FOUND", "Entry not found");
      }
      return { success: true, message: "Damage simulation deleted" };
    }),
});

export const fetchEntry = async (
  client: DrizzleClient,
  id: string,
  userId?: string,
) => {
  const entry = await client.query.damageSimulation.findFirst({
    where: eq(damageSimulation.id, id),
    orderBy: [desc(damageSimulation.createdAt)],
  });
  if (!entry) {
    throw serverError("NOT_FOUND", "Entry not found");
  }
  if (userId && entry.userId !== userId) {
    throw serverError("UNAUTHORIZED", "Not allowed to access entry");
  }
  return entry;
};
