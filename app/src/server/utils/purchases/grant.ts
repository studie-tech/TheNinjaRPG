/**
 * Turning a store purchase into reputation or federal status.
 *
 * The receipt is durable before value moves. A single multi-table UPDATE then claims its
 * `grantedAt` marker and changes the user's balance/status atomically, so retries can finish
 * an interrupted grant without either losing or doubling paid value on PlanetScale.
 */

import * as Sentry from "@sentry/node";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type FederalStatus,
  FederalStatuses,
  STORE_FEDERAL_PRODUCTS,
  STORE_REP_PRODUCTS,
  type StorePlatform,
} from "@/drizzle/constants";
import {
  paypalSubscription,
  storeEntitlementState,
  storePurchase,
  userData,
} from "@/drizzle/schema";
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
  /** Current paid-through time, when the store supplies one. */
  expiresAt?: Date | null;
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
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current === "string") return /duplicate entry|1062/i.test(current);
    if (typeof current !== "object") return false;
    const details = current as {
      cause?: unknown;
      code?: unknown;
      errno?: unknown;
      message?: unknown;
    };
    if (
      details.code === "ER_DUP_ENTRY" ||
      details.errno === 1062 ||
      (typeof details.message === "string" &&
        /duplicate entry|1062/i.test(details.message))
    ) {
      return true;
    }
    current = details.cause;
  }
  return false;
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

  const retireIfExpired = async (
    explicitExpiration: Date | null | undefined,
  ): Promise<boolean> => {
    if (!federal) return false;
    const pastPaidThrough =
      explicitExpiration !== null &&
      explicitExpiration !== undefined &&
      explicitExpiration.getTime() <= Date.now();
    const expiredByEvent = pastPaidThrough
      ? true
      : Boolean(
          await client.query.storeEntitlementState.findFirst({
            columns: { revokedThrough: true },
            where: and(
              eq(storeEntitlementState.userId, grant.userId),
              eq(storeEntitlementState.store, grant.store),
              gte(storeEntitlementState.revokedThrough, grant.purchasedAt),
            ),
          }),
        );
    if (!expiredByEvent) return false;
    await client
      .update(storePurchase)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(storePurchase.transactionId, grant.transactionId),
          isNull(storePurchase.grantedAt),
        ),
      );
    return true;
  };

  const [recipient] = await client
    .select({ userId: userData.userId })
    .from(userData)
    .where(eq(userData.userId, grant.userId));
  if (!recipient) {
    throw new Error(`No user ${grant.userId} for transaction ${grant.transactionId}`);
  }

  let inserted = true;
  try {
    await client.insert(storePurchase).values({
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
      expiresAt: grant.expiresAt ?? null,
      rawData: grant.raw as never,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) inserted = false;
    else {
      Sentry.captureException(error, {
        level: "error",
        tags: { source: "grantStorePurchase" },
        extra: { transactionId: grant.transactionId, productId: grant.productId },
      });
      throw error;
    }
  }

  try {
    const receipt = await client.query.storePurchase.findFirst({
      columns: {
        userId: true,
        productId: true,
        store: true,
        acceptedAt: true,
        grantedAt: true,
        revokedAt: true,
        expiresAt: true,
      },
      where: eq(storePurchase.transactionId, grant.transactionId),
    });
    if (!receipt)
      throw new Error(`Missing receipt ${grant.transactionId} after insert`);
    if (receipt.productId !== grant.productId || receipt.store !== grant.store) {
      throw new Error(
        `Transaction ${grant.transactionId} was replayed with new details`,
      );
    }
    // A TRANSFER may have moved a subscription receipt before an older delivery retries.
    // The destination reconciliation already applied its tier; never move or grant it back.
    if (receipt.userId !== grant.userId) return { status: "duplicate" };
    if (!receipt.acceptedAt) {
      return inserted
        ? { status: "ignored", reason: "Sandbox purchase" }
        : { status: "duplicate" };
    }
    if (receipt.grantedAt) return { status: "duplicate" };
    if (receipt.revokedAt) return { status: "ignored", reason: "Revoked purchase" };
    if (await retireIfExpired(receipt.expiresAt)) {
      return { status: "ignored", reason: "Expired purchase" };
    }

    // PlanetScale cannot wrap the receipt and user in a transaction. Its supported
    // multi-table UPDATE is still one atomic SQL statement: only the delivery that changes
    // grantedAt from null can apply value, while a failed statement leaves both untouched.
    const result = reps
      ? await client.execute(sql`
          UPDATE ${userData}
          INNER JOIN ${storePurchase}
            ON ${storePurchase.userId} = ${userData.userId}
          SET ${storePurchase.grantedAt} = CURRENT_TIMESTAMP(3),
              ${userData.reputationPoints} = ${userData.reputationPoints} + ${reps.reputationPoints},
              ${userData.reputationPointsTotal} = ${userData.reputationPointsTotal} + ${reps.reputationPoints}
          WHERE ${storePurchase.transactionId} = ${grant.transactionId}
            AND ${storePurchase.grantedAt} IS NULL
            AND ${storePurchase.acceptedAt} IS NOT NULL
            AND ${storePurchase.revokedAt} IS NULL
        `)
      : await client.execute(sql`
          UPDATE ${userData}
          INNER JOIN ${storePurchase}
            ON ${storePurchase.userId} = ${userData.userId}
          SET ${storePurchase.grantedAt} = CURRENT_TIMESTAMP(3),
              ${userData.federalStatus} = CASE
                WHEN FIELD(${userData.federalStatus}, 'NONE', 'NORMAL', 'SILVER', 'GOLD') < ${rankOf(federal?.federalStatus ?? "NONE") + 1}
                THEN ${federal?.federalStatus ?? "NONE"}
                ELSE ${userData.federalStatus}
              END
          WHERE ${storePurchase.transactionId} = ${grant.transactionId}
            AND ${storePurchase.grantedAt} IS NULL
            AND ${storePurchase.acceptedAt} IS NOT NULL
            AND ${storePurchase.revokedAt} IS NULL
            AND (${storePurchase.expiresAt} IS NULL OR ${storePurchase.expiresAt} > CURRENT_TIMESTAMP(3))
            AND NOT EXISTS (
              SELECT 1 FROM ${storeEntitlementState}
              WHERE ${storeEntitlementState.userId} = ${storePurchase.userId}
                AND ${storeEntitlementState.store} = ${storePurchase.store}
                AND ${storeEntitlementState.revokedThrough} >= ${storePurchase.purchasedAt}
            )
        `);

    if (result.rowsAffected === 0) {
      const settled = await client.query.storePurchase.findFirst({
        columns: { grantedAt: true, revokedAt: true, expiresAt: true },
        where: eq(storePurchase.transactionId, grant.transactionId),
      });
      if (settled?.grantedAt) return { status: "duplicate" };
      if (settled?.revokedAt) {
        return { status: "ignored", reason: "Revoked purchase" };
      }
      if (await retireIfExpired(settled?.expiresAt)) {
        return { status: "ignored", reason: "Expired purchase" };
      }
      throw new Error(`Could not apply store receipt ${grant.transactionId}`);
    }

    if (reps) return { status: "granted", reputationPoints: reps.reputationPoints };
    const target = federal?.federalStatus ?? "NONE";
    const [updated] = await client
      .select({ federalStatus: userData.federalStatus })
      .from(userData)
      .where(eq(userData.userId, grant.userId));
    return { status: "granted", federalStatus: updated?.federalStatus ?? target };
  } catch (error) {
    Sentry.captureException(error, {
      level: "error",
      tags: { source: "grantStorePurchase" },
      extra: { transactionId: grant.transactionId, productId: grant.productId },
    });
    throw error;
  }
};

export interface StoreExtension {
  userId: string;
  store: StorePlatform;
  productId: string;
  expirationAt: Date;
  transactionId?: string | null;
}

/**
 * Apply a store-granted billing extension to the live subscription receipt.
 *
 * Extensions carry no new purchase value, but their paid-through time is durable evidence
 * for reconciliation. A missing receipt is retryable: RevenueCat can deliver out of order,
 * so its purchase webhook should be allowed to land before this event is acknowledged.
 */
export const extendStoreSubscription = async (
  client: DrizzleClient,
  extension: StoreExtension,
): Promise<void> => {
  const liveReceipt = and(
    eq(storePurchase.userId, extension.userId),
    eq(storePurchase.store, extension.store),
    eq(storePurchase.productId, extension.productId),
    isNotNull(storePurchase.acceptedAt),
    isNotNull(storePurchase.federalStatus),
    isNull(storePurchase.revokedAt),
  );
  const exact = extension.transactionId
    ? await client.query.storePurchase.findFirst({
        columns: { id: true },
        where: and(
          eq(storePurchase.transactionId, extension.transactionId),
          liveReceipt,
        ),
      })
    : undefined;
  const receipt =
    exact ??
    (await client.query.storePurchase.findFirst({
      columns: { id: true },
      where: liveReceipt,
      orderBy: desc(storePurchase.purchasedAt),
    }));
  if (!receipt) {
    throw new Error(
      `No live receipt to extend for ${extension.userId}/${extension.productId}`,
    );
  }

  await client
    .update(storePurchase)
    .set({
      expiresAt: sql`GREATEST(COALESCE(${storePurchase.expiresAt}, ${storePurchase.purchasedAt}), ${extension.expirationAt})`,
    })
    .where(eq(storePurchase.id, receipt.id));

  // The cleaner may have run before a delayed extension arrived. Re-derive immediately
  // so the newly durable entitlement also restores any tier it still pays for.
  const paypal = await paypalFederalFloor(client, extension.userId);
  await setFederalStatusWithStoreFloor(client, extension.userId, paypal);
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
  // A renewal period commonly begins at the exact millisecond the previous period ends.
  // Product-scoped expiry events therefore cover timestamps strictly before occurredAt;
  // using the boundary itself would make a late expiry consume the live renewal.
  const beforeExpiry = new Date(occurredAt.getTime() - 1);
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
          // A renewal can start exactly when the expired period ended, so the boundary is
          // exclusive. Taking an equal timestamp as the cutoff would let a late expiry
          // retire the subscription the player is currently paying for.
          lt(storePurchase.purchasedAt, occurredAt),
          ...(store ? [eq(storePurchase.store, store)] : []),
        ),
        orderBy: desc(storePurchase.purchasedAt),
      })
    : undefined;
  const cutoff = spent?.purchasedAt ?? (productId ? beforeExpiry : occurredAt);

  // Persist the cutoff before touching receipts. If the purchase webhook has not inserted
  // its row yet, or races this handler, the grant's atomic claim checks this watermark and
  // cannot resurrect a subscription period the store has already ended.
  if (store) {
    await client
      .insert(storeEntitlementState)
      .values({
        id: nanoid(),
        userId,
        store,
        revokedThrough: cutoff,
        updatedAt: new Date(),
      })
      .onDuplicateKeyUpdate({
        set: {
          revokedThrough: sql`GREATEST(revokedThrough, ${cutoff})`,
          updatedAt: new Date(),
        },
      });
  }

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
  await setFederalStatusWithStoreFloor(client, userId, paypal);
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
    await setFederalStatusWithStoreFloor(client, userId, paypal);
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
      or(
        gte(storePurchase.expiresAt, new Date()),
        and(
          isNull(storePurchase.expiresAt),
          gte(storePurchase.createdAt, new Date(Date.now() - STORE_WINDOW_MS)),
        ),
      ),
    ),
  });
  return highest(rows.map((row) => row.federalStatus ?? "NONE"));
};

/**
 * Set the shared federal-status column without leaving a gap between reading the store
 * receipts and writing the user. Store grants update the receipt and user in one statement
 * too, so both writers serialize on the user row: whichever runs last sees the other's
 * committed source of truth instead of applying a stale pre-read value.
 */
export const setFederalStatusWithStoreFloor = async (
  client: Pick<DrizzleClient, "execute">,
  userId: string,
  paypalStatus: FederalStatus,
) => {
  const liveStoreReceipt = and(
    eq(storePurchase.userId, userId),
    isNotNull(storePurchase.acceptedAt),
    isNull(storePurchase.revokedAt),
    or(
      gte(storePurchase.expiresAt, new Date()),
      and(
        isNull(storePurchase.expiresAt),
        gte(storePurchase.createdAt, new Date(Date.now() - STORE_WINDOW_MS)),
      ),
    ),
  );
  const hasTier = (tier: FederalStatus) => sql`EXISTS (
    SELECT 1 FROM ${storePurchase}
    WHERE ${liveStoreReceipt}
      AND ${storePurchase.federalStatus} = ${tier}
  )`;
  const paypalRank = rankOf(paypalStatus);

  return await client.execute(sql`
    UPDATE ${userData}
    SET ${userData.federalStatus} = CASE
      WHEN ${paypalRank >= rankOf("GOLD")} OR ${hasTier("GOLD")} THEN 'GOLD'
      WHEN ${paypalRank >= rankOf("SILVER")} OR ${hasTier("SILVER")} THEN 'SILVER'
      WHEN ${paypalRank >= rankOf("NORMAL")} OR ${hasTier("NORMAL")} THEN 'NORMAL'
      ELSE 'NONE'
    END
    WHERE ${userData.userId} = ${userId}
  `);
};
