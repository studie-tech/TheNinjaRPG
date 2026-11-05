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
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  type FederalStatus,
  FederalStatuses,
  PAYPAL_PAID_PERIOD_DAYS,
  STORE_FEDERAL_PRODUCTS,
  STORE_PLATFORMS,
  STORE_RECEIPT_FALLBACK_DAYS,
  STORE_REP_PRODUCTS,
  type StorePlatform,
} from "@/drizzle/constants";
import {
  paypalSubscription,
  storePurchase,
  stripePayment,
  userData,
} from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import {
  deleteStoreEntitlementRevocationForMigrateStoreEntitlementRevocations,
  deleteStoreEntitlementStateForMigrateStoreEntitlementStates,
  deleteStorePurchaseTransferForMigrateStorePurchaseTransfers,
  deleteStorePurchaseTransferForMigrateStorePurchaseTransfers2,
  executeResultForApplyStorePurchase,
  executeResultForApplyStorePurchase2,
  executeRowsForReconcileFederalStatuses,
  findStoreEntitlementRevocationForMigrateStoreEntitlementRevocations,
  findStoreEntitlementRevocationForRetireIfExpired,
  findStoreEntitlementStateForApplyStoreTransfer,
  findStoreEntitlementStateForMigrateStoreEntitlementStates,
  findStoreEntitlementStateForRetireIfExpired,
  findStorePurchaseForApplyFederalRevocation,
  findStorePurchaseForApplyFederalRevocation2,
  findStorePurchaseForApplyStoreExtension,
  findStorePurchaseForApplyStoreExtension2,
  findStorePurchaseForApplyStorePurchase,
  findStorePurchaseForApplyStorePurchase2,
  findStorePurchaseForApplyStorePurchase3,
  findStorePurchaseTransferForMigrateStorePurchaseTransfers,
  findStoreUserIdAlias,
  insertStoreEntitlementRevocationForApplyFederalRevocation,
  insertStoreEntitlementStateForApplyFederalRevocation,
  insertStorePurchaseForApplyStorePurchase,
  insertStorePurchaseTransferForApplyStoreTransfer,
  insertStoreUserIdAlias,
  listPaypalSubscriptionForPaypalFederalFloor,
  listStoreEntitlementRevocationForMigrateStoreEntitlementRevocations,
  listStorePurchaseForApplyFederalRevocation,
  listStorePurchaseForApplyStoreExtension,
  listStorePurchaseForApplyStoreExtension2,
  listStorePurchaseForApplyStoreTransfer,
  listStorePurchaseForSettleRecordedLedger,
  listStorePurchaseTransferForMigrateStorePurchaseTransfers,
  listStorePurchaseTransferForTransferChainUserIds,
  listStorePurchaseTransferForTransferPredecessorUserIds,
  listStorePurchaseTransferForTransferredUserId,
  selectStorePurchaseForReconcileStorePurchaseOwner,
  selectStoreUserIds,
  selectUserDataForReconcileFederalStatuses,
  updateStoreEntitlementRevocationForMigrateStoreEntitlementRevocations,
  updateStoreEntitlementRevocationForMigrateStoreEntitlementRevocations2,
  updateStoreEntitlementStateForMigrateStoreEntitlementStates,
  updateStoreEntitlementStateForMigrateStoreEntitlementStates2,
  updateStorePurchaseForApplyFederalRevocation,
  updateStorePurchaseForApplyStoreExtension,
  updateStorePurchaseForReconcileStorePurchaseOwner,
  updateStorePurchaseForRetireIfExpired,
  updateStorePurchaseTransferForMigrateStorePurchaseTransfers,
  updateStorePurchaseTransferForMigrateStorePurchaseTransfers2,
  updateStorePurchaseTransferForMigrateStorePurchaseTransfers3,
  updateUserDataForSetFederalStatusWithStoreFloor,
  userFederalRankSql,
} from "@/queries/purchases";
import type { DrizzleClient } from "@/server/db";
import {
  isMysqlDeadlockError,
  isMysqlDuplicateKeyError,
  retryOnDeadlock,
} from "@/server/utils/mysqlErrors";

import { DAY_S } from "@/utils/time";

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
  | { status: "granted" }
  | { status: "duplicate" }
  | { status: "ignored"; reason: string };

/**
 * Whether sandbox receipts count for this account.
 *
 * Set STORE_SANDBOX_USER_IDS to the demo account App Review is given before submitting;
 * Set it as a release step. Unset, sandbox purchases grant
 * nothing at all, which is the safe default for an ordinary deployment.
 */
const sandboxGranteeUserIds = (): string[] =>
  (env.STORE_SANDBOX_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

export const isSandboxGrantee = (userId: string): boolean =>
  sandboxGranteeUserIds().includes(userId);

const repProduct = (productId: string) =>
  STORE_REP_PRODUCTS.find((product) => product.productId === productId);

const federalProduct = (productId: string) =>
  STORE_FEDERAL_PRODUCTS.find(
    (product) =>
      product.productId === productId || product.androidProductId === productId,
  );

export const DELETED_STORE_USER_PREFIX = "__tnr_deleted_store_user__:";

export const isDeletedStoreUserId = (userId: string): boolean =>
  userId.startsWith(DELETED_STORE_USER_PREFIX);

/** Whether deletion has retired this identity: a tombstone alias hangs off it. */
export const isRetiredStoreUserId = async (
  client: DrizzleClient,
  userId: string,
): Promise<boolean> => {
  const alias = await findStoreUserIdAlias(client, userId);
  return alias !== undefined && isDeletedStoreUserId(alias.newUserId);
};

/**
 * Follow staff-driven user-id renames so delayed webhooks cannot recreate the old id.
 *
 * A deletion tombstone is not followed. Deletion retires the character, not the ledger:
 * the receipts stay under the identity it retired, and so does everything the ledger
 * records while the character is gone, so that a returning identity finds its coverage.
 * Resolution therefore stops at that identity, and `isRetiredStoreUserId` answers the
 * separate question of whether there is a character to deliver to.
 */
export const canonicalStoreUserId = async (
  client: DrizzleClient,
  userId: string,
): Promise<string> => {
  const visited = new Set<string>();
  let current = userId;
  while (true) {
    if (visited.has(current))
      throw new Error(`Store user-id alias cycle from ${userId}`);
    visited.add(current);
    const alias = await findStoreUserIdAlias(client, current);
    if (
      !alias ||
      alias.newUserId === current ||
      isDeletedStoreUserId(alias.newUserId)
    ) {
      return current;
    }
    current = alias.newUserId;
  }
};

/** Resolve aliases for a RevenueCat id list, dropping blanks and repeats. */
const canonicalStoreUserIds = async (client: DrizzleClient, userIds: string[]) => {
  const canonical: string[] = [];
  for (const id of userIds.filter(Boolean)) {
    canonical.push(await canonicalStoreUserId(client, id));
  }
  return [...new Set(canonical)];
};

/**
 * Follow durable RevenueCat ownership redirects, including a partially-flattened chain.
 *
 * A transfer only owns receipts which already existed when it happened. Passing the
 * receipt/event time prevents a later purchase made by the old app user id from being
 * permanently captured by an earlier restore.
 */
const transferredUserId = async (
  client: DrizzleClient,
  sourceUserId: string,
  store: StorePlatform,
  isSandbox: boolean,
  asOf: Date,
): Promise<string> => {
  const visitedEdges = new Set<string>();
  let current = sourceUserId;
  let cursor = asOf;
  let cursorKey: string | null = null;
  while (true) {
    const redirects = await listStorePurchaseTransferForTransferredUserId(
      client,
      current,
      store,
      isSandbox,
      cursor,
    );
    const redirect = redirects.find((candidate) => {
      if (candidate.transferredAt.getTime() > cursor.getTime()) return true;
      return cursorKey === null || transferEdgeKey(candidate) > cursorKey;
    });
    if (!redirect || redirect.destinationUserId === current) return current;
    if (visitedEdges.has(redirect.id)) {
      throw new Error(
        `RevenueCat transfer cycle from ${sourceUserId}/${store}/${isSandbox ? "sandbox" : "production"}`,
      );
    }
    visitedEdges.add(redirect.id);
    cursor = redirect.transferredAt;
    cursorKey = transferEdgeKey(redirect);
    current = redirect.destinationUserId;
  }
};

/** Total order over transfers sharing a timestamp. */
const transferEdgeKey = (edge: {
  id: string;
  eventId: string;
  sourceUserId: string;
  destinationUserId: string;
}) => `${edge.eventId}\0${edge.sourceUserId}\0${edge.destinationUserId}\0${edge.id}`;

/** Every original owner whose chronological transfer path could reach sourceUserId. */
const transferPredecessorUserIds = (
  client: DrizzleClient,
  sourceUserId: string,
  store: StorePlatform,
  isSandbox: boolean,
) =>
  walkTransferGraph(sourceUserId, async (current) => {
    const redirects = await listStorePurchaseTransferForTransferPredecessorUserIds(
      client,
      current,
      store,
      isSandbox,
    );
    return redirects.map((redirect) => redirect.sourceUserId);
  });

/** Every account which may currently hold a receipt originally attached to sourceUserId. */
const transferChainUserIds = (
  client: DrizzleClient,
  sourceUserId: string,
  store: StorePlatform,
  isSandbox: boolean,
) =>
  walkTransferGraph(sourceUserId, async (current) => {
    const redirects = await listStorePurchaseTransferForTransferChainUserIds(
      client,
      current,
      store,
      isSandbox,
    );
    return redirects.map((redirect) => redirect.destinationUserId);
  });

/** Breadth-first walk over transfer edges, one direction at a time. */
const walkTransferGraph = async (
  start: string,
  neighbours: (userId: string) => Promise<string[]>,
): Promise<string[]> => {
  const visited = new Set<string>();
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    pending.push(...(await neighbours(current)));
  }
  return [...visited];
};

type StorePurchaseOwnerSnapshot = {
  id: string;
  userId: string;
  originalUserId: string;
  purchasedAt: Date;
  store: StorePlatform;
  federalStatus: FederalStatus | null;
  isSandbox: boolean;
  acceptedAt: Date | null;
};

/**
 * Move a receipt to the owner implied by the latest alias/transfer graph. The observed
 * owner and origin are part of the UPDATE predicate: a concurrent reconciler can never
 * overwrite a newer decision with its stale snapshot. Losing the comparison simply
 * re-reads and resolves again.
 */
export const reconcileStorePurchaseOwner = async (
  client: DrizzleClient,
  receiptId: string,
): Promise<StorePurchaseOwnerSnapshot> => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const receiptQuery = selectStorePurchaseForReconcileStorePurchaseOwner(
      client,
      receiptId,
    );
    // Every attempt reads afresh. Nothing here runs inside a transaction, so a CAS loser
    // simply sees the winner's committed row on its next read.
    const [receipt] = await receiptQuery;
    if (!receipt) throw new Error(`Missing store receipt ${receiptId}`);

    const canonicalOriginalUserId = await canonicalStoreUserId(
      client,
      receipt.originalUserId,
    );
    const resolvedUserId = receipt.federalStatus
      ? await transferredUserId(
          client,
          canonicalOriginalUserId,
          receipt.store,
          receipt.isSandbox,
          receipt.purchasedAt,
        )
      : canonicalOriginalUserId;
    const shouldAccept = !receipt.isSandbox || isSandboxGrantee(resolvedUserId);

    if (
      receipt.userId === resolvedUserId &&
      receipt.originalUserId === canonicalOriginalUserId &&
      Boolean(receipt.acceptedAt) === shouldAccept
    ) {
      return receipt;
    }

    const [owner] = await selectStoreUserIds(client, [resolvedUserId]);
    // A retired owner has no row to find, but the ledger is still theirs to hold.
    if (!owner && !(await isRetiredStoreUserId(client, resolvedUserId))) {
      throw new Error(`No store receipt owner ${resolvedUserId} for ${receiptId}`);
    }

    const result = await updateStorePurchaseForReconcileStorePurchaseOwner(
      client,
      resolvedUserId,
      canonicalOriginalUserId,
      shouldAccept,
      receipt,
    );
    if (result.rowsAffected === 0) continue;
    // Re-read even after winning: another transfer may have added a newer edge while this
    // handler held an older snapshot, and its failed CAS must observe our write before retrying.
  }
  throw new Error(`Could not stabilize store receipt owner ${receiptId}`);
};

/**
 * Apply a purchase exactly once.
 *
 * Nothing serialises concurrent deliveries or transfers: the unique transactionId index,
 * the claim statement and the owner reconciliation loop carry exactly-once between them,
 * and a revocation's watermark is written before its receipts so a late grant cannot
 * revive an ended period whatever the interleaving.
 *
 * Throws when the caller should retry — an unknown recipient, or a balance write that
 * failed — which the webhook turns into a 5xx. Everything it can decide for itself comes
 * back as an outcome.
 */
export const grantStorePurchase = async (
  client: DrizzleClient,
  grant: StoreGrant,
): Promise<GrantOutcome> =>
  await retryOnDeadlock(() => applyStorePurchase(client, grant));

/** One attempt of `grantStorePurchase`; the entry point above re-runs it after a deadlock. */
const applyStorePurchase = async (
  client: DrizzleClient,
  grant: StoreGrant,
): Promise<GrantOutcome> => {
  const reps = repProduct(grant.productId);
  const federal = federalProduct(grant.productId);
  if (!reps && !federal) {
    return { status: "ignored", reason: `Unknown product ${grant.productId}` };
  }

  // TRANSFER may arrive first. Consumables stay with their purchaser, but subscriptions
  // follow the durable store-account ownership redirect before any receipt is inserted.
  const originalUserId = await canonicalStoreUserId(client, grant.userId);
  let recipientUserId = federal
    ? await transferredUserId(
        client,
        originalUserId,
        grant.store,
        grant.isSandbox,
        grant.purchasedAt,
      )
    : originalUserId;
  const accepted = !grant.isSandbox || isSandboxGrantee(recipientUserId);

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
          (await findStoreEntitlementStateForRetireIfExpired(
            client,
            recipientUserId,
            grant,
          )) ??
            (await findStoreEntitlementRevocationForRetireIfExpired(
              client,
              recipientUserId,
              originalUserId,
              grant,
            )),
        );
    if (!expiredByEvent) return false;
    await updateStorePurchaseForRetireIfExpired(client, grant);
    return true;
  };

  const [recipient] = await selectStoreUserIds(client, [recipientUserId]);
  // A purchase can precede the character it is for, since the store SDK is signed in
  // before registration, so a missing recipient is retried. A retired one is different:
  // the receipt is still recorded, so a returning identity finds the coverage it paid for,
  // but there is no character to deliver to and no retry that could change that.
  if (!recipient && !(await isRetiredStoreUserId(client, recipientUserId))) {
    throw new Error(
      `No user ${recipientUserId} for transaction ${grant.transactionId}`,
    );
  }

  try {
    let inserted = true;
    try {
      await insertStorePurchaseForApplyStorePurchase(
        client,
        recipientUserId,
        originalUserId,
        grant,
        reps,
        federal,
        accepted,
      );
    } catch (error) {
      if (!isMysqlDuplicateKeyError(error)) throw error;
      inserted = false;
    }

    const storedReceipt = await findStorePurchaseForApplyStorePurchase(client, grant);
    if (!storedReceipt)
      throw new Error(`Missing receipt ${grant.transactionId} after insert`);
    if (
      storedReceipt.productId !== grant.productId ||
      storedReceipt.store !== grant.store
    ) {
      throw new Error(
        `Transaction ${grant.transactionId} was replayed with new details`,
      );
    }
    const storedOriginalUserId = await canonicalStoreUserId(
      client,
      storedReceipt.originalUserId,
    );
    if (storedOriginalUserId !== originalUserId) return { status: "duplicate" };

    // This also repairs receipts inserted under a retired id by an older deployment. A
    // duplicate retry must not acknowledge that orphan while its grant remains pending.
    const owner = await reconcileStorePurchaseOwner(client, storedReceipt.id);
    recipientUserId = owner.userId;
    const receipt = await findStorePurchaseForApplyStorePurchase2(
      client,
      storedReceipt,
    );
    if (!receipt) throw new Error(`Missing store receipt ${storedReceipt.id}`);
    if (!receipt.acceptedAt) {
      return inserted
        ? { status: "ignored", reason: "Sandbox purchase" }
        : { status: "duplicate" };
    }
    if (!receipt.grantedAt) {
      if (receipt.revokedAt) return { status: "ignored", reason: "Revoked purchase" };
      if (await retireIfExpired(receipt.expiresAt)) {
        return { status: "ignored", reason: "Expired purchase" };
      }
    }
    if (federal) {
      // An effective downgrade arrives as a purchase/renewal, without requiring an
      // expiration webhook for the old tier. Include accepted receipts on retries too.
      await rederiveFederalStatus(client, recipientUserId);
    }
    if (receipt.grantedAt) return { status: "duplicate" };

    if (!recipient) return { status: "ignored", reason: "Deleted user" };
    // The receipt deliberately remains durable when a later grant fails, so correctness
    // cannot depend on rolling both writes back. This multi-table UPDATE is one atomic SQL
    // statement: only the delivery that changes grantedAt from null can apply value.
    const result = reps
      ? await executeResultForApplyStorePurchase(client, reps, grant)
      : await executeResultForApplyStorePurchase2(client, rankOf, federal, grant);

    if (result.rowsAffected === 0) {
      const settled = await findStorePurchaseForApplyStorePurchase3(client, grant);
      if (settled?.grantedAt) return { status: "duplicate" };
      if (settled?.revokedAt) {
        return { status: "ignored", reason: "Revoked purchase" };
      }
      if (await retireIfExpired(settled?.expiresAt)) {
        return { status: "ignored", reason: "Expired purchase" };
      }
      throw new Error(`Could not apply store receipt ${grant.transactionId}`);
    }

    return { status: "granted" };
  } catch (error) {
    if (!isMysqlDeadlockError(error)) {
      Sentry.captureException(error, {
        level: "error",
        tags: { source: "grantStorePurchase" },
        extra: { transactionId: grant.transactionId, productId: grant.productId },
      });
    }
    throw error;
  }
};

export interface StoreExtension {
  userId: string;
  store: StorePlatform;
  productId: string;
  expirationAt: Date;
  transactionId?: string | null;
  /** Match the receipt environment. */
  isSandbox: boolean;
}

/**
 * Settle what the ledger recorded for an identity while it had no character: deliver each
 * accepted receipt that was never granted, then re-derive the tier from everything that
 * vouches now, transferred and PayPal receipts included. Replaying a receipt through the
 * grant path lands in its duplicate branch, which delivers exactly once; the replay names
 * the receipt's original owner so that branch recognises it. A replay that fails is already
 * reported there and leaves the receipt pending for the next attempt.
 */
export const settleRecordedLedger = async (
  client: DrizzleClient,
  userId: string,
): Promise<void> => {
  const recorded = await listStorePurchaseForSettleRecordedLedger(client, userId);
  for (const receipt of recorded) {
    try {
      await grantStorePurchase(client, {
        userId: receipt.originalUserId,
        transactionId: receipt.transactionId,
        productId: receipt.productId,
        store: receipt.store,
        isSandbox: receipt.isSandbox,
        purchasedAt: receipt.purchasedAt,
        expiresAt: receipt.expiresAt,
        raw: receipt.rawData,
      });
    } catch {
      // Reported by grantStorePurchase; the receipt stays pending for the next attempt.
    }
  }
  await rederiveFederalStatus(client, userId);
};

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
): Promise<void> => await retryOnDeadlock(() => applyStoreExtension(client, extension));

/** One attempt of `extendStoreSubscription`; the entry point above re-runs it after a deadlock. */
const applyStoreExtension = async (
  client: DrizzleClient,
  extension: StoreExtension,
): Promise<void> => {
  const canonicalUserId = await canonicalStoreUserId(client, extension.userId);
  const { isSandbox } = extension;
  const exact = extension.transactionId
    ? await findStorePurchaseForApplyStoreExtension(
        client,
        {
          transactionId: extension.transactionId,
          store: extension.store,
          productId: extension.productId,
        },
        isSandbox,
      )
    : undefined;
  // A retry of a known, already-retired period is complete. Falling back to another live
  // receipt here would extend a resubscription with the old period's lifecycle event.
  if (exact?.revokedAt) return;
  const possibleOwners = await transferChainUserIds(
    client,
    canonicalUserId,
    extension.store,
    isSandbox,
  );
  const candidates = exact
    ? []
    : await listStorePurchaseForApplyStoreExtension(
        client,
        possibleOwners,
        extension,
        isSandbox,
      );
  let receipt = exact;
  for (const candidate of candidates) {
    const owner = await transferredUserId(
      client,
      canonicalUserId,
      extension.store,
      isSandbox,
      candidate.purchasedAt,
    );
    if (owner === candidate.userId) {
      receipt = candidate;
      break;
    }
  }
  if (!receipt) {
    // Nothing live to extend. Whether that is worth a retry depends on why.
    //
    // If a retired receipt for this period exists, the subscription has already ended and
    // no retry can change that -- the same reasoning as the deleted-owner case above.
    // BILLING_ISSUE routinely lands after EXPIRATION, and the exact-match return only
    // covers it when the payload's transaction id matches a stored receipt; without this
    // an event carrying no transaction id, or one naming a period we never stored, is
    // answered with a 500 and retried for days against a subscription that is over.
    //
    // If there is no receipt at all, the purchase webhook may simply not have arrived yet,
    // and throwing is what lets a later retry find it.
    const retired = await listStorePurchaseForApplyStoreExtension2(
      client,
      possibleOwners,
      extension,
      isSandbox,
    );
    // Only when the event asks for no more coverage than a period we already retired. The
    // mere existence of a retired receipt is not enough: every resubscriber has one, so
    // acknowledging on that alone would silently drop a genuine extension whose purchase
    // webhook has not landed yet. Asking for coverage beyond anything we hold means the
    // event describes a period we have not recorded, and a retry is what lets it arrive.
    const covered = retired.some((row) => {
      const through = row.expiresAt ?? row.purchasedAt;
      return through.getTime() >= extension.expirationAt.getTime();
    });
    if (covered) return;
    // A retired identity with nothing live has nothing a retry could repair either.
    if (await isRetiredStoreUserId(client, canonicalUserId)) return;
    throw new Error(
      `No live receipt to extend for ${extension.userId}/${extension.productId}`,
    );
  }
  // A period we could not positively identify is not evidence about the receipt we guessed
  // at. Extending one is harmless; shortening one that is still vouching is not, and a
  // NULL expiresAt means "open, covered by the 63-day fallback" everywhere except the
  // COALESCE below, which would read it as having ended at purchasedAt.
  if (!exact && extension.expirationAt.getTime() <= Date.now()) return;

  await updateStorePurchaseForApplyStoreExtension(client, extension, receipt);

  // The cleaner may have run before a delayed extension arrived. Re-derive immediately
  // so the newly durable entitlement also restores any tier it still pays for -- for
  // whoever holds the receipt now, since a transfer can have moved it while this ran.
  const holder = await findStorePurchaseForApplyStoreExtension2(client, receipt);
  for (const owner of new Set([receipt.userId, holder?.userId ?? receipt.userId])) {
    await rederiveFederalStatus(client, owner);
  }
};

export interface RevocationScope {
  /** Stable webhook event id, used to deduplicate the durable expiry fact. */
  eventId: string;
  /** The moment the store says the subscription ended. */
  occurredAt: Date;
  /** The product that expired. Absent only on payloads that do not name one. */
  productId?: string | null;
  /** The store it expired on, so an Apple lapse cannot retire a Google receipt. */
  store: StorePlatform;
  /** The expiring store transaction, when RevenueCat supplies it. */
  transactionId?: string | null;
  /** Match the receipt environment rather than trusting the payload account's allowlist. */
  isSandbox: boolean;
}

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
export const revokeFederalStatus = async (
  client: DrizzleClient,
  userId: string,
  scope: RevocationScope,
): Promise<void> =>
  await retryOnDeadlock(() => applyFederalRevocation(client, userId, scope));

/** One attempt of `revokeFederalStatus`; the entry point above re-runs it after a deadlock. */
const applyFederalRevocation = async (
  client: DrizzleClient,
  userId: string,
  scope: RevocationScope,
): Promise<void> => {
  userId = await canonicalStoreUserId(client, userId);
  const { eventId, occurredAt, productId, store, transactionId, isSandbox } = scope;
  const exact = transactionId
    ? await findStorePurchaseForApplyFederalRevocation(
        client,
        transactionId,
        store,
        productId,
        isSandbox,
      )
    : undefined;
  // Revoking the receipt and recomputing the shared status are separate writes on
  // PlanetScale. A retry must repair the second write if the first delivery failed after
  // stamping revokedAt.
  if (exact?.revokedAt) {
    await rederiveFederalStatus(client, exact.userId);
    return;
  }
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
  const possibleOwners = await transferChainUserIds(client, userId, store, isSandbox);
  const candidates =
    !exact && productId
      ? await listStorePurchaseForApplyFederalRevocation(
          client,
          possibleOwners,
          productId,
          occurredAt,
          store,
          isSandbox,
        )
      : [];
  let spent = exact;
  for (const candidate of candidates) {
    const owner = await transferredUserId(
      client,
      userId,
      store,
      isSandbox,
      candidate.purchasedAt,
    );
    if (owner === candidate.userId) {
      spent = candidate;
      break;
    }
  }
  const cutoff = spent?.purchasedAt ?? (productId ? beforeExpiry : occurredAt);
  const applicableTransactionId = transactionId ?? spent?.transactionId ?? null;
  const receiptId = exact?.id ?? spent?.id ?? null;
  // A transfer can move the receipt while this runs, and a stamp scoped to an owner it has
  // left retires nothing. So each pass stamps the current holder and then reads the
  // receipt itself back: while it is still live, the pass is repeated for whoever holds it
  // now -- an owner already stamped included, since the receipt can come back. The
  // sequential order "transfer, then expiry" performs exactly that second pass by itself.
  // Without a receipt to watch, the holder the redirects name is stamped once.
  const retired = new Set<string>();
  let ownerUserId =
    exact?.userId ??
    spent?.userId ??
    (await transferredUserId(client, userId, store, isSandbox, occurredAt));
  for (let pass = 0; pass < 5; pass++) {
    retired.add(ownerUserId);
    await insertStoreEntitlementRevocationForApplyFederalRevocation(
      client,
      eventId,
      ownerUserId,
      store,
      isSandbox,
      productId,
      applicableTransactionId,
      cutoff,
      occurredAt,
    );
    // Persist the cutoff before touching receipts. If the purchase webhook has not
    // inserted its row yet, or races this handler, the grant's atomic claim checks this
    // watermark and cannot resurrect a subscription period the store has already ended.
    await insertStoreEntitlementStateForApplyFederalRevocation(
      client,
      ownerUserId,
      store,
      isSandbox,
      cutoff,
    );
    await updateStorePurchaseForApplyFederalRevocation(
      client,
      ownerUserId,
      cutoff,
      store,
      isSandbox,
    );
    if (!receiptId) break;
    const settled = await findStorePurchaseForApplyFederalRevocation2(
      client,
      receiptId,
    );
    if (!settled || settled.revokedAt) break;
    ownerUserId = settled.userId;
  }
  // Then fall back to whatever still vouches -- all payment sources, for every
  // account the receipt sat under. The bound above deliberately spares a receipt bought
  // after the expiry, and reading only PayPal here would drop the tier anyway and leave a
  // paying subscriber with a live receipt and nothing to show for it, until their next
  // renewal.
  for (const owner of retired) {
    await rederiveFederalStatus(client, owner);
  }
};

export interface StoreTransfer {
  /** Stable RevenueCat event id used to deduplicate retries. */
  eventId: string;
  fromUserIds: string[];
  toUserIds: string[];
  /** Missing when neither RevenueCat's store nor configured app id identifies a platform. */
  store?: StorePlatform | null;
  /** RevenueCat environment. */
  isSandbox: boolean;
  /** RevenueCat event time, used to reject a delayed older ownership redirect. */
  occurredAt: Date;
}

/**
 * Rename an application user id inside durable transfer aliases.
 *
 * Destination ids are non-unique and can be changed directly. A source can have many
 * ownership epochs, so each historical redirect follows the rename independently.
 */
export const migrateStorePurchaseTransfers = async (
  client: DrizzleClient,
  oldUserId: string,
  newUserId: string,
): Promise<void> => {
  await updateStorePurchaseTransferForMigrateStorePurchaseTransfers(
    client,
    newUserId,
    oldUserId,
  );

  const aliases = await listStorePurchaseTransferForMigrateStorePurchaseTransfers(
    client,
    oldUserId,
  );
  for (const alias of aliases) {
    if (alias.destinationUserId === newUserId) {
      await deleteStorePurchaseTransferForMigrateStorePurchaseTransfers(client, alias);
      continue;
    }
    const collision = await findStorePurchaseTransferForMigrateStorePurchaseTransfers(
      client,
      newUserId,
      alias,
    );
    if (collision) {
      await updateStorePurchaseTransferForMigrateStorePurchaseTransfers2(
        client,
        alias,
        collision,
      );
      await deleteStorePurchaseTransferForMigrateStorePurchaseTransfers(client, alias);
    } else {
      await updateStorePurchaseTransferForMigrateStorePurchaseTransfers3(
        client,
        newUserId,
        alias,
      );
    }
  }
  await deleteStorePurchaseTransferForMigrateStorePurchaseTransfers2(client, newUserId);
};

/** Merge per-store revocation watermarks before an account id is renamed. */
export const migrateStoreEntitlementStates = async (
  client: DrizzleClient,
  oldUserId: string,
  newUserId: string,
): Promise<void> => {
  for (const store of STORE_PLATFORMS) {
    for (const isSandbox of [false, true]) {
      const oldState = await findStoreEntitlementStateForMigrateStoreEntitlementStates(
        client,
        oldUserId,
        store,
        isSandbox,
      );
      const newState = await findStoreEntitlementStateForMigrateStoreEntitlementStates(
        client,
        newUserId,
        store,
        isSandbox,
      );
      if (!oldState) continue;
      if (newState) {
        await updateStoreEntitlementStateForMigrateStoreEntitlementStates(
          client,
          oldState,
          newState,
        );
        await deleteStoreEntitlementStateForMigrateStoreEntitlementStates(
          client,
          oldState,
        );
      } else {
        await updateStoreEntitlementStateForMigrateStoreEntitlementStates2(
          client,
          newUserId,
          oldState,
        );
      }
    }
  }
};

/** Move durable per-event expiry facts across a staff user-id rename. */
export const migrateStoreEntitlementRevocations = async (
  client: DrizzleClient,
  oldUserId: string,
  newUserId: string,
): Promise<void> => {
  const revocations =
    await listStoreEntitlementRevocationForMigrateStoreEntitlementRevocations(
      client,
      oldUserId,
    );
  for (const revocation of revocations) {
    const collision =
      await findStoreEntitlementRevocationForMigrateStoreEntitlementRevocations(
        client,
        revocation,
        newUserId,
      );
    if (collision) {
      await updateStoreEntitlementRevocationForMigrateStoreEntitlementRevocations(
        client,
        collision,
        revocation,
      );
      await deleteStoreEntitlementRevocationForMigrateStoreEntitlementRevocations(
        client,
        revocation,
      );
    } else {
      await updateStoreEntitlementRevocationForMigrateStoreEntitlementRevocations2(
        client,
        newUserId,
        revocation,
      );
    }
  }
};

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
): Promise<{ destinationUserId: string; rowsAffected: number }> =>
  await retryOnDeadlock(() => applyStoreTransfer(client, transfer));

/** One attempt of `transferStorePurchases`; the entry point above re-runs it after a deadlock. */
const applyStoreTransfer = async (
  client: DrizzleClient,
  transfer: StoreTransfer,
): Promise<{ destinationUserId: string; rowsAffected: number }> => {
  const fromIds = await canonicalStoreUserIds(client, transfer.fromUserIds);
  const toIds = await canonicalStoreUserIds(client, transfer.toUserIds);
  if (toIds.length === 0) throw new Error("RevenueCat transfer has no destination");
  const destinations = await selectStoreUserIds(client, toIds);
  // The destination may have deleted its character. The receipts move all the same, so
  // the source stops vouching now and the identity finds them if it comes back.
  const retiredDestination =
    destinations.length === 0 &&
    toIds.length === 1 &&
    toIds[0] &&
    (await isRetiredStoreUserId(client, toIds[0]))
      ? toIds[0]
      : undefined;
  const destinationUserId = destinations[0]?.userId ?? retiredDestination;
  if (!destinationUserId || destinations.length > 1) {
    throw new Error(
      `RevenueCat transfer resolved ${destinations.length} destination users`,
    );
  }
  const sourceIds = fromIds.filter((id) => id !== destinationUserId);
  const stores = transfer.store ? [transfer.store] : [...STORE_PLATFORMS];
  const { isSandbox } = transfer;

  let rowsAffected = 0;
  const effectiveDestinations = new Set<string>([destinationUserId]);
  for (const store of stores) {
    for (const sourceUserId of sourceIds) {
      // Persist before moving rows. A concurrent grant then either sees the redirect up
      // front or leaves a durable receipt for the re-resolution below to re-home.
      await insertStorePurchaseTransferForApplyStoreTransfer(
        client,
        transfer,
        sourceUserId,
        destinationUserId,
        store,
        isSandbox,
      );

      const effectiveDestination = await transferredUserId(
        client,
        sourceUserId,
        store,
        isSandbox,
        transfer.occurredAt,
      );
      effectiveDestinations.add(effectiveDestination);
      const sourceEntitlementState =
        await findStoreEntitlementStateForApplyStoreTransfer(
          client,
          sourceUserId,
          store,
          isSandbox,
          transfer,
        );
      if (sourceEntitlementState && effectiveDestination !== sourceUserId) {
        // Ownership redirects apply to delayed expiries as well as delayed grants. Carry
        // the revocation watermark forward so an already-ended old period cannot become
        // live merely because its purchase webhook lands under the destination later.
        await insertStoreEntitlementStateForApplyFederalRevocation(
          client,
          effectiveDestination,
          store,
          isSandbox,
          sourceEntitlementState.revokedThrough,
        );
      }
      // A newer transfer may already have moved an older receipt away from sourceUserId.
      // Re-resolve every receipt whose original ownership path can reach this source so a
      // delayed epoch repairs the whole chronology, including later destinations.
      const originalUserIds = await transferPredecessorUserIds(
        client,
        sourceUserId,
        store,
        isSandbox,
      );
      const candidates = await listStorePurchaseForApplyStoreTransfer(
        client,
        originalUserIds,
        store,
        isSandbox,
      );
      for (const receipt of candidates) {
        effectiveDestinations.add(receipt.userId);
        const reconciled = await reconcileStorePurchaseOwner(client, receipt.id);
        effectiveDestinations.add(reconciled.userId);
        if (reconciled.userId !== receipt.userId) rowsAffected += 1;
      }
    }
  }

  const knownSources =
    sourceIds.length > 0 ? await selectStoreUserIds(client, sourceIds) : [];
  for (const userId of new Set([
    ...knownSources.map((row) => row.userId),
    ...effectiveDestinations,
  ])) {
    await rederiveFederalStatus(client, userId);
  }

  return { destinationUserId, rowsAffected };
};

/**
 * Tombstone a deleted store identity while retaining receipt idempotency history.
 *
 * One alias row. Rename aliases pointing at this identity are left in place: resolution
 * stops at the identity a tombstone retires, so they still land here, and registration
 * removes exactly this row when the identity returns.
 */
export const retireStoreUserId = async (
  client: DrizzleClient,
  userId: string,
  beforeRetire?: (client: DrizzleClient) => Promise<void>,
): Promise<void> => {
  if (isDeletedStoreUserId(userId)) return;
  const tombstone = `${DELETED_STORE_USER_PREFIX}${nanoid()}`;
  // Idempotent statements rather than a transaction. Deletion is where this codebase has
  // actually seen deadlocks -- deleteUser retries them with backoff -- and holding a lock
  // across these while the cleanup runs is what made that likely. Re-running either
  // converges on the same state, so a failure part-way is repaired by the retry
  // deleteUser already performs.
  // The tombstone goes down before the cleanup, not after. Identity-scoped writes check
  // for it before they write, so once it exists none begins; the cleanup below removes
  // whatever arrived before it, and a write already past its check when the tombstone
  // landed leaves at most a row the fan-out never reads. Ordered the other way round, a
  // registration slipping between the cleanup and the tombstone would outlive the account.
  //
  // Whoever wrote this row first keeps it. A retry therefore keeps its own marker, and --
  // the reason this matters without a lock -- a rename that has already pointed this id
  // somewhere real is not overwritten with a tombstone, which would strand every store
  // lookup for the old id on a deleted identity. The row is read back rather than assumed:
  // if a rename owns it, the identity is being moved, and this deletion stops here rather
  // than shred what the rename is relocating.
  await insertStoreUserIdAlias(client, userId, tombstone);
  const claim = await findStoreUserIdAlias(client, userId);
  if (claim && !isDeletedStoreUserId(claim.newUserId)) {
    throw new Error(`User ${userId} is being renamed and cannot be deleted`);
  }
  // Whatever landed before the tombstone. Store receipts are deliberately left alone --
  // they are an audit ledger and outlive the account by design -- so this reaches only the
  // identity-scoped rows that must not.
  await beforeRetire?.(client);
};

/** Where a status sits on the ladder, so two sources can be compared. */
const rankOf = (status: FederalStatus): number => FederalStatuses.indexOf(status);

/** How long an ACTIVE PayPal row vouches for its tier after its last payment. */
const PAYPAL_WINDOW_MS = PAYPAL_PAID_PERIOD_DAYS * DAY_S * 1000;

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
  const rows = await listPaypalSubscriptionForPaypalFederalFloor(
    client,
    userId,
    PAYPAL_WINDOW_MS,
  );
  return highest(rows.map((row) => row.federalStatus));
};

/** Recompute a player's tier from everything that vouches for it now. */
const rederiveFederalStatus = async (client: DrizzleClient, userId: string) => {
  const paypal = await paypalFederalFloor(client, userId);
  await setFederalStatusWithStoreFloor(client, userId, paypal);
};

/**
 * Set the shared federal-status column without leaving a gap between reading the store
 * receipts and writing the user. Store grants update the receipt and user in one statement
 * too, so both writers serialize on the user row: whichever runs last sees the other's
 * committed source of truth instead of applying a stale pre-read value.
 */
export const setFederalStatusWithStoreFloor = async (
  client: Pick<DrizzleClient, "update">,
  userId: string,
  paypalStatus: FederalStatus,
) => {
  const sandboxRule = isSandboxGrantee(userId)
    ? undefined
    : eq(storePurchase.isSandbox, false);
  // Only when the caller reports no PayPal tier at all. That is the case the grace exists
  // for: paypalFederalFloor counts only ACTIVE rows, so a web cancellation reads as NONE
  // while the period the player paid for is still running. A caller naming a real tier is
  // asserting one; other current ACTIVE subscriptions are independently protected by
  // tierEvidence, while this grace only preserves coverage when no PayPal tier was supplied.
  // Without it, a store grant, revocation or transfer arriving inside that window writes
  // NONE, and the reconcile deliberately never restores a cleared tier.
  const paypalGrace = (tier: FederalStatus) =>
    paypalStatus === "NONE" ? paidPaypalPeriodGrace(userId, tier) : sql`FALSE`;

  return await updateUserDataForSetFederalStatusWithStoreFloor(
    client,
    rankOf(paypalStatus),
    rankOf,
    (tier) => tierEvidence(userId, tier, sandboxRule),
    paypalGrace,
    userId,
  );
};

/**
 * Re-derive every non-NONE or currently subscribed player's tier in one correlated write.
 *
 * This is the bulk cleaner counterpart of `setFederalStatusWithStoreFloor`: GOLD wins over
 * SILVER, which wins over NORMAL, across active PayPal rows, paid Stripe periods and live store receipts.
 * It therefore performs downgrades as well as clearing or restoring a status.
 */
export const reconcileFederalStatuses = async (
  client: Pick<DrizzleClient, "select" | "execute">,
) => {
  const sandboxUserIds = sandboxGranteeUserIds();
  const sandboxRule = or(
    eq(storePurchase.isSandbox, false),
    sandboxUserIds.length ? inArray(storePurchase.userId, sandboxUserIds) : undefined,
  );
  const tierCases = FederalStatuses.slice(1)
    .reverse()
    .map(
      (tier) => sql`WHEN ${tierEvidence(userData.userId, tier, sandboxRule)}
        OR ${paidPaypalPeriodGrace(userData.userId, tier)} THEN ${tier}`,
    );
  const federalStatus = sql`CASE ${sql.join(tierCases, sql` `)} ELSE 'NONE' END`;
  const eligible = sql`(${userData.federalStatus} != 'NONE'
      OR EXISTS (SELECT 1 FROM ${stripePayment} WHERE ${liveStripePeriod(userData.userId)})
      OR EXISTS (SELECT 1 FROM ${paypalSubscription} WHERE ${activePaypalRow(userData.userId)})
      OR EXISTS (
        SELECT 1 FROM ${storePurchase}
        WHERE ${liveStoreReceipt(userData.userId, sandboxRule)}
          AND ${storePurchase.federalStatus} IS NOT NULL
      ))`;
  // Discover candidates with a consistent read, then evaluate the latest receipts
  // and tier in each bounded write so concurrent grants/revocations still win.
  const candidates = await selectUserDataForReconcileFederalStatuses(client, eligible);
  for (let offset = 0; offset < candidates.length; offset += 1000) {
    const ids = candidates.slice(offset, offset + 1000).map(({ userId }) => userId);
    await retryOnDeadlock(() =>
      executeRowsForReconcileFederalStatuses(client, federalStatus, ids, eligible),
    );
  }
};

/** The player a tier predicate is about: one bound id, or the row of the enclosing UPDATE. */
type UserReference = string | typeof userData.userId;

const databaseNow = sql`CURRENT_TIMESTAMP(3)`;
const paypalWindowStart = sql`${databaseNow} - INTERVAL ${PAYPAL_PAID_PERIOD_DAYS} DAY`;

/** Treat a recent active PayPal subscription row as tier evidence. */
const activePaypalRow = (user: UserReference) =>
  and(
    eq(paypalSubscription.affectedUserId, user),
    eq(paypalSubscription.status, "ACTIVE"),
    gte(paypalSubscription.updatedAt, paypalWindowStart),
  );

/** Match granted Stripe periods that entitle the account on the database clock. */
const liveStripePeriod = (user: UserReference) =>
  and(
    eq(stripePayment.affectedUserId, user),
    isNotNull(stripePayment.grantedAt),
    env.NODE_ENV === "production" ? eq(stripePayment.isSandbox, false) : undefined,
    lte(stripePayment.purchasedAt, databaseNow),
    gt(stripePayment.expiresAt, databaseNow),
  );

/**
 * A receipt with no expiry falls back to a window wider than PayPal's, because a receipt is
 * the only evidence there is and a subscription can go a long time without producing one. A
 * failed renewal opens a billing-retry grace period — up to 16 days on the App Store and 30
 * on Play — during which the player is still entitled and no RENEWAL arrives. A monthly
 * cycle plus that grace exceeds 31 days, so the narrower window would strip someone the
 * store still considers a subscriber. Revocation does not depend on this: EXPIRATION
 * revokes on the event, and this window is only the backstop for a webhook that never
 * arrived.
 */
const liveStoreReceipt = (user: UserReference, sandboxRule: SQL | undefined) =>
  and(
    eq(storePurchase.userId, user),
    isNotNull(storePurchase.acceptedAt),
    sandboxRule,
    isNull(storePurchase.revokedAt),
    or(
      gte(storePurchase.expiresAt, databaseNow),
      and(
        isNull(storePurchase.expiresAt),
        gte(
          storePurchase.createdAt,
          sql`${databaseNow} - INTERVAL ${STORE_RECEIPT_FALLBACK_DAYS} DAY`,
        ),
      ),
    ),
  );

/** Whether an active PayPal row, a live store receipt or a paid Stripe period vouches. */
const tierEvidence = (
  user: UserReference,
  tier: FederalStatus,
  sandboxRule: SQL | undefined,
) => sql`EXISTS (
    SELECT 1 FROM ${paypalSubscription}
    WHERE ${activePaypalRow(user)} AND ${paypalSubscription.federalStatus} = ${tier}
  ) OR EXISTS (
    SELECT 1 FROM ${storePurchase}
    WHERE ${liveStoreReceipt(user, sandboxRule)} AND ${storePurchase.federalStatus} = ${tier}
  ) OR EXISTS (
    SELECT 1 FROM ${stripePayment}
    WHERE ${liveStripePeriod(user)}
      AND COALESCE(${stripePayment.federalStatusOverride}, ${stripePayment.federalStatus}) = ${tier}
  )`;

/**
 * Cancelling on the web sets status without moving updatedAt, and the player has already
 * paid through the period. Bounded by the tier they currently hold, so it can only keep what
 * they have -- never hand a tier back to someone the reconcile has already cleared, which is
 * what the ACTIVE predicate above is guarding. "At least", not "exactly", so a store receipt
 * sitting above the PayPal tier does not hide the paid period underneath it when that
 * receipt ends.
 */
const paidPaypalPeriodGrace = (user: UserReference, tier: FederalStatus) =>
  sql`(${userFederalRankSql()} >= ${rankOf(tier) + 1} AND EXISTS (
    SELECT 1 FROM ${paypalSubscription}
    WHERE ${paypalSubscription.affectedUserId} = ${user}
      AND ${paypalSubscription.updatedAt} >= ${paypalWindowStart}
      AND ${paypalSubscription.federalStatus} = ${tier}
  ))`;
