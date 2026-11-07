import { and, asc, desc, eq, inArray, lt, ne, or } from "drizzle-orm";
import type { SpriteGenerationStatus } from "@/drizzle/constants";
import { spriteGeneration } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Most recent requests the studio shows; older results stay in the sprite library. */
const GENERATION_LIMIT = 40;
/** Each sync polls gameasset.dev once per row, so a burst cannot exhaust its rate limit. */
const SYNC_LIMIT = 12;

export const listSpriteGenerations = (client: DrizzleClient) =>
  client.query.spriteGeneration.findMany({
    where: ne(spriteGeneration.status, "DISCARDED"),
    with: { createdBy: { columns: { username: true } } },
    orderBy: desc(spriteGeneration.createdAt),
    limit: GENERATION_LIMIT,
  });
export const findSpriteGeneration = (client: DrizzleClient, id: string) =>
  client.query.spriteGeneration.findFirst({ where: eq(spriteGeneration.id, id) });
/**
 * Work to reconcile: anything remote, plus preparation abandoned by a stopped function.
 * Oldest first, so a burst of new requests cannot hold back finished ones.
 */
export const listGenerationsToSync = (client: DrizzleClient, staleBefore: Date) =>
  client.query.spriteGeneration.findMany({
    where: or(
      inArray(spriteGeneration.status, ["QUEUED", "PROCESSING"]),
      and(
        eq(spriteGeneration.status, "PREPARING"),
        lt(spriteGeneration.updatedAt, staleBefore),
      ),
    ),
    orderBy: asc(spriteGeneration.createdAt),
    limit: SYNC_LIMIT,
  });
export const insertSpriteGeneration = (
  client: DrizzleClient,
  input: typeof spriteGeneration.$inferInsert,
) => client.insert(spriteGeneration).values(input);
/**
 * Move a request only from the exact state the caller read, so overlapping syncs
 * and review clicks act once. Callers check `rowsAffected`.
 */
export const transitionSpriteGeneration = (
  client: DrizzleClient,
  from: { id: string; status: SpriteGenerationStatus; updatedAt: Date },
  set: Partial<typeof spriteGeneration.$inferInsert> & { updatedAt: Date },
) =>
  client
    .update(spriteGeneration)
    .set(set)
    .where(
      and(
        eq(spriteGeneration.id, from.id),
        eq(spriteGeneration.status, from.status),
        eq(spriteGeneration.updatedAt, from.updatedAt),
      ),
    );
