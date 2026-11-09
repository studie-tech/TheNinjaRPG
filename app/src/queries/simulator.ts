/**
 * Database access for simulator; authorization and transaction scopes stay in callers.
 */
import { and, desc, eq, lte, notInArray } from "drizzle-orm";
import { damageSimulation } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import type { DamageSimulationState } from "@/validators/combat";

/** Build the `damageSimulation` lookup, using predicates on `id`. */
export const findDamageSimulationById = (client: DrizzleClient, id: string) =>
  client.query.damageSimulation.findFirst({
    where: eq(damageSimulation.id, id),
  });

/** Build the `damageSimulation` listing for `getDamageSimulations`, using predicates on `userId`. */
export const listDamageSimulationForGetDamageSimulations = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.damageSimulation.findMany({
    where: eq(damageSimulation.userId, ctx.userId),
    orderBy: [desc(damageSimulation.createdAt)],
  });

/**
 * Build the `damageSimulation` listing for `createDamageSimulation`, selecting only
 * `id` and `createdAt`, using predicates on `userId`.
 */
export const listDamageSimulationForCreateDamageSimulation = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  maxEntries: 20,
) =>
  client.query.damageSimulation.findMany({
    columns: { id: true, createdAt: true },
    where: eq(damageSimulation.userId, ctx.userId),
    orderBy: [desc(damageSimulation.createdAt)],
    limit: maxEntries,
  });

/** Build the `damageSimulation` insert for `createDamageSimulation`. */
export const insertDamageSimulationForCreateDamageSimulation = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  id: string,
  input: DamageSimulationState,
) =>
  client.insert(damageSimulation).values({
    id,
    userId: ctx.userId,
    state: input,
  });

/**
 * Build the `damageSimulation` pruning for `createDamageSimulation`: deletes the user's
 * entries no newer than `oldestEntry`, except those in `keepIds`.
 */
export const deleteDamageSimulationForCreateDamageSimulation = (
  client: Pick<DrizzleClient, "delete">,
  ctx: { userId: string },
  oldestEntry: { createdAt: Date },
  keepIds: string[],
) =>
  client
    .delete(damageSimulation)
    .where(
      and(
        eq(damageSimulation.userId, ctx.userId),
        lte(damageSimulation.createdAt, oldestEntry.createdAt),
        notInArray(damageSimulation.id, keepIds),
      ),
    );

/**
 * Build the `damageSimulation` update for `updateDamageSimulation`, setting `active` on one
 * of the user's entries, or on all of them when `id` is absent.
 */
export const updateDamageSimulationForUpdateDamageSimulation = (
  client: Pick<DrizzleClient, "update">,
  input: { active: false | true; id?: string | undefined },
  ctx: { userId: string },
) =>
  client
    .update(damageSimulation)
    .set({ active: input.active ? 1 : 0 })
    .where(
      and(
        input.id ? eq(damageSimulation.id, input.id) : undefined,
        eq(damageSimulation.userId, ctx.userId),
      ),
    );

/** Build the `damageSimulation` deletion for `deleteDamageSimulation`, using predicates on `id` and `userId`. */
export const deleteDamageSimulationForDeleteDamageSimulation = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
  ctx: { userId: string },
) =>
  client
    .delete(damageSimulation)
    .where(
      and(eq(damageSimulation.id, input.id), eq(damageSimulation.userId, ctx.userId)),
    );
