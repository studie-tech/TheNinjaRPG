import { findPurchaseUserSnapshot } from "@/queries/purchases";
import type { DrizzleClient } from "@/server/db";

/** Idempotent delivery may already be in the cache, so confirm absolute saved balances. */
export const getPurchaseUserUpdate = async (client: DrizzleClient, userId: string) => ({
  userPatch: await findPurchaseUserSnapshot(client, userId),
  userDelta: {},
});
