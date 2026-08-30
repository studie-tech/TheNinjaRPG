/**
 * Turning a store purchase into reputation or federal status.
 *
 * PlanetScale has no transactions, so idempotency comes from the unique index on
 * `StorePurchase.transactionId`: the insert is the guard. A replayed webhook — and
 * RevenueCat retries for days — loses the race to insert and grants nothing, which is
 * exactly the behaviour a duplicate needs. The same reason the PayPal path inserts its
 * transaction row before touching the balance.
 *
 * Because that guard cannot be rolled back, a grant is at-most-once: if the balance write
 * fails the purchase row stays, the webhook 500s, and the retry is refused as a duplicate.
 * That leaves an alert and an audit row for an operator to credit by hand. The alternative
 * — removing the row so the retry can re-apply — turns every write that committed but
 * failed to acknowledge into duplicated currency, which is silent and unrepairable.
 */

import * as Sentry from "@sentry/node";
import { and, eq, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type FederalStatus,
  FederalStatuses,
  STORE_FEDERAL_PRODUCTS,
  STORE_REP_PRODUCTS,
  type StorePlatform,
} from "@/drizzle/constants";
import { paypalSubscription, storePurchase, userData } from "@/drizzle/schema";
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
 * Apply a purchase at most once.
 *
 * Throws when the caller should retry — an unknown recipient, or a balance write that
 * failed — which the webhook turns into a 5xx. Everything it can decide for itself comes
 * back as an outcome.
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

    // One column, two paying sources. A store tier below what a live PayPal subscription
    // entitles the player to must not overwrite it — they are still being billed for the
    // higher one. A store tier at or above it applies as-is, so moving down a tier within
    // the stores still takes effect.
    const target = federal?.federalStatus ?? "NONE";
    const floor = await paypalFederalFloor(client, grant.userId);
    const next = rankOf(target) >= rankOf(floor) ? target : floor;
    await client
      .update(userData)
      .set({ federalStatus: next })
      .where(eq(userData.userId, grant.userId));
    return { status: "granted", federalStatus: next };
  } catch (error) {
    // The purchase row stays. It is the only thing stopping the retry from applying this
    // increment a second time, and a write that commits but fails to acknowledge is
    // indistinguishable from one that never ran. The row plus this alert carry everything
    // needed to credit the player by hand, which is a repairable failure; duplicated
    // currency is not.
    Sentry.captureException(error, {
      level: "error",
      tags: { source: "grantStorePurchase" },
      extra: { transactionId: grant.transactionId, productId: grant.productId },
    });
    throw error;
  }
};

/**
 * Drop federal status when a store subscription lapses. Idempotent, and only ever
 * downgrades.
 *
 * Falls back to what PayPal still entitles the player to rather than clearing outright:
 * the same column backs both, so a store lapse must not cancel a web subscription that is
 * still being paid for.
 */
export const revokeFederalStatus = async (
  client: DrizzleClient,
  userId: string,
): Promise<void> => {
  const floor = await paypalFederalFloor(client, userId);
  await client
    .update(userData)
    .set({ federalStatus: floor })
    .where(eq(userData.userId, userId));
};

/** Where a status sits on the ladder, so two sources can be compared. */
const rankOf = (status: FederalStatus): number => FederalStatuses.indexOf(status);

/**
 * The tier an active PayPal subscription still entitles this player to, or `NONE`.
 *
 * The 31-day window is the one the nightly reconciliation in `/api/cleaner` already uses
 * to decide whether a subscription still counts, so both agree on when PayPal stops
 * vouching for a status.
 */
const paypalFederalFloor = async (
  client: DrizzleClient,
  userId: string,
): Promise<FederalStatus> => {
  const active = await client.query.paypalSubscription.findFirst({
    columns: { federalStatus: true },
    where: and(
      eq(paypalSubscription.affectedUserId, userId),
      eq(paypalSubscription.status, "ACTIVE"),
      gte(
        paypalSubscription.updatedAt,
        new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      ),
    ),
  });
  return active?.federalStatus ?? "NONE";
};
