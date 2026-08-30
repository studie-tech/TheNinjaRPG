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

/**
 * PlanetScale surfaces a unique-key collision as a `DatabaseError` whose message carries
 * MySQL's 1062 "Duplicate entry" text; there is no structured code to switch on.
 */
const isDuplicateKeyError = (error: unknown): boolean => {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /duplicate entry|1062/i.test(message);
};

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

  // A purchase recorded against an account that does not exist would be marked granted
  // while crediting nobody, and the retry would then be rejected as a duplicate — the
  // player pays and never receives it. Checking first costs one read on a low-volume path.
  const recipient = await client.query.userData.findFirst({
    columns: { userId: true },
    where: eq(userData.userId, grant.userId),
  });
  if (!recipient) {
    // Throwing makes the webhook return 5xx so RevenueCat retries, which covers replica
    // lag; the alert covers an app_user_id that will never resolve.
    Sentry.captureException(new Error("Store purchase for an unknown user"), {
      level: "error",
      tags: { source: "grantStorePurchase" },
      extra: { transactionId: grant.transactionId, userId: grant.userId },
    });
    throw new Error(`No user ${grant.userId} for transaction ${grant.transactionId}`);
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
  } catch (error) {
    // Only a unique-key collision means "already handled". Swallowing anything else would
    // acknowledge the webhook, stop RevenueCat retrying, and lose a paid grant to what
    // may have been a momentary connection failure.
    if (!isDuplicateKeyError(error)) throw error;
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
    // The purchase row is what makes a retry a no-op, so leaving it behind after a failed
    // grant would permanently lock the player out of what they paid for. Removing it puts
    // the transaction back to un-processed, and rethrowing gets RevenueCat to try again.
    await client
      .delete(storePurchase)
      .where(eq(storePurchase.transactionId, grant.transactionId))
      .catch(() => undefined);
    Sentry.captureException(error, {
      level: "error",
      tags: { source: "grantStorePurchase" },
      extra: { transactionId: grant.transactionId, productId: grant.productId },
    });
    throw error;
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
