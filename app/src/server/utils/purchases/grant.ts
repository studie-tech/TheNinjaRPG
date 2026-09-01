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
  asc,
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
  STORE_PLATFORMS,
  STORE_REP_PRODUCTS,
  type StorePlatform,
} from "@/drizzle/constants";
import {
  paypalSubscription,
  storeEntitlementRevocation,
  storeEntitlementState,
  storePurchase,
  storePurchaseTransfer,
  storeUserIdAlias,
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

/** Follow staff-driven user-id renames so delayed webhooks cannot recreate the old id. */
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
    const alias = await client.query.storeUserIdAlias.findFirst({
      columns: { newUserId: true },
      where: eq(storeUserIdAlias.oldUserId, current),
    });
    if (!alias || alias.newUserId === current) return current;
    current = alias.newUserId;
  }
};

/** Resolve aliases with locking reads after the owning UserData row is serialized. */
const canonicalStoreUserIdForUpdate = async (
  client: DrizzleClient,
  userId: string,
): Promise<string> => {
  const visited = new Set<string>();
  let current = userId;
  while (true) {
    if (visited.has(current)) {
      throw new Error(`Store user-id alias cycle from ${userId}`);
    }
    visited.add(current);
    const [alias] = await client
      .select({ newUserId: storeUserIdAlias.newUserId })
      .from(storeUserIdAlias)
      .where(eq(storeUserIdAlias.oldUserId, current))
      .for("update");
    if (!alias || alias.newUserId === current) return current;
    current = alias.newUserId;
  }
};

/**
 * One durable mutex for mutations of the store ownership graph.
 *
 * A mutation named for A can ultimately write B (or C) through RevenueCat's transfer
 * history, so locking only the ids in the webhook payload is not closed under ownership.
 * Keeping a self-alias row as a mutex makes grants, extensions, revocations, transfers,
 * and staff renames observe one stable graph without requiring a race-prone graph walk
 * before the locks are known. The INSERT itself owns the row until transaction commit.
 */
export const STORE_USER_MUTATION_LOCK_ID = "__tnr_internal_store_user_mutation_lock__";
export const DELETED_STORE_USER_PREFIX = "__tnr_deleted_store_user__:";

export const isReservedStoreUserId = (userId: string): boolean =>
  userId === STORE_USER_MUTATION_LOCK_ID ||
  userId.startsWith(DELETED_STORE_USER_PREFIX);

export const isDeletedStoreUserId = (userId: string): boolean =>
  userId.startsWith(DELETED_STORE_USER_PREFIX);

export const acquireStoreUserMutationLock = async (
  client: DrizzleClient,
): Promise<void> => {
  await client
    .insert(storeUserIdAlias)
    .values({
      oldUserId: STORE_USER_MUTATION_LOCK_ID,
      newUserId: STORE_USER_MUTATION_LOCK_ID,
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        newUserId: STORE_USER_MUTATION_LOCK_ID,
        updatedAt: new Date(),
      },
    });
};

/**
 * Share the UserData row lock used by staff renames, then resolve aliases again using
 * current reads. If a rename committed while the first lock waited, the retired id no
 * longer yields a row and the newly canonical row is locked before mutation continues.
 */
const serializeStoreUserMutation = async <T>(
  client: DrizzleClient,
  userIds: readonly string[],
  mutation: (client: DrizzleClient, canonicalUserIds: string[]) => Promise<T>,
): Promise<T> => {
  const outcome = await client.transaction(async (tx) => {
    const lockedClient = tx as unknown as DrizzleClient;
    await acquireStoreUserMutationLock(lockedClient);
    const originalUserIds = userIds.filter(Boolean);
    const lockedUserIds = new Set<string>();
    let pendingUserIds = [...new Set(originalUserIds)].sort();

    while (pendingUserIds.length > 0) {
      for (const userId of pendingUserIds) {
        await lockedClient
          .select({ userId: userData.userId })
          .from(userData)
          .where(eq(userData.userId, userId))
          .for("update");
        lockedUserIds.add(userId);
      }

      const canonicalUserIds: string[] = [];
      for (const userId of originalUserIds) {
        canonicalUserIds.push(
          await canonicalStoreUserIdForUpdate(lockedClient, userId),
        );
      }
      pendingUserIds = [...new Set(canonicalUserIds)]
        .filter((userId) => !lockedUserIds.has(userId))
        .sort();
      if (pendingUserIds.length === 0) {
        try {
          return {
            status: "completed" as const,
            value: await mutation(lockedClient, canonicalUserIds),
          };
        } catch (error) {
          // Webhook mutations deliberately leave durable progress (especially a pending
          // receipt or revocation watermark) for the retry which follows a 5xx.
          return { status: "failed" as const, error };
        }
      }
    }

    try {
      return { status: "completed" as const, value: await mutation(lockedClient, []) };
    } catch (error) {
      return { status: "failed" as const, error };
    }
  });
  if (outcome.status === "failed") throw outcome.error;
  return outcome.value;
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
  asOf: Date,
): Promise<string> => {
  const visitedEdges = new Set<string>();
  let current = sourceUserId;
  let cursor = asOf;
  let cursorKey: string | null = null;
  while (true) {
    const redirects = await client.query.storePurchaseTransfer.findMany({
      columns: {
        id: true,
        eventId: true,
        sourceUserId: true,
        destinationUserId: true,
        transferredAt: true,
      },
      where: and(
        eq(storePurchaseTransfer.sourceUserId, current),
        eq(storePurchaseTransfer.store, store),
        gte(storePurchaseTransfer.transferredAt, cursor),
      ),
      orderBy: [
        asc(storePurchaseTransfer.transferredAt),
        asc(storePurchaseTransfer.eventId),
        asc(storePurchaseTransfer.sourceUserId),
        asc(storePurchaseTransfer.destinationUserId),
        asc(storePurchaseTransfer.id),
      ],
    });
    const redirect = redirects.find((candidate) => {
      if (candidate.transferredAt.getTime() > cursor.getTime()) return true;
      const key = `${candidate.eventId}\0${candidate.sourceUserId}\0${candidate.destinationUserId}\0${candidate.id}`;
      return cursorKey === null || key > cursorKey;
    });
    if (!redirect || redirect.destinationUserId === current) return current;
    if (visitedEdges.has(redirect.id)) {
      throw new Error(`RevenueCat transfer cycle from ${sourceUserId}/${store}`);
    }
    visitedEdges.add(redirect.id);
    cursor = redirect.transferredAt;
    cursorKey = `${redirect.eventId}\0${redirect.sourceUserId}\0${redirect.destinationUserId}\0${redirect.id}`;
    current = redirect.destinationUserId;
  }
};

/** Every original owner whose chronological transfer path could reach sourceUserId. */
const transferPredecessorUserIds = async (
  client: DrizzleClient,
  sourceUserId: string,
  store: StorePlatform,
): Promise<string[]> => {
  const visited = new Set<string>();
  const pending = [sourceUserId];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const predecessors = await client.query.storePurchaseTransfer.findMany({
      columns: { sourceUserId: true },
      where: and(
        eq(storePurchaseTransfer.destinationUserId, current),
        eq(storePurchaseTransfer.store, store),
      ),
    });
    pending.push(...predecessors.map((redirect) => redirect.sourceUserId));
  }
  return [...visited];
};

/** Every account which may currently hold a receipt originally attached to sourceUserId. */
const transferChainUserIds = async (
  client: DrizzleClient,
  sourceUserId: string,
  store: StorePlatform,
): Promise<string[]> => {
  const visited = new Set<string>();
  const pending = [sourceUserId];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const redirects = await client.query.storePurchaseTransfer.findMany({
      columns: { destinationUserId: true },
      where: and(
        eq(storePurchaseTransfer.sourceUserId, current),
        eq(storePurchaseTransfer.store, store),
      ),
      orderBy: asc(storePurchaseTransfer.transferredAt),
    });
    pending.push(...redirects.map((redirect) => redirect.destinationUserId));
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
    const receiptQuery = client
      .select({
        id: storePurchase.id,
        userId: storePurchase.userId,
        originalUserId: storePurchase.originalUserId,
        purchasedAt: storePurchase.purchasedAt,
        store: storePurchase.store,
        federalStatus: storePurchase.federalStatus,
      })
      .from(storePurchase)
      .where(eq(storePurchase.id, receiptId));
    // A CAS loser must escape its repeatable-read snapshot before resolving again.
    // MySQL locking reads are current reads, so the retry observes the winner's owner.
    const [receipt] =
      attempt === 0 ? await receiptQuery : await receiptQuery.for("update");
    if (!receipt) throw new Error(`Missing store receipt ${receiptId}`);

    const canonicalOriginalUserId = await canonicalStoreUserIdForUpdate(
      client,
      receipt.originalUserId,
    );
    const resolvedUserId = receipt.federalStatus
      ? await transferredUserId(
          client,
          canonicalOriginalUserId,
          receipt.store,
          receipt.purchasedAt,
        )
      : canonicalOriginalUserId;

    if (
      receipt.userId === resolvedUserId &&
      receipt.originalUserId === canonicalOriginalUserId
    ) {
      return receipt;
    }

    const [owner] = await client
      .select({ userId: userData.userId })
      .from(userData)
      .where(eq(userData.userId, resolvedUserId));
    if (!owner) {
      throw new Error(`No store receipt owner ${resolvedUserId} for ${receiptId}`);
    }

    const result = await client
      .update(storePurchase)
      .set({
        userId: resolvedUserId,
        originalUserId: canonicalOriginalUserId,
      })
      .where(
        and(
          eq(storePurchase.id, receipt.id),
          eq(storePurchase.userId, receipt.userId),
          eq(storePurchase.originalUserId, receipt.originalUserId),
        ),
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
 * Throws when the caller should retry — an unknown recipient, or a balance write that
 * failed — which the webhook turns into a 5xx. Everything it can decide for itself comes
 * back as an outcome.
 */
const grantStorePurchaseUnlocked = async (
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
  if (isDeletedStoreUserId(originalUserId)) {
    // Store receipts are an audit/idempotency ledger and deliberately survive account
    // deletion. A retry for a tombstoned owner is acknowledged without recreating value
    // or asking RevenueCat to retry forever for a UserData row that will never return.
    return { status: "ignored", reason: "Deleted user" };
  }
  let recipientUserId = federal
    ? await transferredUserId(client, originalUserId, grant.store, grant.purchasedAt)
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
          (await client.query.storeEntitlementState.findFirst({
            columns: { revokedThrough: true },
            where: and(
              eq(storeEntitlementState.userId, recipientUserId),
              eq(storeEntitlementState.store, grant.store),
              gte(storeEntitlementState.revokedThrough, grant.purchasedAt),
            ),
          })) ??
            (await client.query.storeEntitlementRevocation.findFirst({
              columns: { id: true },
              where: and(
                inArray(storeEntitlementRevocation.userId, [
                  recipientUserId,
                  originalUserId,
                ]),
                eq(storeEntitlementRevocation.store, grant.store),
                gte(storeEntitlementRevocation.revokedThrough, grant.purchasedAt),
                or(
                  isNull(storeEntitlementRevocation.productId),
                  eq(storeEntitlementRevocation.productId, grant.productId),
                ),
                or(
                  isNull(storeEntitlementRevocation.transactionId),
                  eq(storeEntitlementRevocation.transactionId, grant.transactionId),
                ),
              ),
            })),
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
    .where(eq(userData.userId, recipientUserId));
  if (!recipient) {
    throw new Error(
      `No user ${recipientUserId} for transaction ${grant.transactionId}`,
    );
  }

  let inserted = true;
  try {
    await client.insert(storePurchase).values({
      id: nanoid(),
      userId: recipientUserId,
      originalUserId,
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
    const storedReceipt = await client.query.storePurchase.findFirst({
      columns: {
        id: true,
        userId: true,
        originalUserId: true,
        productId: true,
        store: true,
        acceptedAt: true,
        grantedAt: true,
        revokedAt: true,
        expiresAt: true,
      },
      where: eq(storePurchase.transactionId, grant.transactionId),
    });
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
    const storedOriginalUserId = await canonicalStoreUserIdForUpdate(
      client,
      storedReceipt.originalUserId,
    );
    if (storedOriginalUserId !== originalUserId) return { status: "duplicate" };

    // This also repairs receipts inserted under a retired id by an older deployment. A
    // duplicate retry must not acknowledge that orphan while its grant remains pending.
    const owner = await reconcileStorePurchaseOwner(client, storedReceipt.id);
    recipientUserId = owner.userId;
    const receipt = await client.query.storePurchase.findFirst({
      columns: {
        acceptedAt: true,
        grantedAt: true,
        revokedAt: true,
        expiresAt: true,
      },
      where: eq(storePurchase.id, storedReceipt.id),
    });
    if (!receipt) throw new Error(`Missing store receipt ${storedReceipt.id}`);
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

    // The receipt deliberately remains durable when a later grant fails, so correctness
    // cannot depend on rolling both writes back. This multi-table UPDATE is one atomic SQL
    // statement: only the delivery that changes grantedAt from null can apply value.
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
            AND NOT EXISTS (
              SELECT 1 FROM ${storeEntitlementRevocation}
              WHERE (${storeEntitlementRevocation.userId} = ${storePurchase.userId}
                  OR ${storeEntitlementRevocation.userId} = ${storePurchase.originalUserId})
                AND ${storeEntitlementRevocation.store} = ${storePurchase.store}
                AND ${storeEntitlementRevocation.revokedThrough} >= ${storePurchase.purchasedAt}
                AND (${storeEntitlementRevocation.productId} IS NULL
                  OR ${storeEntitlementRevocation.productId} = ${storePurchase.productId})
                AND (${storeEntitlementRevocation.transactionId} IS NULL
                  OR ${storeEntitlementRevocation.transactionId} = ${storePurchase.transactionId})
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
      .where(eq(userData.userId, recipientUserId));
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

export const grantStorePurchase = async (
  client: DrizzleClient,
  grant: StoreGrant,
): Promise<GrantOutcome> =>
  await serializeStoreUserMutation(
    client,
    [grant.userId],
    async (lockedClient, [canonicalUserId]) =>
      await grantStorePurchaseUnlocked(lockedClient, {
        ...grant,
        userId: canonicalUserId ?? grant.userId,
      }),
  );

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
const extendStoreSubscriptionUnlocked = async (
  client: DrizzleClient,
  extension: StoreExtension,
): Promise<void> => {
  const canonicalUserId = await canonicalStoreUserId(client, extension.userId);
  const exact = extension.transactionId
    ? await client.query.storePurchase.findFirst({
        columns: { id: true, userId: true, revokedAt: true },
        where: and(
          eq(storePurchase.transactionId, extension.transactionId),
          eq(storePurchase.store, extension.store),
          eq(storePurchase.productId, extension.productId),
          isNotNull(storePurchase.acceptedAt),
          isNotNull(storePurchase.federalStatus),
        ),
      })
    : undefined;
  // A retry of a known, already-retired period is complete. Falling back to another live
  // receipt here would extend a resubscription with the old period's lifecycle event.
  if (exact?.revokedAt) return;
  const possibleOwners = await transferChainUserIds(
    client,
    canonicalUserId,
    extension.store,
  );
  const candidates = exact
    ? []
    : await client.query.storePurchase.findMany({
        columns: { id: true, userId: true, purchasedAt: true, revokedAt: true },
        where: and(
          inArray(storePurchase.userId, possibleOwners),
          eq(storePurchase.store, extension.store),
          eq(storePurchase.productId, extension.productId),
          isNotNull(storePurchase.acceptedAt),
          isNotNull(storePurchase.federalStatus),
          isNull(storePurchase.revokedAt),
        ),
        orderBy: desc(storePurchase.purchasedAt),
      });
  let receipt = exact;
  for (const candidate of candidates) {
    const owner = await transferredUserId(
      client,
      canonicalUserId,
      extension.store,
      candidate.purchasedAt,
    );
    if (owner === candidate.userId) {
      receipt = candidate;
      break;
    }
  }
  if (!receipt) {
    throw new Error(
      `No live receipt to extend for ${extension.userId}/${extension.productId}`,
    );
  }
  const ownerUserId = receipt.userId;

  await client
    .update(storePurchase)
    .set({
      expiresAt: sql`GREATEST(COALESCE(${storePurchase.expiresAt}, ${storePurchase.purchasedAt}), ${extension.expirationAt})`,
    })
    .where(eq(storePurchase.id, receipt.id));

  // The cleaner may have run before a delayed extension arrived. Re-derive immediately
  // so the newly durable entitlement also restores any tier it still pays for.
  const paypal = await paypalFederalFloor(client, ownerUserId);
  await setFederalStatusWithStoreFloor(client, ownerUserId, paypal);
};

export const extendStoreSubscription = async (
  client: DrizzleClient,
  extension: StoreExtension,
): Promise<void> =>
  await serializeStoreUserMutation(
    client,
    [extension.userId],
    async (lockedClient, [canonicalUserId]) =>
      await extendStoreSubscriptionUnlocked(lockedClient, {
        ...extension,
        userId: canonicalUserId ?? extension.userId,
      }),
  );

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
  /** Stable webhook event id, used to deduplicate the durable expiry fact. */
  eventId?: string;
  /** The moment the store says the subscription ended. */
  occurredAt: Date;
  /** The product that expired. Absent only on payloads that do not name one. */
  productId?: string | null;
  /** The store it expired on, so an Apple lapse cannot retire a Google receipt. */
  store?: StorePlatform | null;
  /** The expiring store transaction, when RevenueCat supplies it. */
  transactionId?: string | null;
}

const revokeFederalStatusUnlocked = async (
  client: DrizzleClient,
  userId: string,
  scope: RevocationScope,
): Promise<void> => {
  userId = await canonicalStoreUserId(client, userId);
  const { occurredAt, productId, store, transactionId } = scope;
  const exact =
    transactionId && store
      ? await client.query.storePurchase.findFirst({
          columns: {
            userId: true,
            purchasedAt: true,
            revokedAt: true,
            transactionId: true,
          },
          where: and(
            eq(storePurchase.transactionId, transactionId),
            eq(storePurchase.store, store),
            ...(productId ? [eq(storePurchase.productId, productId)] : []),
            isNotNull(storePurchase.federalStatus),
          ),
        })
      : undefined;
  // Revoking the receipt and recomputing the shared status are separate writes on
  // PlanetScale. A retry must repair the second write if the first delivery failed after
  // stamping revokedAt.
  if (exact?.revokedAt) {
    const paypal = await paypalFederalFloor(client, exact.userId);
    await setFederalStatusWithStoreFloor(client, exact.userId, paypal);
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
  const possibleOwners = store
    ? await transferChainUserIds(client, userId, store)
    : [userId];
  const candidates =
    !exact && productId
      ? await client.query.storePurchase.findMany({
          columns: {
            userId: true,
            purchasedAt: true,
            revokedAt: true,
            transactionId: true,
          },
          where: and(
            inArray(storePurchase.userId, possibleOwners),
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
      : [];
  let spent = exact;
  for (const candidate of candidates) {
    const owner = store
      ? await transferredUserId(client, userId, store, candidate.purchasedAt)
      : userId;
    if (owner === candidate.userId) {
      spent = candidate;
      break;
    }
  }
  const ownerUserId =
    exact?.userId ??
    spent?.userId ??
    (store ? await transferredUserId(client, userId, store, occurredAt) : userId);
  const cutoff = spent?.purchasedAt ?? (productId ? beforeExpiry : occurredAt);

  if (store) {
    const applicableTransactionId = transactionId ?? spent?.transactionId ?? null;
    const eventId =
      scope.eventId ??
      `scope:${applicableTransactionId ?? productId ?? "all"}:${occurredAt.toISOString()}`;
    await client
      .insert(storeEntitlementRevocation)
      .values({
        id: nanoid(),
        eventId,
        userId: ownerUserId,
        store,
        productId: productId ?? null,
        transactionId: applicableTransactionId,
        revokedThrough: cutoff,
        occurredAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          revokedThrough: sql`GREATEST(${storeEntitlementRevocation.revokedThrough}, ${cutoff})`,
        },
      });
  }

  // Persist the cutoff before touching receipts. If the purchase webhook has not inserted
  // its row yet, or races this handler, the grant's atomic claim checks this watermark and
  // cannot resurrect a subscription period the store has already ended.
  if (store) {
    await client
      .insert(storeEntitlementState)
      .values({
        id: nanoid(),
        userId: ownerUserId,
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
        eq(storePurchase.userId, ownerUserId),
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
  const paypal = await paypalFederalFloor(client, ownerUserId);
  await setFederalStatusWithStoreFloor(client, ownerUserId, paypal);
};

export const revokeFederalStatus = async (
  client: DrizzleClient,
  userId: string,
  scope: RevocationScope,
): Promise<void> =>
  await serializeStoreUserMutation(
    client,
    [userId],
    async (lockedClient, [canonicalUserId]) =>
      await revokeFederalStatusUnlocked(lockedClient, canonicalUserId ?? userId, scope),
  );

export interface StoreTransfer {
  /** Stable RevenueCat event id used to deduplicate retries. */
  eventId: string;
  fromUserIds: string[];
  toUserIds: string[];
  /** Missing when neither RevenueCat's store nor configured app id identifies a platform. */
  store?: StorePlatform | null;
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
  await client
    .update(storePurchaseTransfer)
    .set({ destinationUserId: newUserId, updatedAt: new Date() })
    .where(eq(storePurchaseTransfer.destinationUserId, oldUserId));

  const aliases = await client.query.storePurchaseTransfer.findMany({
    where: eq(storePurchaseTransfer.sourceUserId, oldUserId),
  });
  for (const alias of aliases) {
    if (alias.destinationUserId === newUserId) {
      await client
        .delete(storePurchaseTransfer)
        .where(eq(storePurchaseTransfer.id, alias.id));
      continue;
    }
    const collision = await client.query.storePurchaseTransfer.findFirst({
      columns: { id: true },
      where: and(
        eq(storePurchaseTransfer.sourceUserId, newUserId),
        eq(storePurchaseTransfer.store, alias.store),
        eq(storePurchaseTransfer.eventId, alias.eventId),
      ),
    });
    if (collision) {
      await client
        .update(storePurchaseTransfer)
        .set({
          destinationUserId: alias.destinationUserId,
          updatedAt: new Date(),
        })
        .where(eq(storePurchaseTransfer.id, collision.id));
      await client
        .delete(storePurchaseTransfer)
        .where(eq(storePurchaseTransfer.id, alias.id));
    } else {
      await client
        .update(storePurchaseTransfer)
        .set({ sourceUserId: newUserId, updatedAt: new Date() })
        .where(eq(storePurchaseTransfer.id, alias.id));
    }
  }
  await client
    .delete(storePurchaseTransfer)
    .where(
      and(
        eq(storePurchaseTransfer.sourceUserId, newUserId),
        eq(storePurchaseTransfer.destinationUserId, newUserId),
      ),
    );
};

/** Merge per-store revocation watermarks before an account id is renamed. */
export const migrateStoreEntitlementStates = async (
  client: DrizzleClient,
  oldUserId: string,
  newUserId: string,
): Promise<void> => {
  for (const store of STORE_PLATFORMS) {
    const oldState = await client.query.storeEntitlementState.findFirst({
      where: and(
        eq(storeEntitlementState.userId, oldUserId),
        eq(storeEntitlementState.store, store),
      ),
    });
    const newState = await client.query.storeEntitlementState.findFirst({
      where: and(
        eq(storeEntitlementState.userId, newUserId),
        eq(storeEntitlementState.store, store),
      ),
    });
    if (!oldState) continue;
    if (newState) {
      await client
        .update(storeEntitlementState)
        .set({
          revokedThrough:
            oldState.revokedThrough > newState.revokedThrough
              ? oldState.revokedThrough
              : newState.revokedThrough,
          updatedAt: new Date(),
        })
        .where(eq(storeEntitlementState.id, newState.id));
      await client
        .delete(storeEntitlementState)
        .where(eq(storeEntitlementState.id, oldState.id));
    } else {
      await client
        .update(storeEntitlementState)
        .set({ userId: newUserId, updatedAt: new Date() })
        .where(eq(storeEntitlementState.id, oldState.id));
    }
  }
};

/** Move durable per-event expiry facts across a staff user-id rename. */
export const migrateStoreEntitlementRevocations = async (
  client: DrizzleClient,
  oldUserId: string,
  newUserId: string,
): Promise<void> => {
  const revocations = await client.query.storeEntitlementRevocation.findMany({
    where: eq(storeEntitlementRevocation.userId, oldUserId),
  });
  for (const revocation of revocations) {
    const collision = await client.query.storeEntitlementRevocation.findFirst({
      columns: { id: true, revokedThrough: true },
      where: and(
        eq(storeEntitlementRevocation.eventId, revocation.eventId),
        eq(storeEntitlementRevocation.userId, newUserId),
        eq(storeEntitlementRevocation.store, revocation.store),
      ),
    });
    if (collision) {
      await client
        .update(storeEntitlementRevocation)
        .set({
          revokedThrough:
            collision.revokedThrough > revocation.revokedThrough
              ? collision.revokedThrough
              : revocation.revokedThrough,
        })
        .where(eq(storeEntitlementRevocation.id, collision.id));
      await client
        .delete(storeEntitlementRevocation)
        .where(eq(storeEntitlementRevocation.id, revocation.id));
    } else {
      await client
        .update(storeEntitlementRevocation)
        .set({ userId: newUserId })
        .where(eq(storeEntitlementRevocation.id, revocation.id));
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
const transferStorePurchasesUnlocked = async (
  client: DrizzleClient,
  transfer: StoreTransfer,
): Promise<{ destinationUserId: string; rowsAffected: number }> => {
  const canonicalFromIds: string[] = [];
  for (const id of transfer.fromUserIds.filter(Boolean)) {
    canonicalFromIds.push(await canonicalStoreUserId(client, id));
  }
  const fromIds = [...new Set(canonicalFromIds)];
  const canonicalToIds: string[] = [];
  for (const id of transfer.toUserIds.filter(Boolean)) {
    canonicalToIds.push(await canonicalStoreUserId(client, id));
  }
  const toIds = [...new Set(canonicalToIds)];
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
  const stores = transfer.store ? [transfer.store] : [...STORE_PLATFORMS];

  let rowsAffected = 0;
  const effectiveDestinations = new Set<string>([destinationUserId]);
  for (const store of stores) {
    for (const sourceUserId of sourceIds) {
      // Persist before moving rows. A concurrent grant then either sees the redirect up
      // front or leaves a durable receipt for the re-resolution below to re-home.
      await client
        .insert(storePurchaseTransfer)
        .values({
          id: nanoid(),
          eventId: transfer.eventId,
          sourceUserId,
          destinationUserId,
          store,
          transferredAt: transfer.occurredAt,
          updatedAt: new Date(),
        })
        .onDuplicateKeyUpdate({
          set: {
            // Keep the first destination and cutoff for this stable event. A retry must
            // not rewrite history from its arrival time or a changed payload.
            updatedAt: new Date(),
          },
        });

      const effectiveDestination = await transferredUserId(
        client,
        sourceUserId,
        store,
        transfer.occurredAt,
      );
      effectiveDestinations.add(effectiveDestination);
      const sourceEntitlementState = await client.query.storeEntitlementState.findFirst(
        {
          columns: { revokedThrough: true },
          where: and(
            eq(storeEntitlementState.userId, sourceUserId),
            eq(storeEntitlementState.store, store),
            lte(storeEntitlementState.revokedThrough, transfer.occurredAt),
          ),
        },
      );
      if (sourceEntitlementState && effectiveDestination !== sourceUserId) {
        // Ownership redirects apply to delayed expiries as well as delayed grants. Carry
        // the revocation watermark forward so an already-ended old period cannot become
        // live merely because its purchase webhook lands under the destination later.
        await client
          .insert(storeEntitlementState)
          .values({
            id: nanoid(),
            userId: effectiveDestination,
            store,
            revokedThrough: sourceEntitlementState.revokedThrough,
            updatedAt: new Date(),
          })
          .onDuplicateKeyUpdate({
            set: {
              revokedThrough: sql`GREATEST(${storeEntitlementState.revokedThrough}, ${sourceEntitlementState.revokedThrough})`,
              updatedAt: new Date(),
            },
          });
      }
      // A newer transfer may already have moved an older receipt away from sourceUserId.
      // Re-resolve every receipt whose original ownership path can reach this source so a
      // delayed epoch repairs the whole chronology, including later destinations.
      const originalUserIds = await transferPredecessorUserIds(
        client,
        sourceUserId,
        store,
      );
      const candidates = await client.query.storePurchase.findMany({
        columns: {
          id: true,
          userId: true,
          originalUserId: true,
          purchasedAt: true,
        },
        where: and(
          inArray(storePurchase.originalUserId, originalUserIds),
          eq(storePurchase.store, store),
          isNotNull(storePurchase.acceptedAt),
          isNotNull(storePurchase.federalStatus),
          isNull(storePurchase.revokedAt),
        ),
      });
      for (const receipt of candidates) {
        effectiveDestinations.add(receipt.userId);
        const reconciled = await reconcileStorePurchaseOwner(client, receipt.id);
        effectiveDestinations.add(reconciled.userId);
        if (reconciled.userId !== receipt.userId) rowsAffected += 1;
      }
    }
  }

  const knownSources =
    sourceIds.length > 0
      ? await client
          .select({ userId: userData.userId })
          .from(userData)
          .where(inArray(userData.userId, sourceIds))
      : [];
  for (const userId of new Set([
    ...knownSources.map((row) => row.userId),
    ...effectiveDestinations,
  ])) {
    const paypal = await paypalFederalFloor(client, userId);
    await setFederalStatusWithStoreFloor(client, userId, paypal);
  }

  return { destinationUserId, rowsAffected };
};

export const transferStorePurchases = async (
  client: DrizzleClient,
  transfer: StoreTransfer,
): Promise<{ destinationUserId: string; rowsAffected: number }> => {
  const sourceUserIds = transfer.fromUserIds.filter(Boolean);
  const destinationUserIds = transfer.toUserIds.filter(Boolean);
  const sourceCount = sourceUserIds.length;
  return await serializeStoreUserMutation(
    client,
    [...sourceUserIds, ...destinationUserIds],
    async (lockedClient, canonicalUserIds) =>
      await transferStorePurchasesUnlocked(lockedClient, {
        ...transfer,
        fromUserIds: canonicalUserIds.slice(0, sourceCount),
        toUserIds: canonicalUserIds.slice(sourceCount),
      }),
  );
};

/** Tombstone a deleted store identity while retaining receipt idempotency history. */
export const retireStoreUserId = async (
  client: DrizzleClient,
  userId: string,
): Promise<void> => {
  if (isReservedStoreUserId(userId)) return;
  await client.transaction(async (tx) => {
    const lockedClient = tx as unknown as DrizzleClient;
    await acquireStoreUserMutationLock(lockedClient);
    await lockedClient
      .select({ userId: userData.userId })
      .from(userData)
      .where(eq(userData.userId, userId))
      .for("update");
    const tombstone = `${DELETED_STORE_USER_PREFIX}${nanoid()}`;
    await lockedClient
      .update(storeUserIdAlias)
      .set({ newUserId: tombstone, updatedAt: new Date() })
      .where(eq(storeUserIdAlias.newUserId, userId));
    await lockedClient
      .insert(storeUserIdAlias)
      .values({ oldUserId: userId, newUserId: tombstone, updatedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { newUserId: tombstone, updatedAt: new Date() } });
  });
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

/**
 * Re-derive every non-NONE or currently subscribed player's tier in one correlated write.
 *
 * This is the bulk cleaner counterpart of `setFederalStatusWithStoreFloor`: GOLD wins over
 * SILVER, which wins over NORMAL, across both active PayPal rows and live store receipts.
 * It therefore performs downgrades as well as clearing or restoring a status.
 */
export const reconcileFederalStatuses = async (
  client: Pick<DrizzleClient, "execute">,
) =>
  await client.execute(sql`
    UPDATE ${userData} u
    SET u.federalStatus = CASE
      WHEN EXISTS (
        SELECT 1 FROM ${paypalSubscription} p
        WHERE p.affectedUserId = u.userId
          AND p.status = 'ACTIVE'
          AND p.updatedAt >= CURRENT_TIMESTAMP(3) - INTERVAL 31 DAY
          AND p.federalStatus = 'GOLD'
      ) OR EXISTS (
        SELECT 1 FROM ${storePurchase} s
        WHERE s.userId = u.userId
          AND s.federalStatus = 'GOLD'
          AND s.acceptedAt IS NOT NULL
          AND s.revokedAt IS NULL
          AND (s.expiresAt >= CURRENT_TIMESTAMP(3) OR (s.expiresAt IS NULL AND s.createdAt >= CURRENT_TIMESTAMP(3) - INTERVAL 63 DAY))
      ) THEN 'GOLD'
      WHEN EXISTS (
        SELECT 1 FROM ${paypalSubscription} p
        WHERE p.affectedUserId = u.userId
          AND p.status = 'ACTIVE'
          AND p.updatedAt >= CURRENT_TIMESTAMP(3) - INTERVAL 31 DAY
          AND p.federalStatus = 'SILVER'
      ) OR EXISTS (
        SELECT 1 FROM ${storePurchase} s
        WHERE s.userId = u.userId
          AND s.federalStatus = 'SILVER'
          AND s.acceptedAt IS NOT NULL
          AND s.revokedAt IS NULL
          AND (s.expiresAt >= CURRENT_TIMESTAMP(3) OR (s.expiresAt IS NULL AND s.createdAt >= CURRENT_TIMESTAMP(3) - INTERVAL 63 DAY))
      ) THEN 'SILVER'
      WHEN EXISTS (
        SELECT 1 FROM ${paypalSubscription} p
        WHERE p.affectedUserId = u.userId
          AND p.status = 'ACTIVE'
          AND p.updatedAt >= CURRENT_TIMESTAMP(3) - INTERVAL 31 DAY
          AND p.federalStatus = 'NORMAL'
      ) OR EXISTS (
        SELECT 1 FROM ${storePurchase} s
        WHERE s.userId = u.userId
          AND s.federalStatus = 'NORMAL'
          AND s.acceptedAt IS NOT NULL
          AND s.revokedAt IS NULL
          AND (s.expiresAt >= CURRENT_TIMESTAMP(3) OR (s.expiresAt IS NULL AND s.createdAt >= CURRENT_TIMESTAMP(3) - INTERVAL 63 DAY))
      ) THEN 'NORMAL'
      ELSE 'NONE'
    END
    WHERE u.federalStatus != 'NONE'
      OR EXISTS (
        SELECT 1 FROM ${paypalSubscription} p
        WHERE p.affectedUserId = u.userId
          AND p.status = 'ACTIVE'
          AND p.updatedAt >= CURRENT_TIMESTAMP(3) - INTERVAL 31 DAY
      )
      OR EXISTS (
        SELECT 1 FROM ${storePurchase} s
        WHERE s.userId = u.userId
          AND s.federalStatus IS NOT NULL
          AND s.acceptedAt IS NOT NULL
          AND s.revokedAt IS NULL
          AND (s.expiresAt >= CURRENT_TIMESTAMP(3) OR (s.expiresAt IS NULL AND s.createdAt >= CURRENT_TIMESTAMP(3) - INTERVAL 63 DAY))
      )
  `);
