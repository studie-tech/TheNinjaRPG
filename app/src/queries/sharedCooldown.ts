import { eq } from "drizzle-orm";
import { combatSharedCooldown } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Load the configured shared cooldowns for staff editing or a battle snapshot. */
export const fetchSharedCooldowns = (client: DrizzleClient) =>
  client.select().from(combatSharedCooldown).orderBy(combatSharedCooldown.tag);

/** Atomically add a tag or change its shared cooldown. */
export const upsertSharedCooldown = (
  client: DrizzleClient,
  input: { tag: string; rounds: number },
) =>
  client
    .insert(combatSharedCooldown)
    .values(input)
    .onDuplicateKeyUpdate({ set: { rounds: input.rounds } });

/** Remove a tag from the shared cooldown configuration. */
export const deleteSharedCooldown = (client: DrizzleClient, tag: string) =>
  client.delete(combatSharedCooldown).where(eq(combatSharedCooldown.tag, tag));
