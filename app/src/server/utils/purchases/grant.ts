/**
 * Turning a store purchase into reputation or federal status.
 *
 * PlanetScale has no transactions, so idempotency comes from the unique index on
 * `StorePurchase.transactionId`: the insert is the guard. A replayed webhook — and
 * RevenueCat retries for days — loses the race to insert and grants nothing, which is
 * exactly the behaviour a duplicate needs. The same reason the PayPal path inserts its
 * transaction row before touching the balance.
 */

import * as Sentry from "@sentry/node";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type FederalStatus,
  STORE_FEDERAL_PRODUCTS,
  STORE_REP_PRODUCTS,
  type StorePlatform,
} from "@/drizzle/constants";
import { storePurchase, userData } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

export interface StoreGrant {
  userId: string;
  /** The store's transaction identifier. The idempotency key. */
  transactionId: string;
  productId: string;
  store: StorePlatform;
  /** Sandbox purchases are recorded but never granted. */
  isSandbox: boolean;
  raw: unknown;
}

export type GrantOutcome =
  | { status: "granted"; reputationPoints?: number; federalStatus?: FederalStatus }
  | { status: "duplicate" }
  | { status: "ignored"; reason: string };

const repProduct = (productId: string) =>
  STORE_REP_PRODUCTS.find((product) => product.productId === productId);

const federalProduct = (productId: string) =>
  STORE_FEDERAL_PRODUCTS.find((product) => product.productId === productId);

/**
 * Apply a purchase exactly once. Never throws: a webhook that 500s is retried forever, so
 * failures are reported and swallowed.
 */
export const grantStorePurchase = async (
  client: DrizzleClient,
  grant: StoreGrant,
): Promise<GrantOutcome> => {
  const reps = repProduct(grant.productId);
  const federal = federalProduct(grant.productId);
  if (!reps && !federal) {
    return { status: "ignored", reason: `Unknown product ${grant.productId}` };
  }

  try {
    // Losing this insert means another delivery of the same transaction already ran.
    await client.insert(storePurchase).values({
      id: nanoid(),
      userId: grant.userId,
      transactionId: grant.transactionId,
      productId: grant.productId,
      store: grant.store,
      reputationPoints: reps?.reputationPoints ?? 0,
      federalStatus: federal?.federalStatus ?? null,
      isSandbox: grant.isSandbox,
      rawData: grant.raw as never,
    });
  } catch {
    return { status: "duplicate" };
  }

  // Recorded for the audit trail, but a sandbox receipt must never move real balances.
  if (grant.isSandbox) {
    return { status: "ignored", reason: "Sandbox purchase" };
  }

  try {
    if (reps) {
      // An increment rather than a read-modify-write: two grants landing together would
      // otherwise both apply to the same stale balance and one would be lost.
      await client
        .update(userData)
        .set({
          reputationPoints: sql`${userData.reputationPoints} + ${reps.reputationPoints}`,
          reputationPointsTotal: sql`${userData.reputationPointsTotal} + ${reps.reputationPoints}`,
        })
        .where(eq(userData.userId, grant.userId));
      return { status: "granted", reputationPoints: reps.reputationPoints };
    }

    await client
      .update(userData)
      .set({ federalStatus: federal?.federalStatus })
      .where(eq(userData.userId, grant.userId));
    return { status: "granted", federalStatus: federal?.federalStatus };
  } catch (error) {
    // The purchase row is already in place, so a retry would be treated as a duplicate
    // and the player would never get what they paid for. Loud on purpose.
    Sentry.captureException(error, {
      level: "error",
      tags: { source: "grantStorePurchase" },
      extra: { transactionId: grant.transactionId, productId: grant.productId },
    });
    return {
      status: "ignored",
      reason: "Grant failed after the purchase was recorded",
    };
  }
};

/**
 * Drop federal status when a subscription lapses. Idempotent, and only ever downgrades —
 * the web path is the only thing that grants status by other means.
 */
export const revokeFederalStatus = async (
  client: DrizzleClient,
  userId: string,
): Promise<void> => {
  await client
    .update(userData)
    .set({ federalStatus: "NONE" })
    .where(eq(userData.userId, userId));
};
