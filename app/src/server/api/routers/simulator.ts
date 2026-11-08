import { nanoid } from "nanoid";
import { z } from "zod";
import {
  deleteDamageSimulationForCreateDamageSimulation,
  deleteDamageSimulationForDeleteDamageSimulation,
  findDamageSimulationById,
  insertDamageSimulationForCreateDamageSimulation,
  listDamageSimulationForCreateDamageSimulation,
  listDamageSimulationForGetDamageSimulations,
  updateDamageSimulationForUpdateDamageSimulation,
} from "@/queries/simulator";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { damageSimulationStateSchema } from "@/validators/combat";
import { idSchema } from "@/validators/misc";

export const simulatorRouter = createTRPCRouter({
  getDamageSimulations: protectedProcedure
    .meta({ mcp: { description: "Get user's damage simulations" } })
    .query(async ({ ctx }) => {
      return await listDamageSimulationForGetDamageSimulations(ctx.drizzle, ctx);
    }),
  getDamageSimulation: publicProcedure
    .meta({ mcp: { description: "Get a specific damage simulation" } })
    .input(idSchema)
    .query(async ({ ctx, input }) => {
      return await fetchEntry(ctx.drizzle, input.id);
    }),
  createDamageSimulation: protectedProcedure
    .meta({ mcp: { description: "Create a new damage simulation" } })
    .input(damageSimulationStateSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const maxEntries = 20;
      const id = nanoid();
      const current = await listDamageSimulationForCreateDamageSimulation(
        ctx.drizzle,
        ctx,
        maxEntries,
      );
      // Keep the newest maxEntries - 1 saved entries plus the new one.
      const oldestEntry = current.at(-1);
      const keepIds = [id, ...current.slice(0, maxEntries - 1).map((e) => e.id)];
      await Promise.all([
        insertDamageSimulationForCreateDamageSimulation(ctx.drizzle, ctx, id, input),
        current.length >= maxEntries &&
          oldestEntry &&
          deleteDamageSimulationForCreateDamageSimulation(
            ctx.drizzle,
            ctx,
            oldestEntry,
            keepIds,
          ),
      ]);
      return { success: true, message: "Damage simulation saved" };
    }),
  updateDamageSimulation: protectedProcedure
    .meta({
      mcp: { description: "Update damage simulation active state" },
    })
    .input(z.object({ id: z.string().optional(), active: z.boolean() }))
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      await updateDamageSimulationForUpdateDamageSimulation(ctx.drizzle, input, ctx);
      return { success: true, message: "Damage simulation updated" };
    }),
  deleteDamageSimulation: protectedProcedure
    .meta({ mcp: { description: "Delete a damage simulation" } })
    .input(idSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      // Scoping the delete to the caller covers both a missing and a foreign entry.
      const result = await deleteDamageSimulationForDeleteDamageSimulation(
        ctx.drizzle,
        input,
        ctx,
      );
      if (result.rowsAffected === 0) return errorResponse("Entry not found");
      return { success: true, message: "Damage simulation deleted" };
    }),
});

/** Load a simulation for a public read, or throw NOT_FOUND. */
const fetchEntry = async (client: DrizzleClient, id: string) => {
  const entry = await findDamageSimulationById(client, id);
  if (!entry) {
    throw serverError("NOT_FOUND", "Entry not found");
  }
  return entry;
};
