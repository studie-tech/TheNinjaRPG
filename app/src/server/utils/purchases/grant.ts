/**
 * Turning a store purchase into reputation or federal status.
 *
 * The receipt insert and the balance/status write are one transaction. The unique index on
 * `StorePurchase.transactionId` is still the idempotency guard, but a failed balance write
 * rolls the receipt back as well, so RevenueCat can retry without either losing or doubling
 * paid value.
 */

import * as Sentry from "@sentry/node";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type FederalStatus,
  FederalStatuses,
  STORE_FEDERAL_PRODUCTS,
  STORE_REP_PRODUCTS,
  type StorePlatform,
} from "@/drizzle/constants";
import { paypalSubscription, storePurchase, userData } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import type { DrizzleClient } from "@/server/db";

export interface StoreGrant {
  userId: string;
  /** The store's transaction identifier. The idempotency key. */
  transactionId: string;
  productId: string;
  store: StorePlatform;
  /** Sandbox purchases are recorded but never granted. */
  isSandbox: boolean;
  /** Start of the billing period/store transaction, not webhook delivery time. */
  purchasedAt: Date;
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

/**
 * Whether sandbox receipts count for this account.
 *
 * Set STORE_SANDBOX_USER_IDS to the demo account App Review is given before submitting;
 * Set it as a release step. Unset, sandbox purchases grant
 * nothing at all, which is the safe default for an ordinary deployment.
 */
export const isSandboxGrantee = (userId: string): boolean =>
  (env.STORE_SANDBOX_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);

const repProduct = (productId: string) =>
  STORE_REP_PRODUCTS.find((product) => product.productId === productId);

const federalProduct = (productId: string) =>
  STORE_FEDERAL_PRODUCTS.find(
    (product) =>
      product.productId === productId || product.androidProductId === productId,
  );

/**
 * Apply a purchase exactly once.
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

  const accepted = !grant.isSandbox || isSandboxGrantee(grant.userId);

  try {
    return await client.transaction(async (tx) => {
      // Lock the recipient before inserting the idempotency row. This both rejects an
      // unknown user and prevents account deletion racing the grant; checking an UPDATE's
      // affected-row count is not enough because setting an already-current federal tier
      // legitimately reports zero changes on MySQL.
      const [recipient] = await tx
        .select({ userId: userData.userId })
        .from(userData)
        .where(eq(userData.userId, grant.userId))
        .for("update");
      if (!recipient) {
        throw new Error(
          `No user ${grant.userId} for transaction ${grant.transactionId}`,
        );
      }

      // Losing this insert means another delivery of the same transaction already ran.
      await tx.insert(storePurchase).values({
        id: nanoid(),
        userId: grant.userId,
        transactionId: grant.transactionId,
        productId: grant.productId,
        store: grant.store,
        reputationPoints: reps?.reputationPoints ?? 0,
        federalStatus: federal?.federalStatus ?? null,
        isSandbox: grant.isSandbox,
        acceptedAt: accepted ? new Date() : null,
        purchasedAt: grant.purchasedAt,
        rawData: grant.raw as never,
      });

      // Recorded for the audit trail, but a sandbox receipt must never move real balances
      // unless it belongs to the explicit TestFlight/App Review allowlist.
      if (!accepted) return { status: "ignored", reason: "Sandbox purchase" };

      if (reps) {
        await tx
          .update(userData)
          .set({
            reputationPoints: sql`${userData.reputationPoints} + ${reps.reputationPoints}`,
            reputationPointsTotal: sql`${userData.reputationPointsTotal} + ${reps.reputationPoints}`,
          })
          .where(eq(userData.userId, grant.userId));
        return { status: "granted", reputationPoints: reps.reputationPoints };
      }

      // One column, two paying sources. A lower store tier must not overwrite a higher
      // PayPal tier the player is still paying for.
      const target = federal?.federalStatus ?? "NONE";
      const floor = await paypalFederalFloor(tx, grant.userId);
      const next = rankOf(target) >= rankOf(floor) ? target : floor;
      await tx
        .update(userData)
        .set({ federalStatus: next })
        .where(eq(userData.userId, grant.userId));
      return { status: "granted", federalStatus: next };
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) return { status: "duplicate" };
    Sentry.captureException(error, {
      level: "error",
      tags: { source: "grantStorePurchase" },
      extra: { transactionId: grant.transactionId, productId: grant.productId },
    });
    throw error;
  }
};

/**
 * Retire a store subscription that has ended, and re-derive the status from what is left.
 *
 * Not a downgrade, and deliberately not a write of `NONE`: the same column backs PayPal
 * and the stores, so this settles the tier from every source that still vouches for one.
 * Usually that is a strict drop, but a player who resubscribed before a late expiry
 * arrived keeps the tier their new receipt paid for, and one whose grant failed part way
 * has it completed here rather than left short.
 *
 * Idempotent: running it twice retires nothing new and computes the same tier.
 */
export interface RevocationScope {
  /** The moment the store says the subscription ended. */
  occurredAt: Date;
  /** The product that expired. Absent only on payloads that do not name one. */
  productId?: string | null;
  /** The store it expired on, so an Apple lapse cannot retire a Google receipt. */
  store?: StorePlatform | null;
}

export const revokeFederalStatus = async (
  client: DrizzleClient,
  userId: string,
  scope: RevocationScope,
): Promise<void> => {
  const { occurredAt, productId, store } = scope;
  // Retire the receipts first. They are what vouches for the tier to /api/cleaner and to
  // every PayPal writer, and a receipt outlives the subscription that produced it — left
  // unstamped they would go on claiming the player is a subscriber for the rest of the
  // window, and would block a later PayPal revocation from taking anything away.
  //
  // Only the receipts that predate the expiry, though. RevenueCat retries for days and can
  // deliver out of order, so an expiry can easily arrive after the player has resubscribed
  // — and retiring the receipt for the subscription they are currently paying for would
  // take the tier away from someone who just bought it back.
  // How far back this expiry reaches.
  //
  // A subscription group allows one active federal subscription per store, so everything on
  // that store at or before the expiring subscription's latest receipt has been superseded
  // by it — an upgrade leaves the receipt it was upgraded from sitting there, and letting
  // that keep vouching would hand the player a free lower tier for the rest of the window.
  // Anything bought after it is a resubscribe, and survives.
  //
  // The event's own timestamp is the fallback for a payload that names no product.
  const spent = productId
    ? await client.query.storePurchase.findFirst({
        columns: { purchasedAt: true },
        where: and(
          eq(storePurchase.userId, userId),
          eq(storePurchase.productId, productId),
          isNotNull(storePurchase.federalStatus),
          // Never past the expiry itself. A player who resubscribes to the same product
          // has a newer receipt for it, and taking that as the cutoff would let a late
          // expiry retire the subscription they are currently paying for.
          lte(storePurchase.purchasedAt, occurredAt),
          ...(store ? [eq(storePurchase.store, store)] : []),
        ),
        orderBy: desc(storePurchase.purchasedAt),
      })
    : undefined;
  const cutoff = spent?.purchasedAt ?? occurredAt;

  await client
    .update(storePurchase)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(storePurchase.userId, userId),
        isNotNull(storePurchase.federalStatus),
        isNull(storePurchase.revokedAt),
        lte(storePurchase.purchasedAt, cutoff),
        // Bounded to the store the expiry came from: the two are billed independently, and
        // the product ids are the same strings on both, so a lapse on one must not retire
        // the other's receipts.
        ...(store ? [eq(storePurchase.store, store)] : []),
      ),
    );
  // Then fall back to whatever still vouches — which is both sources, not just PayPal.
  // The bound above deliberately spares a receipt bought after the expiry, and reading
  // only PayPal here would drop the tier anyway and leave a paying subscriber with a live
  // receipt and nothing to show for it, until their next renewal.
  const paypal = await paypalFederalFloor(client, userId);
  await client
    .update(userData)
    .set({ federalStatus: await federalStatusWithStoreFloor(client, userId, paypal) })
    .where(eq(userData.userId, userId));
};

export interface StoreTransfer {
  fromUserIds: string[];
  toUserIds: string[];
  store: StorePlatform;
}

/**
 * Follow a RevenueCat receipt transfer between identified application users.
 *
 * Only live subscription receipts move. Consumable reputation was already delivered to
 * the purchaser and must never be granted a second time by a restore. Recomputing every
 * affected account makes this operation idempotent when RevenueCat retries the event.
 */
export const transferStorePurchases = async (
  client: DrizzleClient,
  transfer: StoreTransfer,
): Promise<{ destinationUserId: string; rowsAffected: number }> => {
  const fromIds = [...new Set(transfer.fromUserIds.filter(Boolean))];
  const toIds = [...new Set(transfer.toUserIds.filter(Boolean))];
  if (toIds.length === 0) throw new Error("RevenueCat transfer has no destination");

  const destinations = await client
    .select({ userId: userData.userId })
    .from(userData)
    .where(inArray(userData.userId, toIds));
  const [destination] = destinations;
  if (!destination || destinations.length !== 1) {
    throw new Error(
      `RevenueCat transfer resolved ${destinations.length} destination users`,
    );
  }
  const destinationUserId = destination.userId;
  const sourceIds = fromIds.filter((id) => id !== destinationUserId);

  let rowsAffected = 0;
  if (sourceIds.length > 0) {
    const result = await client
      .update(storePurchase)
      .set({ userId: destinationUserId })
      .where(
        and(
          inArray(storePurchase.userId, sourceIds),
          eq(storePurchase.store, transfer.store),
          isNotNull(storePurchase.acceptedAt),
          isNotNull(storePurchase.federalStatus),
          isNull(storePurchase.revokedAt),
        ),
      );
    rowsAffected = result.rowsAffected;
  }

  const knownSources =
    sourceIds.length > 0
      ? await client
          .select({ userId: userData.userId })
          .from(userData)
          .where(inArray(userData.userId, sourceIds))
      : [];
  for (const userId of [...knownSources.map((row) => row.userId), destinationUserId]) {
    const paypal = await paypalFederalFloor(client, userId);
    await client
      .update(userData)
      .set({ federalStatus: await federalStatusWithStoreFloor(client, userId, paypal) })
      .where(eq(userData.userId, userId));
  }

  return { destinationUserId, rowsAffected };
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
      isNotNull(storePurchase.acceptedAt),
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
