/**
 * Turning a store purchase into reputation or federal status.
 *
 * PlanetScale has no transactions, so idempotency comes from the unique index on
 * `StorePurchase.transactionId`: the insert is the guard. A replayed webhook — and
 * RevenueCat retries for days — loses the race to insert and grants nothing, which is
 * exactly the behaviour a duplicate needs. The same reason the PayPal path inserts its
 * transaction row before touching the balance.
 *
 * A failed grant is therefore at-most-once: the row stays, the webhook 500s, and the retry
 * is refused as a duplicate, leaving an alert and an audit row for an operator to credit by
 * hand. Removing the row instead would turn every write that committed but failed to
 * acknowledge into duplicated currency, and would also throw away the receipt the federal
 * reconciliation reads.
 */

import * as Sentry from "@sentry/node";
import { and, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
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
    // The row stays, whichever kind of grant failed. For reputation it is what stops the
    // retry applying the increment twice, since a write that commits but fails to
    // acknowledge is indistinguishable from one that never ran. For federal status it is
    // also the receipt that vouches for the tier to /api/cleaner and to every PayPal
    // writer, so deleting it to let a retry through would hand the reconciliation a player
    // who looks like they never paid. Either way the row and this alert carry what an
    // operator needs, which is a repairable failure.
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
  occurredAt: Date,
): Promise<void> => {
  // Retire the receipts first. They are what vouches for the tier to /api/cleaner and to
  // every PayPal writer, and a receipt outlives the subscription that produced it — left
  // unstamped they would go on claiming the player is a subscriber for the rest of the
  // window, and would block a later PayPal revocation from taking anything away.
  //
  // Only the receipts that predate the expiry, though. RevenueCat retries for days and can
  // deliver out of order, so an expiry can easily arrive after the player has resubscribed
  // — and retiring the receipt for the subscription they are currently paying for would
  // take the tier away from someone who just bought it back.
  await client
    .update(storePurchase)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(storePurchase.userId, userId),
        isNotNull(storePurchase.federalStatus),
        isNull(storePurchase.revokedAt),
        lte(storePurchase.createdAt, occurredAt),
      ),
    );
  const floor = await paypalFederalFloor(client, userId);
  await client
    .update(userData)
    .set({ federalStatus: floor })
    .where(eq(userData.userId, userId));
};

/** Where a status sits on the ladder, so two sources can be compared. */
const rankOf = (status: FederalStatus): number => FederalStatuses.indexOf(status);

/** The window PayPal reconciliation has always used, and which /api/cleaner mirrors. */
const PAYPAL_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * The same idea for the stores, but wider, because a receipt is the only evidence there is
 * and a subscription can go a long time without producing one. A failed renewal opens a
 * billing-retry grace period — up to 16 days on the App Store and 30 on Play — during
 * which the player is still entitled and no RENEWAL arrives. A monthly cycle plus that
 * grace exceeds 31 days, so the narrower window would strip someone the store still
 * considers a subscriber. Revocation does not depend on this: EXPIRATION revokes on the
 * event, and this window is only the backstop for a webhook that never arrived.
 */
const STORE_WINDOW_MS = 63 * 24 * 60 * 60 * 1000;

const highest = (statuses: FederalStatus[]): FederalStatus =>
  statuses.reduce<FederalStatus>(
    (best, status) => (rankOf(status) > rankOf(best) ? status : best),
    "NONE",
  );

/**
 * The tier PayPal still vouches for, or `NONE`.
 *
 * ACTIVE and inside the window, because `/api/subscriptions` writes the plan's tier onto a
 * row whatever PayPal says its status is, and refreshes `updatedAt` while doing it — so a
 * cancelled subscription still looks current if you go by the tier and the timestamp
 * alone.
 *
 * The maximum rather than an arbitrary row: a player can hold more than one subscription,
 * and picking whichever the database returned first could hand back the cheaper tier and
 * strip what they are paying for.
 */
const paypalFederalFloor = async (
  client: DrizzleClient,
  userId: string,
): Promise<FederalStatus> => {
  const rows = await client.query.paypalSubscription.findMany({
    columns: { federalStatus: true },
    where: and(
      eq(paypalSubscription.affectedUserId, userId),
      eq(paypalSubscription.status, "ACTIVE"),
      gte(paypalSubscription.updatedAt, new Date(Date.now() - PAYPAL_WINDOW_MS)),
    ),
  });
  return highest(rows.map((row) => row.federalStatus));
};

/**
 * The tier a store subscription still vouches for, or `NONE`.
 *
 * A receipt outlives the subscription it paid for, so the row alone cannot say whether the
 * player is still a subscriber — `revokedAt` is what separates the two, stamped by
 * `revokeFederalStatus` when the store reports the subscription has ended. Reading it here
 * rather than inferring from the player's current status is what lets the PayPal writers
 * take a tier away once both sources have finished, while still refusing to take one away
 * from a store subscription that is very much alive.
 */
export const storeFederalFloor = async (
  client: DrizzleClient,
  userId: string,
): Promise<FederalStatus> => {
  const rows = await client.query.storePurchase.findMany({
    columns: { federalStatus: true },
    where: and(
      eq(storePurchase.userId, userId),
      eq(storePurchase.isSandbox, false),
      isNotNull(storePurchase.federalStatus),
      isNull(storePurchase.revokedAt),
      gte(storePurchase.createdAt, new Date(Date.now() - STORE_WINDOW_MS)),
    ),
  });
  return highest(rows.map((row) => row.federalStatus ?? "NONE"));
};

/**
 * What a PayPal writer should set, given the tier PayPal has decided on.
 *
 * `userData.federalStatus` is one column with two paying sources. The PayPal side owns
 * its own tier but not the column, so it has to leave a store subscription that is still
 * being billed alone rather than writing straight over it.
 */
export const federalStatusWithStoreFloor = async (
  client: DrizzleClient,
  userId: string,
  paypalStatus: FederalStatus,
): Promise<FederalStatus> => {
  const floor = await storeFederalFloor(client, userId);
  return rankOf(paypalStatus) >= rankOf(floor) ? paypalStatus : floor;
};
