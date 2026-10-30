/**
 * Database access for purchases; authorization and transaction scopes stay in callers.
 */
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
  type SQL,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import type { FederalStatus } from "@/drizzle/constants";
import {
  paypalSubscription,
  paypalTransaction,
  storeEntitlementRevocation,
  storeEntitlementState,
  storePurchase,
  storePurchaseTransfer,
  storeUserIdAlias,
  stripeCheckout,
  stripePayment,
  userData,
  webStoreOrder,
} from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import type { DrizzleClient } from "@/server/db";
import {
  completedQuestHistoryRelation,
  userQuestHistoryRelation,
} from "@/server/utils/achievementObjectives";

/** Build the `storePurchase` selection for `recent`, including predicates on `userId`, `transactionId`, `productId`. */
export const selectStorePurchaseForRecent = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
  input: {
    transactionId?: undefined | string;
    productId?: undefined | string;
    createdAfter?: undefined | Date;
    limit: number;
  },
) =>
  client
    .select({
      id: storePurchase.id,
      transactionId: storePurchase.transactionId,
      productId: storePurchase.productId,
      store: storePurchase.store,
      reputationPoints: storePurchase.reputationPoints,
      federalStatus: storePurchase.federalStatus,
      acceptedAt: storePurchase.acceptedAt,
      grantedAt: storePurchase.grantedAt,
      revokedAt: storePurchase.revokedAt,
      expiresAt: storePurchase.expiresAt,
      createdAt: storePurchase.createdAt,
    })
    .from(storePurchase)
    .where(
      and(
        eq(storePurchase.userId, ctx.userId),
        ...(input.transactionId
          ? [eq(storePurchase.transactionId, input.transactionId)]
          : []),
        ...(input.productId ? [eq(storePurchase.productId, input.productId)] : []),
        ...(input.createdAfter
          ? [gte(storePurchase.createdAt, input.createdAfter)]
          : []),
      ),
    )
    .orderBy(desc(storePurchase.createdAt))
    .limit(input.limit);

/** Build the `userData` selection for `reputationAllowanceUsed`, using predicates on `userId`. */
export const selectUserDataForReputationAllowanceUsed = (
  client: Pick<DrizzleClient, "select">,
  buyerId: string,
  excludedPaypalId: string,
  excludedStripeId: string,
  STRIPE_CHECKOUT_RESERVATION_SECONDS: number,
  excludedStoreId: string,
) =>
  client
    .select({
      total: sql<number>`
    COALESCE((SELECT SUM(p.reputationPoints) FROM ${paypalTransaction} p
      WHERE p.createdById = ${buyerId} AND p.id != ${excludedPaypalId}
        AND p.type = 'REP_PURCHASE'
        AND p.createdAt >= NOW() - INTERVAL 30 DAY
        AND p.status NOT IN ('CANCELLED', 'REVIEW_REQUIRED')
        AND (p.status != 'RESERVED' OR p.createdAt >= NOW() - INTERVAL 3 HOUR)), 0)
    + COALESCE((SELECT SUM(p.reputationPoints) FROM ${stripePayment} p
      WHERE p.createdById = ${buyerId} AND p.grantedAt IS NOT NULL
        ${env.NODE_ENV === "production" ? sql`AND p.isSandbox = FALSE` : sql``}
        AND p.purchasedAt >= NOW() - INTERVAL 30 DAY), 0)
    + COALESCE((SELECT SUM(c.reputationPoints) FROM ${stripeCheckout} c
      WHERE c.createdById = ${buyerId} AND c.id != ${excludedStripeId}
        AND c.closedAt IS NULL AND c.createdAt >= NOW() - INTERVAL ${STRIPE_CHECKOUT_RESERVATION_SECONDS} SECOND
        AND NOT EXISTS (SELECT 1 FROM ${stripePayment} p
          WHERE p.checkoutId = c.id AND p.grantedAt IS NOT NULL)), 0)
    + COALESCE((SELECT SUM(JSON_EXTRACT(w.contents, '$.reputationPoints')) FROM ${webStoreOrder} w
      WHERE w.buyerId = ${buyerId} AND w.id != ${excludedStoreId}
        AND w.grantedAt IS NULL AND w.expiresAt > NOW()), 0)
  `.mapWith(Number),
    })
    .from(userData)
    .where(eq(userData.userId, buyerId));

/** Build the `userData` update for `lockPurchaseBuyer`, setting `updatedAt`, using predicates on `userId`. */
export const updateUserDataForLockPurchaseBuyer = (
  client: Pick<DrizzleClient, "update">,
  buyerId: string,
) =>
  client
    .update(userData)
    .set({
      updatedAt: sql`GREATEST(CURRENT_TIMESTAMP(3), ${userData.updatedAt} + INTERVAL 1000 MICROSECOND)`,
    })
    .where(eq(userData.userId, buyerId));

/** Build the replacement user ID lookup for a retired user ID. */
export const findStoreUserIdAlias = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.storeUserIdAlias.findFirst({
    columns: { newUserId: true },
    where: eq(storeUserIdAlias.oldUserId, userId),
  });

/**
 * Build the `storePurchaseTransfer` listing for `transferredUserId`, including
 * predicates on `sourceUserId`, `store`, `isSandbox`.
 */
export const listStorePurchaseTransferForTransferredUserId = (
  client: Pick<DrizzleClient, "query">,
  current: string,
  store: "APPLE" | "GOOGLE",
  isSandbox: false | true,
  cursor: Date,
) =>
  client.query.storePurchaseTransfer.findMany({
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
      eq(storePurchaseTransfer.isSandbox, isSandbox),
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

/**
 * Build the `storePurchaseTransfer` listing for `transferPredecessorUserIds`,
 * selecting only `sourceUserId`, using predicates on `destinationUserId`, `store`,
 * `isSandbox`.
 */
export const listStorePurchaseTransferForTransferPredecessorUserIds = (
  client: Pick<DrizzleClient, "query">,
  current: string,
  store: "APPLE" | "GOOGLE",
  isSandbox: false | true,
) =>
  client.query.storePurchaseTransfer.findMany({
    columns: { sourceUserId: true },
    where: and(
      eq(storePurchaseTransfer.destinationUserId, current),
      eq(storePurchaseTransfer.store, store),
      eq(storePurchaseTransfer.isSandbox, isSandbox),
    ),
  });

/**
 * Build the `storePurchaseTransfer` listing for `transferChainUserIds`, selecting only
 * `destinationUserId`, using predicates on `sourceUserId`, `store`, `isSandbox`.
 */
export const listStorePurchaseTransferForTransferChainUserIds = (
  client: Pick<DrizzleClient, "query">,
  current: string,
  store: "APPLE" | "GOOGLE",
  isSandbox: false | true,
) =>
  client.query.storePurchaseTransfer.findMany({
    columns: { destinationUserId: true },
    where: and(
      eq(storePurchaseTransfer.sourceUserId, current),
      eq(storePurchaseTransfer.store, store),
      eq(storePurchaseTransfer.isSandbox, isSandbox),
    ),
    orderBy: asc(storePurchaseTransfer.transferredAt),
  });

/** Build the `storePurchase` selection for `reconcileStorePurchaseOwner`, using predicates on `id`. */
export const selectStorePurchaseForReconcileStorePurchaseOwner = (
  client: Pick<DrizzleClient, "select">,
  receiptId: string,
) =>
  client
    .select({
      id: storePurchase.id,
      userId: storePurchase.userId,
      originalUserId: storePurchase.originalUserId,
      purchasedAt: storePurchase.purchasedAt,
      store: storePurchase.store,
      federalStatus: storePurchase.federalStatus,
      isSandbox: storePurchase.isSandbox,
      acceptedAt: storePurchase.acceptedAt,
    })
    .from(storePurchase)
    .where(eq(storePurchase.id, receiptId));

/**
 * Build the `storePurchase` update for `reconcileStorePurchaseOwner`, including
 * predicates on `id`, `userId`, `originalUserId`.
 */
export const updateStorePurchaseForReconcileStorePurchaseOwner = (
  client: Pick<DrizzleClient, "update">,
  resolvedUserId: string,
  canonicalOriginalUserId: string,
  shouldAccept: false | true,
  receipt: {
    acceptedAt: null | Date;
    id: string;
    userId: string;
    originalUserId: string;
  },
) =>
  client
    .update(storePurchase)
    .set({
      userId: resolvedUserId,
      originalUserId: canonicalOriginalUserId,
      // Acceptance follows the current owner, not the account which happened to own
      // the receipt when it was inserted. This lets a sandbox entitlement stop at an
      // ordinary account and become eligible again if RevenueCat restores it to the
      // allowlisted review account later.
      acceptedAt: shouldAccept ? (receipt.acceptedAt ?? new Date()) : null,
    })
    .where(
      and(
        eq(storePurchase.id, receipt.id),
        eq(storePurchase.userId, receipt.userId),
        eq(storePurchase.originalUserId, receipt.originalUserId),
        receipt.acceptedAt
          ? eq(storePurchase.acceptedAt, receipt.acceptedAt)
          : isNull(storePurchase.acceptedAt),
      ),
    );

/**
 * Build the `storeEntitlementState` lookup for `retireIfExpired`, selecting only
 * `revokedThrough`, including predicates on `userId`, `store`, `isSandbox`.
 */
export const findStoreEntitlementStateForRetireIfExpired = (
  client: Pick<DrizzleClient, "query">,
  recipientUserId: string,
  grant: { store: "APPLE" | "GOOGLE"; isSandbox: false | true; purchasedAt: Date },
) =>
  client.query.storeEntitlementState.findFirst({
    columns: { revokedThrough: true },
    where: and(
      eq(storeEntitlementState.userId, recipientUserId),
      eq(storeEntitlementState.store, grant.store),
      eq(storeEntitlementState.isSandbox, grant.isSandbox),
      gte(storeEntitlementState.revokedThrough, grant.purchasedAt),
    ),
  });

/**
 * Build the `storeEntitlementRevocation` lookup for `retireIfExpired`, selecting only
 * `id`, including predicates on `userId`, `store`, `isSandbox`.
 */
export const findStoreEntitlementRevocationForRetireIfExpired = (
  client: Pick<DrizzleClient, "query">,
  recipientUserId: string,
  originalUserId: string,
  grant: {
    store: "APPLE" | "GOOGLE";
    isSandbox: false | true;
    purchasedAt: Date;
    productId: string;
    transactionId: string;
  },
) =>
  client.query.storeEntitlementRevocation.findFirst({
    columns: { id: true },
    where: and(
      inArray(storeEntitlementRevocation.userId, [recipientUserId, originalUserId]),
      eq(storeEntitlementRevocation.store, grant.store),
      eq(storeEntitlementRevocation.isSandbox, grant.isSandbox),
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
  });

/**
 * Build the `storePurchase` update for `retireIfExpired`, setting `revokedAt`, using
 * predicates on `transactionId` and `grantedAt`.
 */
export const updateStorePurchaseForRetireIfExpired = (
  client: Pick<DrizzleClient, "update">,
  grant: { transactionId: string },
) =>
  client
    .update(storePurchase)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(storePurchase.transactionId, grant.transactionId),
        isNull(storePurchase.grantedAt),
      ),
    );

/** Build the `storePurchase` insert for `applyStorePurchase`. */
export const insertStorePurchaseForApplyStorePurchase = (
  client: Pick<DrizzleClient, "insert">,
  recipientUserId: string,
  originalUserId: string,
  grant: {
    transactionId: string;
    productId: string;
    store: "APPLE" | "GOOGLE";
    isSandbox: false | true;
    purchasedAt: Date;
    expiresAt?: undefined | null | Date;
    raw: unknown;
  },
  reps: { reputationPoints: undefined | 20 | 8 | 49 | 164 | 407 } | undefined,
  federal: { federalStatus: undefined | "NORMAL" | "SILVER" | "GOLD" } | undefined,
  accepted: false | true,
) =>
  client.insert(storePurchase).values({
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

/** Build the `storePurchase` lookup for `applyStorePurchase`, using predicates on `transactionId`. */
export const findStorePurchaseForApplyStorePurchase = (
  client: Pick<DrizzleClient, "query">,
  grant: { transactionId: string },
) =>
  client.query.storePurchase.findFirst({
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

/** Build the `storePurchase` lookup for `applyStorePurchase`, using predicates on `id`. */
export const findStorePurchaseForApplyStorePurchase2 = (
  client: Pick<DrizzleClient, "query">,
  storedReceipt: { id: string },
) =>
  client.query.storePurchase.findFirst({
    columns: {
      acceptedAt: true,
      grantedAt: true,
      revokedAt: true,
      expiresAt: true,
    },
    where: eq(storePurchase.id, storedReceipt.id),
  });

/** Execute the database statement for `applyStorePurchase`. */
export const executeResultForApplyStorePurchase = (
  client: Pick<DrizzleClient, "execute">,
  reps: { reputationPoints: 20 | 8 | 49 | 164 | 407 },
  grant: { transactionId: string },
) =>
  client.execute(sql`
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
        `);

/** Execute the database statement for `applyStorePurchase`. */
export const executeResultForApplyStorePurchase2 = (
  client: Pick<DrizzleClient, "execute">,
  rankOf: (status: FederalStatus) => number,
  federal: { federalStatus: undefined | "NORMAL" | "SILVER" | "GOLD" } | undefined,
  grant: { transactionId: string },
) =>
  client.execute(sql`
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
                AND ${storeEntitlementState.isSandbox} = ${storePurchase.isSandbox}
                AND ${storeEntitlementState.revokedThrough} >= ${storePurchase.purchasedAt}
            )
            AND NOT EXISTS (
              SELECT 1 FROM ${storeEntitlementRevocation}
              WHERE (${storeEntitlementRevocation.userId} = ${storePurchase.userId}
                  OR ${storeEntitlementRevocation.userId} = ${storePurchase.originalUserId})
                AND ${storeEntitlementRevocation.store} = ${storePurchase.store}
                AND ${storeEntitlementRevocation.isSandbox} = ${storePurchase.isSandbox}
                AND ${storeEntitlementRevocation.revokedThrough} >= ${storePurchase.purchasedAt}
                AND (${storeEntitlementRevocation.productId} IS NULL
                  OR ${storeEntitlementRevocation.productId} = ${storePurchase.productId})
                AND (${storeEntitlementRevocation.transactionId} IS NULL
                  OR ${storeEntitlementRevocation.transactionId} = ${storePurchase.transactionId})
            )
        `);

/** Build the `storePurchase` lookup for `applyStorePurchase`, using predicates on `transactionId`. */
export const findStorePurchaseForApplyStorePurchase3 = (
  client: Pick<DrizzleClient, "query">,
  grant: { transactionId: string },
) =>
  client.query.storePurchase.findFirst({
    columns: { grantedAt: true, revokedAt: true, expiresAt: true },
    where: eq(storePurchase.transactionId, grant.transactionId),
  });

/** Build the `userData` selection for `applyStorePurchase`, using predicates on `userId`. */
export const selectUserDataForApplyStorePurchase2 = (
  client: Pick<DrizzleClient, "select">,
  recipientUserId: string,
) =>
  client
    .select({ federalStatus: userData.federalStatus })
    .from(userData)
    .where(eq(userData.userId, recipientUserId));

/**
 * Build the `storePurchase` listing for `settleRecordedLedger`, including predicates
 * on `userId`, `acceptedAt`, `grantedAt`.
 */
export const listStorePurchaseForSettleRecordedLedger = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.storePurchase.findMany({
    columns: {
      originalUserId: true,
      transactionId: true,
      productId: true,
      store: true,
      isSandbox: true,
      purchasedAt: true,
      expiresAt: true,
      rawData: true,
    },
    where: and(
      eq(storePurchase.userId, userId),
      isNotNull(storePurchase.acceptedAt),
      isNull(storePurchase.grantedAt),
      isNull(storePurchase.revokedAt),
    ),
  });

/**
 * Build the `storePurchase` lookup for `applyStoreExtension`, including predicates on
 * `transactionId`, `store`, `productId`.
 */
export const findStorePurchaseForApplyStoreExtension = (
  client: Pick<DrizzleClient, "query">,
  extension: { transactionId: string; store: "APPLE" | "GOOGLE"; productId: string },
  isSandbox: false | true,
) =>
  client.query.storePurchase.findFirst({
    columns: { id: true, userId: true, revokedAt: true },
    where: and(
      eq(storePurchase.transactionId, extension.transactionId),
      eq(storePurchase.store, extension.store),
      eq(storePurchase.productId, extension.productId),
      eq(storePurchase.isSandbox, isSandbox),
      isNotNull(storePurchase.federalStatus),
    ),
  });

/** Build the `storePurchase` listing for `applyStoreExtension`, including predicates on `userId`, `store`, `productId`. */
export const listStorePurchaseForApplyStoreExtension = (
  client: Pick<DrizzleClient, "query">,
  possibleOwners: string[],
  extension: { store: "APPLE" | "GOOGLE"; productId: string },
  isSandbox: false | true,
) =>
  client.query.storePurchase.findMany({
    columns: { id: true, userId: true, purchasedAt: true, revokedAt: true },
    where: and(
      inArray(storePurchase.userId, possibleOwners),
      eq(storePurchase.store, extension.store),
      eq(storePurchase.productId, extension.productId),
      eq(storePurchase.isSandbox, isSandbox),
      isNotNull(storePurchase.federalStatus),
      isNull(storePurchase.revokedAt),
    ),
    orderBy: desc(storePurchase.purchasedAt),
  });

/**
 * Build the `storePurchase` listing for `applyStoreExtension`, selecting only
 * `expiresAt` and `purchasedAt`, including predicates on `userId`, `store`,
 * `productId`.
 */
export const listStorePurchaseForApplyStoreExtension2 = (
  client: Pick<DrizzleClient, "query">,
  possibleOwners: string[],
  extension: { store: "APPLE" | "GOOGLE"; productId: string },
  isSandbox: false | true,
) =>
  client.query.storePurchase.findMany({
    columns: { expiresAt: true, purchasedAt: true },
    where: and(
      inArray(storePurchase.userId, possibleOwners),
      eq(storePurchase.store, extension.store),
      eq(storePurchase.productId, extension.productId),
      eq(storePurchase.isSandbox, isSandbox),
      isNotNull(storePurchase.federalStatus),
      isNotNull(storePurchase.revokedAt),
    ),
  });

/** Build the `storePurchase` update for `applyStoreExtension`, setting `expiresAt`, using predicates on `id`. */
export const updateStorePurchaseForApplyStoreExtension = (
  client: Pick<DrizzleClient, "update">,
  extension: { expirationAt: Date },
  receipt: { id: string },
) =>
  client
    .update(storePurchase)
    .set({
      expiresAt: sql`GREATEST(COALESCE(${storePurchase.expiresAt}, ${storePurchase.purchasedAt}), ${extension.expirationAt})`,
    })
    .where(eq(storePurchase.id, receipt.id));

/** Build the `storePurchase` lookup for `applyStoreExtension`, selecting only `userId`, using predicates on `id`. */
export const findStorePurchaseForApplyStoreExtension2 = (
  client: Pick<DrizzleClient, "query">,
  receipt: { id: string },
) =>
  client.query.storePurchase.findFirst({
    columns: { userId: true },
    where: eq(storePurchase.id, receipt.id),
  });

/**
 * Build the `storePurchase` lookup for `applyFederalRevocation`, including predicates
 * on `transactionId`, `store`, `productId`.
 */
export const findStorePurchaseForApplyFederalRevocation = (
  client: Pick<DrizzleClient, "query">,
  transactionId: string,
  store: "APPLE" | "GOOGLE",
  productId: undefined | null | string,
  isSandbox: false | true,
) =>
  client.query.storePurchase.findFirst({
    columns: {
      id: true,
      userId: true,
      purchasedAt: true,
      revokedAt: true,
      transactionId: true,
    },
    where: and(
      eq(storePurchase.transactionId, transactionId),
      eq(storePurchase.store, store),
      ...(productId ? [eq(storePurchase.productId, productId)] : []),
      eq(storePurchase.isSandbox, isSandbox),
      isNotNull(storePurchase.federalStatus),
    ),
  });

/**
 * Build the `storePurchase` listing for `applyFederalRevocation`, including predicates
 * on `userId`, `productId`, `federalStatus`.
 */
export const listStorePurchaseForApplyFederalRevocation = (
  client: Pick<DrizzleClient, "query">,
  possibleOwners: string[],
  productId: string,
  occurredAt: Date,
  store: undefined | null | "APPLE" | "GOOGLE",
  isSandbox: false | true,
) =>
  client.query.storePurchase.findMany({
    columns: {
      id: true,
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
      eq(storePurchase.isSandbox, isSandbox),
    ),
    orderBy: desc(storePurchase.purchasedAt),
  });

/** Build the `storeEntitlementRevocation` insert for `applyFederalRevocation`, updating duplicate keys. */
export const insertStoreEntitlementRevocationForApplyFederalRevocation = (
  client: Pick<DrizzleClient, "insert">,
  eventId: string,
  ownerUserId: string,
  store: "APPLE" | "GOOGLE",
  isSandbox: false | true,
  productId: undefined | null | string,
  applicableTransactionId: null | string,
  cutoff: Date,
  occurredAt: Date,
) =>
  client
    .insert(storeEntitlementRevocation)
    .values({
      id: nanoid(),
      eventId,
      userId: ownerUserId,
      store,
      isSandbox,
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

/** Build the entitlement watermark upsert for revocations and transfers, retaining the latest cutoff. */
export const insertStoreEntitlementStateForApplyFederalRevocation = (
  client: Pick<DrizzleClient, "insert">,
  ownerUserId: string,
  store: "APPLE" | "GOOGLE",
  isSandbox: false | true,
  cutoff: Date,
) =>
  client
    .insert(storeEntitlementState)
    .values({
      id: nanoid(),
      userId: ownerUserId,
      store,
      isSandbox,
      revokedThrough: cutoff,
      updatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        revokedThrough: sql`GREATEST(revokedThrough, ${cutoff})`,
        updatedAt: new Date(),
      },
    });

/**
 * Build the `storePurchase` update for `applyFederalRevocation`, setting `revokedAt`,
 * including predicates on `userId`, `federalStatus`, `revokedAt`.
 */
export const updateStorePurchaseForApplyFederalRevocation = (
  client: Pick<DrizzleClient, "update">,
  ownerUserId: string,
  cutoff: Date,
  store: undefined | null | "APPLE" | "GOOGLE",
  isSandbox: false | true,
) =>
  client
    .update(storePurchase)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(storePurchase.userId, ownerUserId),
        isNotNull(storePurchase.federalStatus),
        isNull(storePurchase.revokedAt),
        lte(storePurchase.purchasedAt, cutoff),
        // Bounded to the store the expiry came from: the two are billed independently,
        // and the product ids are the same strings on both, so a lapse on one must not
        // retire the other's receipts.
        ...(store ? [eq(storePurchase.store, store)] : []),
        eq(storePurchase.isSandbox, isSandbox),
      ),
    );

/**
 * Build the `storePurchase` lookup for `applyFederalRevocation`, selecting only
 * `userId` and `revokedAt`, using predicates on `id`.
 */
export const findStorePurchaseForApplyFederalRevocation2 = (
  client: Pick<DrizzleClient, "query">,
  receiptId: string,
) =>
  client.query.storePurchase.findFirst({
    columns: { userId: true, revokedAt: true },
    where: eq(storePurchase.id, receiptId),
  });

/**
 * Build the `storePurchaseTransfer` update for `migrateStorePurchaseTransfers`,
 * setting `destinationUserId` and `updatedAt`, using predicates on
 * `destinationUserId`.
 */
export const updateStorePurchaseTransferForMigrateStorePurchaseTransfers = (
  client: Pick<DrizzleClient, "update">,
  newUserId: string,
  oldUserId: string,
) =>
  client
    .update(storePurchaseTransfer)
    .set({ destinationUserId: newUserId, updatedAt: new Date() })
    .where(eq(storePurchaseTransfer.destinationUserId, oldUserId));

/** Build the `storePurchaseTransfer` listing for `migrateStorePurchaseTransfers`, using predicates on `sourceUserId`. */
export const listStorePurchaseTransferForMigrateStorePurchaseTransfers = (
  client: Pick<DrizzleClient, "query">,
  oldUserId: string,
) =>
  client.query.storePurchaseTransfer.findMany({
    where: eq(storePurchaseTransfer.sourceUserId, oldUserId),
  });

/** Build the `storePurchaseTransfer` deletion for `migrateStorePurchaseTransfers`, using predicates on `id`. */
export const deleteStorePurchaseTransferForMigrateStorePurchaseTransfers = (
  client: Pick<DrizzleClient, "delete">,
  alias: { id: string },
) => client.delete(storePurchaseTransfer).where(eq(storePurchaseTransfer.id, alias.id));

/**
 * Build the `storePurchaseTransfer` lookup for `migrateStorePurchaseTransfers`,
 * selecting only `id`, including predicates on `sourceUserId`, `store`, `isSandbox`.
 */
export const findStorePurchaseTransferForMigrateStorePurchaseTransfers = (
  client: Pick<DrizzleClient, "query">,
  newUserId: string,
  alias: { store: "APPLE" | "GOOGLE"; isSandbox: false | true; eventId: string },
) =>
  client.query.storePurchaseTransfer.findFirst({
    columns: { id: true },
    where: and(
      eq(storePurchaseTransfer.sourceUserId, newUserId),
      eq(storePurchaseTransfer.store, alias.store),
      eq(storePurchaseTransfer.isSandbox, alias.isSandbox),
      eq(storePurchaseTransfer.eventId, alias.eventId),
    ),
  });

/**
 * Build the `storePurchaseTransfer` update for `migrateStorePurchaseTransfers`,
 * setting `destinationUserId` and `updatedAt`, using predicates on `id`.
 */
export const updateStorePurchaseTransferForMigrateStorePurchaseTransfers2 = (
  client: Pick<DrizzleClient, "update">,
  alias: { destinationUserId: string },
  collision: { id: string },
) =>
  client
    .update(storePurchaseTransfer)
    .set({
      destinationUserId: alias.destinationUserId,
      updatedAt: new Date(),
    })
    .where(eq(storePurchaseTransfer.id, collision.id));

/**
 * Build the `storePurchaseTransfer` update for `migrateStorePurchaseTransfers`,
 * setting `sourceUserId` and `updatedAt`, using predicates on `id`.
 */
export const updateStorePurchaseTransferForMigrateStorePurchaseTransfers3 = (
  client: Pick<DrizzleClient, "update">,
  newUserId: string,
  alias: { id: string },
) =>
  client
    .update(storePurchaseTransfer)
    .set({ sourceUserId: newUserId, updatedAt: new Date() })
    .where(eq(storePurchaseTransfer.id, alias.id));

/**
 * Build the `storePurchaseTransfer` deletion for `migrateStorePurchaseTransfers`,
 * using predicates on `sourceUserId` and `destinationUserId`.
 */
export const deleteStorePurchaseTransferForMigrateStorePurchaseTransfers2 = (
  client: Pick<DrizzleClient, "delete">,
  newUserId: string,
) =>
  client
    .delete(storePurchaseTransfer)
    .where(
      and(
        eq(storePurchaseTransfer.sourceUserId, newUserId),
        eq(storePurchaseTransfer.destinationUserId, newUserId),
      ),
    );

/**
 * Build the `storeEntitlementState` lookup for `migrateStoreEntitlementStates`, using
 * predicates on `userId`, `store`, `isSandbox`.
 */
export const findStoreEntitlementStateForMigrateStoreEntitlementStates = (
  client: Pick<DrizzleClient, "query">,
  oldUserId: string,
  store: "APPLE" | "GOOGLE",
  isSandbox: false | true,
) =>
  client.query.storeEntitlementState.findFirst({
    where: and(
      eq(storeEntitlementState.userId, oldUserId),
      eq(storeEntitlementState.store, store),
      eq(storeEntitlementState.isSandbox, isSandbox),
    ),
  });

/**
 * Build the `storeEntitlementState` update for `migrateStoreEntitlementStates`,
 * setting `revokedThrough` and `updatedAt`, using predicates on `id`.
 */
export const updateStoreEntitlementStateForMigrateStoreEntitlementStates = (
  client: Pick<DrizzleClient, "update">,
  oldState: { revokedThrough: Date },
  newState: { revokedThrough: Date; id: string },
) =>
  client
    .update(storeEntitlementState)
    .set({
      revokedThrough:
        oldState.revokedThrough > newState.revokedThrough
          ? oldState.revokedThrough
          : newState.revokedThrough,
      updatedAt: new Date(),
    })
    .where(eq(storeEntitlementState.id, newState.id));

/** Build the `storeEntitlementState` deletion for `migrateStoreEntitlementStates`, using predicates on `id`. */
export const deleteStoreEntitlementStateForMigrateStoreEntitlementStates = (
  client: Pick<DrizzleClient, "delete">,
  oldState: { id: string },
) =>
  client.delete(storeEntitlementState).where(eq(storeEntitlementState.id, oldState.id));

/**
 * Build the `storeEntitlementState` update for `migrateStoreEntitlementStates`,
 * setting `userId` and `updatedAt`, using predicates on `id`.
 */
export const updateStoreEntitlementStateForMigrateStoreEntitlementStates2 = (
  client: Pick<DrizzleClient, "update">,
  newUserId: string,
  oldState: { id: string },
) =>
  client
    .update(storeEntitlementState)
    .set({ userId: newUserId, updatedAt: new Date() })
    .where(eq(storeEntitlementState.id, oldState.id));

/** Build the `storeEntitlementRevocation` listing for `migrateStoreEntitlementRevocations`, using predicates on `userId`. */
export const listStoreEntitlementRevocationForMigrateStoreEntitlementRevocations = (
  client: Pick<DrizzleClient, "query">,
  oldUserId: string,
) =>
  client.query.storeEntitlementRevocation.findMany({
    where: eq(storeEntitlementRevocation.userId, oldUserId),
  });

/**
 * Build the `storeEntitlementRevocation` lookup for
 * `migrateStoreEntitlementRevocations`, selecting only `id` and `revokedThrough`,
 * including predicates on `eventId`, `userId`, `store`.
 */
export const findStoreEntitlementRevocationForMigrateStoreEntitlementRevocations = (
  client: Pick<DrizzleClient, "query">,
  revocation: { eventId: string; store: "APPLE" | "GOOGLE"; isSandbox: false | true },
  newUserId: string,
) =>
  client.query.storeEntitlementRevocation.findFirst({
    columns: { id: true, revokedThrough: true },
    where: and(
      eq(storeEntitlementRevocation.eventId, revocation.eventId),
      eq(storeEntitlementRevocation.userId, newUserId),
      eq(storeEntitlementRevocation.store, revocation.store),
      eq(storeEntitlementRevocation.isSandbox, revocation.isSandbox),
    ),
  });

/**
 * Build the `storeEntitlementRevocation` update for
 * `migrateStoreEntitlementRevocations`, setting `revokedThrough`, using predicates on
 * `id`.
 */
export const updateStoreEntitlementRevocationForMigrateStoreEntitlementRevocations = (
  client: Pick<DrizzleClient, "update">,
  collision: { revokedThrough: Date; id: string },
  revocation: { revokedThrough: Date },
) =>
  client
    .update(storeEntitlementRevocation)
    .set({
      revokedThrough:
        collision.revokedThrough > revocation.revokedThrough
          ? collision.revokedThrough
          : revocation.revokedThrough,
    })
    .where(eq(storeEntitlementRevocation.id, collision.id));

/** Build the `storeEntitlementRevocation` deletion for `migrateStoreEntitlementRevocations`, using predicates on `id`. */
export const deleteStoreEntitlementRevocationForMigrateStoreEntitlementRevocations = (
  client: Pick<DrizzleClient, "delete">,
  revocation: { id: string },
) =>
  client
    .delete(storeEntitlementRevocation)
    .where(eq(storeEntitlementRevocation.id, revocation.id));

/**
 * Build the `storeEntitlementRevocation` update for
 * `migrateStoreEntitlementRevocations`, setting `userId`, using predicates on `id`.
 */
export const updateStoreEntitlementRevocationForMigrateStoreEntitlementRevocations2 = (
  client: Pick<DrizzleClient, "update">,
  newUserId: string,
  revocation: { id: string },
) =>
  client
    .update(storeEntitlementRevocation)
    .set({ userId: newUserId })
    .where(eq(storeEntitlementRevocation.id, revocation.id));

/** Build existing user ID rows for store receipt ownership and transfers. */
export const selectStoreUserIds = (
  client: Pick<DrizzleClient, "select">,
  userIds: string[],
) =>
  client
    .select({ userId: userData.userId })
    .from(userData)
    .where(inArray(userData.userId, userIds));

/** Build the `storePurchaseTransfer` insert for `applyStoreTransfer`, updating duplicate keys. */
export const insertStorePurchaseTransferForApplyStoreTransfer = (
  client: Pick<DrizzleClient, "insert">,
  transfer: { eventId: string; occurredAt: Date },
  sourceUserId: string,
  destinationUserId: string,
  store: "APPLE" | "GOOGLE",
  isSandbox: false | true,
) =>
  client
    .insert(storePurchaseTransfer)
    .values({
      id: nanoid(),
      eventId: transfer.eventId,
      sourceUserId,
      destinationUserId,
      store,
      isSandbox,
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

/**
 * Build the `storeEntitlementState` lookup for `applyStoreTransfer`, selecting only
 * `revokedThrough`, including predicates on `userId`, `store`, `isSandbox`.
 */
export const findStoreEntitlementStateForApplyStoreTransfer = (
  client: Pick<DrizzleClient, "query">,
  sourceUserId: string,
  store: "APPLE" | "GOOGLE",
  isSandbox: false | true,
  transfer: { occurredAt: Date },
) =>
  client.query.storeEntitlementState.findFirst({
    columns: { revokedThrough: true },
    where: and(
      eq(storeEntitlementState.userId, sourceUserId),
      eq(storeEntitlementState.store, store),
      eq(storeEntitlementState.isSandbox, isSandbox),
      lte(storeEntitlementState.revokedThrough, transfer.occurredAt),
    ),
  });

/**
 * Build the `storePurchase` listing for `applyStoreTransfer`, including predicates on
 * `originalUserId`, `store`, `isSandbox`.
 */
export const listStorePurchaseForApplyStoreTransfer = (
  client: Pick<DrizzleClient, "query">,
  originalUserIds: string[],
  store: "APPLE" | "GOOGLE",
  isSandbox: false | true,
) =>
  client.query.storePurchase.findMany({
    columns: {
      id: true,
      userId: true,
      originalUserId: true,
      purchasedAt: true,
    },
    where: and(
      inArray(storePurchase.originalUserId, originalUserIds),
      eq(storePurchase.store, store),
      eq(storePurchase.isSandbox, isSandbox),
      isNotNull(storePurchase.federalStatus),
      isNull(storePurchase.revokedAt),
    ),
  });

/** Build a retired user ID alias insert that preserves the first writer’s destination. */
export const insertStoreUserIdAlias = (
  client: Pick<DrizzleClient, "insert">,
  oldUserId: string,
  newUserId: string,
) =>
  client
    .insert(storeUserIdAlias)
    .values({ oldUserId: oldUserId, newUserId: newUserId, updatedAt: new Date() })
    // newUserId is deliberately absent from the update: leaving it out is what makes the
    // first writer keep the row.
    .onDuplicateKeyUpdate({ set: { updatedAt: new Date() } });

/**
 * Build the `paypalSubscription` listing for `paypalFederalFloor`, selecting only
 * `federalStatus`, using predicates on `affectedUserId`, `status`, `updatedAt`.
 */
export const listPaypalSubscriptionForPaypalFederalFloor = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
  PAYPAL_WINDOW_MS: number,
) =>
  client.query.paypalSubscription.findMany({
    columns: { federalStatus: true },
    where: and(
      eq(paypalSubscription.affectedUserId, userId),
      eq(paypalSubscription.status, "ACTIVE"),
      gte(paypalSubscription.updatedAt, new Date(Date.now() - PAYPAL_WINDOW_MS)),
    ),
  });

/**
 * Build the `storePurchase` listing for `storeFederalFloor`, selecting only
 * `federalStatus`, including predicates on `userId`, `acceptedAt`, `isSandbox`.
 */
export const listStorePurchaseForStoreFederalFloor = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
  isSandboxGrantee: (userId: string) => boolean,
  STORE_WINDOW_MS: number,
) =>
  client.query.storePurchase.findMany({
    columns: { federalStatus: true },
    where: and(
      eq(storePurchase.userId, userId),
      isNotNull(storePurchase.acceptedAt),
      ...(isSandboxGrantee(userId) ? [] : [eq(storePurchase.isSandbox, false)]),
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

/**
 * Build the `userData` update for `setFederalStatusWithStoreFloor`, setting
 * `federalStatus`, using predicates on `userId`.
 */
export const updateUserDataForSetFederalStatusWithStoreFloor = (
  client: Pick<DrizzleClient, "update">,
  paypalRank: number,
  rankOf: (status: FederalStatus) => number,
  hasTier: (tier: FederalStatus) => SQL<unknown>,
  paypalGrace: (tier: FederalStatus) => SQL<unknown>,
  userId: string,
) =>
  client
    .update(userData)
    .set({
      federalStatus: sql`CASE
        WHEN ${paypalRank >= rankOf("GOLD")} OR ${hasTier("GOLD")} OR ${paypalGrace("GOLD")} THEN 'GOLD'
        WHEN ${paypalRank >= rankOf("SILVER")} OR ${hasTier("SILVER")} OR ${paypalGrace("SILVER")} THEN 'SILVER'
        WHEN ${paypalRank >= rankOf("NORMAL")} OR ${hasTier("NORMAL")} OR ${paypalGrace("NORMAL")} THEN 'NORMAL'
        ELSE 'NONE'
      END`,
    })
    .where(eq(userData.userId, userId));

/** Build the `userData` selection for `reconcileFederalStatuses`, using the configured predicates. */
export const selectUserDataForReconcileFederalStatuses = (
  client: Pick<DrizzleClient, "select">,
  eligible: SQL<unknown>,
) => client.select({ userId: userData.userId }).from(userData).where(eligible);

/** Execute the database statement for `reconcileFederalStatuses`. */
export const executeRowsForReconcileFederalStatuses = (
  client: Pick<DrizzleClient, "execute">,
  federalStatus: SQL<unknown>,
  ids: string[],
  eligible: SQL<unknown>,
) =>
  client.execute(sql`UPDATE ${userData} FORCE INDEX (PRIMARY)
      SET ${userData.federalStatus} = ${federalStatus}
      WHERE ${and(inArray(userData.userId, ids), eligible)}`);

/** Read balances and quest eligibility for purchase recovery and known grant projections. */
export const findPurchaseUserSnapshot = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    with: {
      userQuests: userQuestHistoryRelation,
      completedQuests: completedQuestHistoryRelation,
    },
  });
