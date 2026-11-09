/**
 * Database access for paypal; authorization and transaction scopes stay in callers.
 */

import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  PAYPAL_PAID_PERIOD_DAYS,
  STORE_ORDER_RESERVATION_MINUTES,
} from "@/drizzle/constants";
import {
  actionLog,
  item,
  paypalSubscription,
  paypalTransaction,
  recruitmentRewards,
  storeUserIdAlias,
  userData,
  webStoreBundle,
  webStoreOrder,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { calculateContentDiff } from "@/utils/diff";

/** Build the `paypalSubscription` listing for `GET`: ACTIVE rows last paid before `cutoff`. */
export const listPaypalSubscriptionForGET = (
  client: Pick<DrizzleClient, "query">,
  cutoff: Date,
) =>
  client.query.paypalSubscription.findMany({
    where: and(
      eq(paypalSubscription.status, "ACTIVE"),
      lte(paypalSubscription.updatedAt, cutoff),
    ),
  });

/**
 * Build the `paypalSubscription` cancellation for `GET`, using predicates on `id`. The
 * last-payment marker (`updatedAt`) is left untouched so the tier cannot outlive what
 * was paid for.
 */
export const updatePaypalSubscriptionForGET = (
  client: Pick<DrizzleClient, "update">,
  subscription: { id: string },
) =>
  client
    .update(paypalSubscription)
    .set({ status: "CANCELLED" })
    .where(eq(paypalSubscription.id, subscription.id));

/** Build the `webStoreBundle` listing for `getStoreBundles`, using predicates on `isActive`. */
export const listWebStoreBundleForGetStoreBundles = (
  client: Pick<DrizzleClient, "query">,
  input: { includeInactive?: undefined | false | true } | undefined | null,
) =>
  client.query.webStoreBundle.findMany({
    where: input?.includeInactive ? undefined : eq(webStoreBundle.isActive, true),
    orderBy: (table, { asc }) => [asc(table.priceCents), asc(table.name)],
  });

/** Build the `item` listing for `getStoreBundles`. */
export const listItemForGetStoreBundles = (client: Pick<DrizzleClient, "query">) =>
  client.query.item.findMany({
    columns: { id: true, name: true, image: true, repsCost: true },
  });

/** Build the `webStoreOrder` selection for `getStoreBundles`, using predicates on `buyerId`, `bundleId`, `grantedAt`. */
export const selectWebStoreOrderForGetStoreBundles = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({ bundleId: webStoreOrder.bundleId, count: count() })
    .from(webStoreOrder)
    .where(
      and(
        eq(webStoreOrder.buyerId, ctx.userId),
        isNotNull(webStoreOrder.bundleId),
        isNotNull(webStoreOrder.grantedAt),
      ),
    )
    .groupBy(webStoreOrder.bundleId);

/** Build a web store bundle lookup by ID. */
export const findWebStoreBundleById = (
  client: Pick<DrizzleClient, "query">,
  bundleId: string,
) =>
  client.query.webStoreBundle.findFirst({
    where: eq(webStoreBundle.id, bundleId),
  });

/** Build the `item` listing for `saveStoreBundle`, selecting only `id` and `repsCost`. */
export const listItemForSaveStoreBundle = (client: Pick<DrizzleClient, "query">) =>
  client.query.item.findMany({ columns: { id: true, repsCost: true } });

/** Build the `webStoreBundle` update for `saveStoreBundle`, setting `updatedAt`, using predicates on `id`. */
export const updateWebStoreBundleForSaveStoreBundle = (
  client: Pick<DrizzleClient, "update">,
  input: { data: import("@/validators/points").StoreBundleInput },
  id: string,
) =>
  client
    .update(webStoreBundle)
    .set({ ...input.data, updatedAt: new Date() })
    .where(eq(webStoreBundle.id, id));

/** Build the `webStoreBundle` insert for `saveStoreBundle`. */
export const insertWebStoreBundleForSaveStoreBundle = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  input: { data: import("@/validators/points").StoreBundleInput },
) => client.insert(webStoreBundle).values({ id, ...input.data });

/** Build the `actionLog` insert for `saveStoreBundle`. */
export const insertActionLogForSaveStoreBundle = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  id: string,
  existing:
    | undefined
    | (Pick<
        import("@/drizzle/schema").PetSpecies,
        "id" | "name" | "description" | "updatedAt" | "isActive"
      > & {
        purchaseLimit: number;
        contents: import("@/validators/points").StoreContents;
        priceCents: number;
      }),
  input: { data: import("@/validators/points").StoreBundleInput },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "webStoreBundle",
    relatedId: id,
    relatedMsg: `${existing ? "Update" : "Create"}: ${input.data.name}`,
    changes: calculateContentDiff(existing ?? {}, input.data),
  });

/** Build the `webStoreOrder` update for `createStoreOrder`, setting `expiresAt`, using predicates on `id`. */
export const updateWebStoreOrderForCreateStoreOrder = (
  client: Pick<DrizzleClient, "update">,
  order: { id: string },
) =>
  client
    .update(webStoreOrder)
    .set({ expiresAt: new Date(0) })
    .where(eq(webStoreOrder.id, order.id));

/** Build the `paypalTransaction` listing for `getPaypalTransactions`, using predicates on `createdById`. */
export const listPaypalTransactionForGetPaypalTransactions = (
  client: Pick<DrizzleClient, "query">,
  skip: number,
  input: { limit: number },
  targetUserId: string,
) =>
  client.query.paypalTransaction.findMany({
    offset: skip,
    limit: input.limit,
    where: eq(paypalTransaction.createdById, targetUserId),
    with: { affectedUser: true },
    orderBy: desc(paypalTransaction.createdAt),
  });

/**
 * Build the `paypalSubscription` listing for `getPaypalSubscriptions`, using
 * predicates on `createdById`, `affectedUserId`, `status`.
 */
export const listPaypalSubscriptionForGetPaypalSubscriptions = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.paypalSubscription.findMany({
    where: and(
      or(
        eq(paypalSubscription.createdById, ctx.userId),
        eq(paypalSubscription.affectedUserId, ctx.userId),
      ),
      eq(paypalSubscription.status, "ACTIVE"),
    ),
    with: { affectedUser: true, createdBy: true },
    orderBy: desc(paypalSubscription.createdAt),
  });

/**
 * Build the `userData` update for `subscribeWithReps`, setting `reputationPoints`,
 * using predicates on `userId` and `reputationPoints`.
 */
export const updateUserDataForSubscribeWithReps = (
  client: Pick<DrizzleClient, "update">,
  cost: 15 | 50 | 35,
  ctx: { userId: string },
) =>
  client
    .update(userData)
    .set({ reputationPoints: sql`${userData.reputationPoints} - ${cost}` })
    .where(and(eq(userData.userId, ctx.userId), gte(userData.reputationPoints, cost)));

/**
 * Build the `userData` update for `subscribeWithReps`, setting `federalStatus`, using
 * predicates on `userId` and `federalStatus`.
 */
export const updateUserDataForSubscribeWithReps2 = (
  client: Pick<DrizzleClient, "update">,
  input: { status: import("@/drizzle/schema").FederalStatus; userId: string },
) =>
  client
    .update(userData)
    .set({ federalStatus: input.status })
    .where(and(eq(userData.userId, input.userId), eq(userData.federalStatus, "NONE")));

/** Build the `paypalSubscription` insert for `subscribeWithReps`. */
export const insertPaypalSubscriptionForSubscribeWithReps = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  input: { userId: string; status: import("@/drizzle/schema").FederalStatus },
) =>
  client.insert(paypalSubscription).values({
    id: nanoid(),
    createdById: ctx.userId,
    affectedUserId: input.userId,
    federalStatus: input.status,
    subscriptionId: `reps_${nanoid()}`,
    status: "ACTIVE",
  });

/**
 * Build the `paypalSubscription` lookup for `upgradeSubscription`, including
 * predicates on `status`, `federalStatus`, `affectedUserId`.
 */
export const findPaypalSubscriptionForUpgradeSubscription = (
  client: Pick<DrizzleClient, "query">,
  target: { federalStatus: import("@/drizzle/schema").FederalStatus; userId: string },
  ctx: { userId: string },
) =>
  client.query.paypalSubscription.findFirst({
    where: and(
      or(
        eq(paypalSubscription.status, "ACTIVE"),
        eq(paypalSubscription.status, "CANCELLED"),
      ),
      eq(paypalSubscription.federalStatus, target.federalStatus),
      eq(paypalSubscription.affectedUserId, target.userId),
      eq(paypalSubscription.createdById, ctx.userId),
      gte(
        paypalSubscription.updatedAt,
        sql`NOW() - INTERVAL ${PAYPAL_PAID_PERIOD_DAYS} DAY`,
      ),
    ),
  });

/** Execute the database statement for `upgradeSubscription`. */
export const executeResultForUpgradeSubscription = (
  client: Pick<DrizzleClient, "execute">,
  input: { plan: import("@/drizzle/schema").FederalStatus },
  cost: number,
  ctx: { userId: string },
  target: { federalStatus: import("@/drizzle/schema").FederalStatus },
  subscription: {
    id: string;
    federalStatus: import("@/drizzle/schema").FederalStatus;
    updatedAt: Date;
  },
) =>
  client.execute(sql`
        UPDATE ${userData} INNER JOIN ${paypalSubscription} ON ${paypalSubscription.affectedUserId} = ${userData.userId}
        SET ${userData.federalStatus} = ${input.plan},
            ${userData.reputationPoints} = ${userData.reputationPoints} - ${cost},
            ${userData.reputationPointsTotal} = ${userData.reputationPointsTotal} - ${cost},
            ${paypalSubscription.federalStatus} = ${input.plan}, ${paypalSubscription.updatedAt} = CURRENT_TIMESTAMP(3)
        WHERE ${userData.userId} = ${ctx.userId} AND ${userData.federalStatus} = ${target.federalStatus}
          AND ${userData.reputationPoints} >= ${cost} AND ${paypalSubscription.id} = ${subscription.id}
          AND ${paypalSubscription.createdById} = ${ctx.userId} AND ${paypalSubscription.federalStatus} = ${subscription.federalStatus}
          AND ${paypalSubscription.status} IN ('ACTIVE', 'CANCELLED')
          AND ${paypalSubscription.updatedAt} = ${subscription.updatedAt}
          AND ${paypalSubscription.updatedAt} >= CURRENT_TIMESTAMP(3) - INTERVAL ${PAYPAL_PAID_PERIOD_DAYS} DAY`);

/** Build the `paypalSubscription` lookup for `cancelPaypalSubscription`, using predicates on `subscriptionId`. */
export const findPaypalSubscriptionForCancelPaypalSubscription = (
  client: Pick<DrizzleClient, "query">,
  input: { subscriptionId: string },
) =>
  client.query.paypalSubscription.findFirst({
    where: eq(paypalSubscription.subscriptionId, input.subscriptionId),
  });

/** Build the `paypalSubscription` update for `cancelPaypalSubscription`, setting `status`, using predicates on `id`. */
export const updatePaypalSubscriptionForCancelPaypalSubscription = (
  client: Pick<DrizzleClient, "update">,
  stored: { id: string },
) =>
  client
    .update(paypalSubscription)
    .set({ status: "CANCELLED" })
    .where(eq(paypalSubscription.id, stored.id));

/**
 * Build the `paypalSubscription` update for `updateSubscription`, including predicates
 * on `id`, `createdById`, `affectedUserId`.
 */
export const updatePaypalSubscriptionForUpdateSubscription = (
  client: Pick<DrizzleClient, "update">,
  input: { status: string },
  tier: import("@/drizzle/schema").FederalStatus,
  paidAt: Date,
  approvalReference: undefined | string,
  current: {
    id: string;
    createdById: string;
    affectedUserId: string;
    updatedAt: Date;
    status: string;
    federalStatus: import("@/drizzle/schema").FederalStatus;
  },
) =>
  client
    .update(paypalSubscription)
    .set({
      status: input.status,
      federalStatus: tier,
      updatedAt: paidAt,
      orderId: approvalReference,
    })
    .where(
      and(
        eq(paypalSubscription.id, current.id),
        eq(paypalSubscription.createdById, current.createdById),
        eq(paypalSubscription.affectedUserId, current.affectedUserId),
        eq(paypalSubscription.updatedAt, current.updatedAt),
        eq(paypalSubscription.status, current.status),
        eq(paypalSubscription.federalStatus, current.federalStatus),
      ),
    );

/** Build the `paypalSubscription` insert for `updateSubscription`. */
export const insertPaypalSubscriptionForUpdateSubscription = (
  client: Pick<DrizzleClient, "insert">,
  input: {
    createdById: string;
    affectedUserId: string;
    orderId?: undefined | string;
    subscriptionId: string;
    status: string;
  },
  tier: import("@/drizzle/schema").FederalStatus,
  paidAt: Date,
) =>
  client.insert(paypalSubscription).values({
    id: nanoid(),
    createdById: input.createdById,
    affectedUserId: input.affectedUserId,
    orderId: input.orderId,
    subscriptionId: input.subscriptionId,
    federalStatus: tier,
    status: input.status,
    updatedAt: paidAt,
  });

/** Build the `paypalTransaction` insert for `awardPaypalReferral`. */
export const insertPaypalTransactionForAwardPaypalReferral = (
  client: Pick<DrizzleClient, "insert">,
  input: {
    createdById: string;
    transactionId: string;
    transactionUpdatedDate: string;
    orderId?: undefined | string;
    affectedUserId: string;
    invoiceId?: undefined | null | string;
    value: number;
    reps: number;
    currency: string;
    status: string;
    type: "REFERRAL";
    raw: import("@/utils/typeutils").JsonData;
  },
) =>
  client.insert(paypalTransaction).values({
    id: nanoid(),
    createdById: input.createdById,
    transactionId: input.transactionId,
    transactionUpdatedDate: input.transactionUpdatedDate,
    orderId: input.orderId,
    affectedUserId: input.affectedUserId,
    invoiceId: input.invoiceId,
    amount: input.value,
    reputationPoints: input.reps,
    currency: input.currency,
    status: input.status,
    type: input.type,
    rawData: input.raw,
  });

/** Build the `recruitmentRewards` insert for `awardPaypalReferral`. */
export const insertRecruitmentRewardsForAwardPaypalReferral = (
  client: Pick<DrizzleClient, "insert">,
  input: { affectedUserId: string; createdById: string; reps: number },
) =>
  client.insert(recruitmentRewards).values({
    id: nanoid(),
    userId: input.affectedUserId,
    recruitedUserId: input.createdById,
    amount: input.reps,
    type: "REPUTATION",
  });

/**
 * Build the `userData` update crediting PayPal reputation, setting `reputationPointsTotal`
 * and `reputationPoints`, using predicates on `userId`.
 */
export const creditPaypalReputation = (
  client: Pick<DrizzleClient, "update">,
  input: { reps: number; affectedUserId: string },
) =>
  client
    .update(userData)
    .set({
      reputationPointsTotal: sql`${userData.reputationPointsTotal} + ${input.reps}`,
      reputationPoints: sql`${userData.reputationPoints} + ${input.reps}`,
    })
    .where(eq(userData.userId, input.affectedUserId));

/** Build the `paypalTransaction` lookup for `syncTransactions`, using predicates on `type`, `transactionId`, `invoiceId`. */
export const findPaypalTransactionForSyncTransactions = (
  client: Pick<DrizzleClient, "query">,
  info: { transaction_id: string; invoice_id: string },
) =>
  client.query.paypalTransaction.findFirst({
    where: and(
      eq(paypalTransaction.type, "REP_PURCHASE"),
      or(
        eq(paypalTransaction.transactionId, info.transaction_id),
        ...(info.invoice_id ? [eq(paypalTransaction.invoiceId, info.invoice_id)] : []),
      ),
    ),
  });

/**
 * Build the `paypalTransaction` lookup for `deliverPaypalReputation`, including
 * predicates on `type`, `transactionId`, `invoiceId`.
 */
export const findPaypalTransactionForDeliverPaypalReputation = (
  client: Pick<DrizzleClient, "query">,
  input: {
    transactionId: string;
    invoiceId?: undefined | null | string;
    orderId?: undefined | string;
  },
) =>
  client.query.paypalTransaction.findFirst({
    where: and(
      eq(paypalTransaction.type, "REP_PURCHASE"),
      or(
        eq(paypalTransaction.transactionId, input.transactionId),
        ...(input.invoiceId ? [eq(paypalTransaction.invoiceId, input.invoiceId)] : []),
        ...(input.orderId ? [eq(paypalTransaction.orderId, input.orderId)] : []),
      ),
    ),
  });

/** Build the `paypalTransaction` update for `deliverPaypalReputation`, setting `status`, using predicates on `id`. */
export const updatePaypalTransactionForDeliverPaypalReputation = (
  client: Pick<DrizzleClient, "update">,
  terms: {
    createdById: string;
    affectedUserId: string;
    transactionId: string;
    transactionUpdatedDate: string;
    orderId: undefined | string;
    invoiceId: undefined | null | string;
    amount: number;
    reputationPoints: number;
    currency: string;
    type: "REP_PURCHASE" | "REFERRAL";
    rawData: import("@/utils/typeutils").JsonData;
  },
  status: string,
  id: string,
) =>
  client
    .update(paypalTransaction)
    .set({ ...terms, status })
    .where(eq(paypalTransaction.id, id));

/** Build the `paypalTransaction` insert for `deliverPaypalReputation`. */
export const insertPaypalTransactionForDeliverPaypalReputation = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  terms: {
    createdById: string;
    affectedUserId: string;
    transactionId: string;
    transactionUpdatedDate: string;
    orderId: undefined | string;
    invoiceId: undefined | null | string;
    amount: number;
    reputationPoints: number;
    currency: string;
    type: "REP_PURCHASE" | "REFERRAL";
    rawData: import("@/utils/typeutils").JsonData;
  },
  status: string,
) => client.insert(paypalTransaction).values({ id, ...terms, status });

/** Build the `item` listing for `prepareWebCheckout`, selecting only `id` and `repsCost`, using predicates on `hidden`. */
export const listItemForPrepareWebCheckout = (client: Pick<DrizzleClient, "query">) =>
  client.query.item.findMany({
    columns: { id: true, repsCost: true },
    where: eq(item.hidden, false),
  });

/** Build the `userData` selection for `reserve`, using predicates on `userId`. */
export const selectUserDataForReserve = (
  client: Pick<DrizzleClient, "select">,
  buyerId: string,
) => client.select().from(userData).where(eq(userData.userId, buyerId));

/** Build the `webStoreOrder` insert for `reserve`. */
export const insertWebStoreOrderForReserve = (
  client: Pick<DrizzleClient, "insert">,
  order: {
    id: string;
    buyerId: string;
    recipientId: string;
    bundleId: undefined | string;
    name: string;
    priceCents: number;
    contents: import("@/validators/points").StoreContents;
    expiresAt: Date;
  },
) => client.insert(webStoreOrder).values(order);

/** Build the `item` listing for `deliverStoreOrder`, using predicates on `id`. */
export const listItemForDeliverStoreOrder = (
  client: Pick<DrizzleClient, "query">,
  contents: {
    items: Pick<import("@/drizzle/schema").CraftingRequirement, "id" | "quantity">[];
  },
) =>
  client.query.item.findMany({
    columns: { id: true, canStack: true, stackSize: true },
    where: inArray(
      item.id,
      contents.items.map((i) => i.id),
    ),
  });

/**
 * Build the `webStoreOrder` update for `deliverStoreOrder`, setting `grantedAt` and
 * `captureId`, including predicates on `id`, `recipientId`, `buyerId`.
 */
export const updateWebStoreOrderForDeliverStoreOrder = (
  client: Pick<DrizzleClient, "update">,
  input: { captureId: string },
  order: { id: string; recipientId: string; buyerId: string },
) =>
  client
    .update(webStoreOrder)
    .set({ grantedAt: new Date(), captureId: input.captureId })
    .where(
      and(
        eq(webStoreOrder.id, order.id),
        eq(webStoreOrder.recipientId, order.recipientId),
        eq(webStoreOrder.buyerId, order.buyerId),
        isNull(webStoreOrder.grantedAt),
      ),
    );

/**
 * Build the recipient locking lookup used by the existing store-delivery transaction;
 * awaiting it outside that scope loses the lock contract.
 */
export const selectUserDataForDeliverStoreOrder = (
  client: Pick<DrizzleClient, "select">,
  order: { recipientId: string },
) =>
  client
    .select({ id: userData.userId })
    .from(userData)
    .where(eq(userData.userId, order.recipientId))
    .for("update");

/** Build the `userData` update for `deliverStoreOrder`, using predicates on `userId`. */
export const updateUserDataForDeliverStoreOrder = (
  client: Pick<DrizzleClient, "update">,
  contents: { reputationPoints: number; money: number },
  order: { recipientId: string },
) =>
  client
    .update(userData)
    .set({
      reputationPoints: sql`${userData.reputationPoints} + ${contents.reputationPoints}`,
      reputationPointsTotal: sql`${userData.reputationPointsTotal} + ${contents.reputationPoints}`,
      money: sql`${userData.money} + ${contents.money}`,
    })
    .where(eq(userData.userId, order.recipientId));

/** Build the `paypalTransaction` insert for `deliverStoreOrder`. */
export const insertPaypalTransactionForDeliverStoreOrder = (
  client: Pick<DrizzleClient, "insert">,
  order: { buyerId: string; recipientId: string; id: string; priceCents: number },
  input: { captureId: string; orderId: string; raw: unknown },
  contents: { reputationPoints: number },
) =>
  client.insert(paypalTransaction).values({
    id: nanoid(),
    createdById: order.buyerId,
    affectedUserId: order.recipientId,
    transactionId: input.captureId,
    orderId: input.orderId,
    invoiceId: order.id,
    transactionUpdatedDate: new Date().toISOString(),
    amount: order.priceCents / 100,
    reputationPoints: contents.reputationPoints,
    currency: "USD",
    status: "COMPLETED",
    type: "REP_PURCHASE",
    rawData: input.raw,
  });

/** Build the `webStoreOrder` lookup, using predicates on `id`. */
export const findWebStoreOrderById = (
  client: Pick<DrizzleClient, "query">,
  snapshotId: string,
) =>
  client.query.webStoreOrder.findFirst({
    where: eq(webStoreOrder.id, snapshotId),
  });

/** Build the `userData` lookup for `authorize`, using predicates on `userId`. */
export const findUserDataForAuthorize = (
  client: Pick<DrizzleClient, "query">,
  order: { recipientId: string },
) =>
  client.query.userData.findFirst({
    columns: { userId: true, isBanned: true, isAi: true },
    where: eq(userData.userId, order.recipientId),
  });

/** Build the retired user ID alias listing for a checkout’s buyer and recipient. */
export const listCheckoutUserIdAliases = (
  client: Pick<DrizzleClient, "query">,
  buyerId: string,
  recipientId: string,
) =>
  client.query.storeUserIdAlias.findMany({
    where: inArray(storeUserIdAlias.oldUserId, [buyerId, recipientId]),
  });

/** Build the `item` listing for `authorize`, selecting only `id` and `repsCost`, using predicates on `hidden` and `id`. */
export const listItemForAuthorize = (
  client: Pick<DrizzleClient, "query">,
  order: {
    contents: {
      items: Pick<import("@/drizzle/schema").CraftingRequirement, "id" | "quantity">[];
    };
  },
) =>
  client.query.item.findMany({
    columns: { id: true, repsCost: true },
    where: and(
      eq(item.hidden, false),
      inArray(
        item.id,
        order.contents.items.map((reward) => reward.id),
      ),
    ),
  });

/**
 * Build the `webStoreOrder` update for `authorize`, setting `expiresAt` and
 * `captureAttemptId`, including predicates on `id`, `buyerId`, `recipientId`.
 */
export const updateWebStoreOrderForAuthorize = (
  client: Pick<DrizzleClient, "update">,
  captureAttemptId: string,
  order: { id: string; recipientId: string },
  buyerId: string,
) =>
  client
    .update(webStoreOrder)
    .set({
      expiresAt: new Date(Date.now() + STORE_ORDER_RESERVATION_MINUTES * 60_000),
      captureAttemptId,
    })
    .where(
      and(
        eq(webStoreOrder.id, order.id),
        eq(webStoreOrder.buyerId, buyerId),
        eq(webStoreOrder.recipientId, order.recipientId),
        isNull(webStoreOrder.grantedAt),
      ),
    );

/**
 * Release only the matching unpaid attempt after a verified terminal decline.
 * One guarded UPDATE is sufficient: the token CAS preserves newer attempts and
 * the delivery guard preserves paid purchases. Pending/unknown outcomes must not call this.
 * @returns The write result; zero affected rows means this attempt no longer owns the slot.
 */
export const releaseDeclinedStoreCapture = async (
  client: DrizzleClient,
  snapshotId: string,
  buyerId: string,
  captureAttemptId: string,
) =>
  client
    .update(webStoreOrder)
    .set({ captureAttemptId: null, expiresAt: new Date(0) })
    .where(
      and(
        eq(webStoreOrder.id, snapshotId),
        eq(webStoreOrder.buyerId, buyerId),
        eq(webStoreOrder.captureAttemptId, captureAttemptId),
        isNull(webStoreOrder.grantedAt),
      ),
    );

/**
 * Build the `webStoreBundle` lookup for `checkBundlePurchaseLimit`, selecting only
 * `purchaseLimit` and `isActive`, using predicates on `id`.
 */
export const findWebStoreBundleForCheckBundlePurchaseLimit = (
  client: Pick<DrizzleClient, "query">,
  bundleId: string,
) =>
  client.query.webStoreBundle.findFirst({
    columns: { purchaseLimit: true, isActive: true },
    where: eq(webStoreBundle.id, bundleId),
  });

/**
 * Build the `webStoreOrder` selection for `checkBundlePurchaseLimit`, including
 * predicates on `buyerId`, `bundleId`, `id`.
 */
export const selectWebStoreOrderForCheckBundlePurchaseLimit = (
  client: Pick<DrizzleClient, "select">,
  buyerId: string,
  bundleId: string,
  excludeOrderId: undefined | string,
) =>
  client
    .select({ count: count() })
    .from(webStoreOrder)
    .where(
      and(
        eq(webStoreOrder.buyerId, buyerId),
        eq(webStoreOrder.bundleId, bundleId),
        excludeOrderId ? ne(webStoreOrder.id, excludeOrderId) : undefined,
        // A provider capture can stay pending or need delivery recovery beyond quote expiry.
        // Keep its slot until delivery; only never-authorized checkouts may expire.
        or(
          isNotNull(webStoreOrder.grantedAt),
          isNotNull(webStoreOrder.captureAttemptId),
          gt(webStoreOrder.expiresAt, new Date()),
        ),
      ),
    );

/**
 * Add FOR UPDATE to the supplied lazy buyer lookup. Use the caller-owned transaction
 * only on the limited-purchase branch.
 */
export const lockStoreBuyer = (query: ReturnType<typeof selectUserDataForReserve>) =>
  query.for("update");
