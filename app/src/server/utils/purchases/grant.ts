/**
 * Turning a store purchase into reputation or federal status.
 *
 * PlanetScale has no transactions, so idempotency comes from the unique index on
 * `StorePurchase.transactionId`: the insert is the guard. A replayed webhook — and
 * RevenueCat retries for days — loses the race to insert and grants nothing, which is
 * exactly the behaviour a duplicate needs. The same reason the PayPal path inserts its
 * transaction row before touching the balance.
 *
 * A failed *reputation* grant is therefore at-most-once: the row stays, the webhook 500s,
 * and the retry is refused as a duplicate, leaving an alert and an audit row for an
 * operator to credit by hand. Removing the row instead would turn every write that
 * committed but failed to acknowledge into duplicated currency, which is silent and
 * unrepairable. A failed *federal* grant drops its row, because setting a status twice is
 * the same as setting it once and there is nothing for the guard to protect.
 */

import * as Sentry from "@sentry/node";
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
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
    // Which way to fail depends on what the grant does. Reputation is an increment, and a
    // write that commits but fails to acknowledge is indistinguishable from one that never
    // ran — so the row stays and blocks the retry, leaving an alert and an audit row to
    // credit by hand. Duplicated currency would be silent and unrepairable; this is not.
    //
    // Federal status is a SET of one column to one value. Applying it twice is the same as
    // applying it once, so there is nothing to protect against and no reason to make the
    // player wait for a human: drop the row and let the retry finish the job.
    if (federal) {
      await client
        .delete(storePurchase)
        .where(eq(storePurchase.transactionId, grant.transactionId))
        .catch(() => undefined);
    }
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
 * Every row inside the window counts, not only the ACTIVE ones: `updateSubscription`
 * already writes `NONE` onto any row PayPal reports as finished, so a row that still
 * carries a tier is one the player either paid for or cancelled while keeping the time
 * they had bought. The 31-day window is the one `/api/cleaner` uses, so the two agree on
 * when PayPal stops vouching.
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
      gte(paypalSubscription.updatedAt, new Date(Date.now() - PAYPAL_WINDOW_MS)),
    ),
  });
  return highest(rows.map((row) => row.federalStatus));
};

/**
 * The tier a store subscription still vouches for, clamped by what the player holds now.
 *
 * The clamp is the whole point. `StorePurchase` has no active flag — a row is a receipt,
 * and the row for a subscription that has since expired sits there for the rest of the
 * window. `revokeFederalStatus` has already lowered the player's status when that
 * happened, so taking the lower of the two means an expired store subscription cannot
 * reach back and resurrect the tier it used to grant.
 */
export const storeFederalFloor = async (
  client: DrizzleClient,
  userId: string,
  current: FederalStatus,
): Promise<FederalStatus> => {
  if (current === "NONE") return "NONE";
  const rows = await client.query.storePurchase.findMany({
    columns: { federalStatus: true },
    where: and(
      eq(storePurchase.userId, userId),
      eq(storePurchase.isSandbox, false),
      isNotNull(storePurchase.federalStatus),
      gte(storePurchase.createdAt, new Date(Date.now() - STORE_WINDOW_MS)),
    ),
  });
  const vouched = highest(rows.map((row) => row.federalStatus ?? "NONE"));
  return rankOf(vouched) < rankOf(current) ? vouched : current;
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
  const user = await client.query.userData.findFirst({
    columns: { federalStatus: true },
    where: eq(userData.userId, userId),
  });
  if (!user) return paypalStatus;
  const floor = await storeFederalFloor(client, userId, user.federalStatus);
  return rankOf(paypalStatus) >= rankOf(floor) ? paypalStatus : floor;
};
