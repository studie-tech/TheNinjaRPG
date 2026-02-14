import { and, desc, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { damageSimulation } from "@/drizzle/schema";
import { actSchema, statSchema } from "@/validators/combat";
import type { DrizzleClient } from "../../db";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "../trpc";

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
    .input(z.object({ id: z.string() }))
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
    }),
  updateDamageSimulation: protectedProcedure
    .meta({
      mcp: { enabled: true, description: "Update damage simulation active state" },
    })
    .input(z.object({ id: z.string().optional(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.id) {
        return await ctx.drizzle
          .update(damageSimulation)
          .set({ active: input.active ? 1 : 0 })
          .where(
            and(
              eq(damageSimulation.id, input.id),
              eq(damageSimulation.userId, ctx.userId),
            ),
          );
      } else {
        return await ctx.drizzle
          .update(damageSimulation)
          .set({ active: input.active ? 1 : 0 })
          .where(eq(damageSimulation.userId, ctx.userId));
      }
    }),
  deleteDamageSimulation: protectedProcedure
    .meta({ mcp: { enabled: true, description: "Delete a damage simulation" } })
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const entry = await fetchEntry(ctx.drizzle, input.id, ctx.userId);
      const result = await ctx.drizzle
        .delete(damageSimulation)
        .where(eq(damageSimulation.id, entry.id));
      if (result.rowsAffected === 0) {
        throw serverError("NOT_FOUND", "Entry not found");
      }
      return result;
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
