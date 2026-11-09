/**
 * Database access for stripe; authorization and transaction scopes stay in callers.
 */

import {
  and,
  desc,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { stripeCheckout, stripePayment, userData } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import type { DrizzleClient } from "@/server/db";
import { STRIPE_CHECKOUT_RESERVATION_SECONDS } from "@/server/utils/purchases/allowance";

/** Schema-derived Stripe receipt insert fields used by fulfillment queries. */
export type StripeReceipt = typeof stripePayment.$inferInsert;

/** Build the `stripePayment` insert for `grantStripeReceipt`, updating duplicate keys. */
export const insertStripePaymentForGrantStripeReceipt = (
  client: Pick<DrizzleClient, "insert">,
  receipt: import("@/server/utils/stripe/fulfillment").StripeReceipt,
) =>
  client
    .insert(stripePayment)
    .values(receipt)
    .onDuplicateKeyUpdate({ set: { id: receipt.id } });

/** Build the `stripePayment` lookup for `grantStripeReceipt`, using predicates on `id`. */
export const findStripePaymentForGrantStripeReceipt = (
  client: Pick<DrizzleClient, "query">,
  receipt: { id: string },
) =>
  client.query.stripePayment.findFirst({
    where: eq(stripePayment.id, receipt.id),
  });

/**
 * Build the `stripePayment` update for `grantStripeReceipt`, setting `affectedUserId`
 * and `createdById`, using predicates on `id`, `affectedUserId`, `createdById`.
 */
export const updateStripePaymentForGrantStripeReceipt = (
  client: Pick<DrizzleClient, "update">,
  recipientId: string,
  buyerId: string,
  stored: { id: string; affectedUserId: string; createdById: string },
) =>
  client
    .update(stripePayment)
    .set({ affectedUserId: recipientId, createdById: buyerId })
    .where(
      and(
        eq(stripePayment.id, stored.id),
        eq(stripePayment.affectedUserId, stored.affectedUserId),
        eq(stripePayment.createdById, stored.createdById),
      ),
    );

/** Build the `stripePayment` update for `claim`, setting `reviewRequired`, using predicates on `id`. */
export const updateStripePaymentForClaim = (
  client: Pick<DrizzleClient, "update">,
  stored: { id: string },
) =>
  client
    .update(stripePayment)
    .set({ reviewRequired: true })
    .where(eq(stripePayment.id, stored.id));

/** Execute the database statement for `claim`. */
export const executeResultForClaim = (
  client: Pick<DrizzleClient, "execute">,
  receipt: { id: string },
) =>
  client.execute(sql`UPDATE ${userData} INNER JOIN ${stripePayment} ON ${stripePayment.affectedUserId} = ${userData.userId}
      SET ${userData.reputationPoints} = ${userData.reputationPoints} + ${stripePayment.reputationPoints},
          ${userData.reputationPointsTotal} = ${userData.reputationPointsTotal} + ${stripePayment.reputationPoints},
          ${stripePayment.grantedAt} = CURRENT_TIMESTAMP(3)
      WHERE ${stripePayment.id} = ${receipt.id} AND ${stripePayment.grantedAt} IS NULL AND ${stripePayment.reviewRequired} = FALSE`);

/** Build a Stripe checkout lookup by ID. */
export const findStripeCheckoutById = (
  client: Pick<DrizzleClient, "query">,
  checkoutId: string,
) =>
  client.query.stripeCheckout.findFirst({
    where: eq(stripeCheckout.id, checkoutId),
  });

/**
 * Build the `stripeCheckout` update for `fulfillStripeInvoice`, setting
 * `subscriptionId`, using predicates on `id` and `subscriptionId`.
 */
export const updateStripeCheckoutForFulfillStripeInvoice = (
  client: Pick<DrizzleClient, "update">,
  subscriptionId: string,
  checkoutId: string,
) =>
  client
    .update(stripeCheckout)
    .set({ subscriptionId })
    .where(
      and(
        eq(stripeCheckout.id, checkoutId),
        sql`(${stripeCheckout.subscriptionId} IS NULL OR ${stripeCheckout.subscriptionId} = ${subscriptionId})`,
      ),
    );

/** Build the `stripePayment` listing for `settleStripePayments`, using predicates on `affectedUserId`. */
export const listStripePaymentForSettleStripePayments = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
) =>
  client.query.stripePayment.findMany({
    where: eq(stripePayment.affectedUserId, userId),
  });

/**
 * Build the `stripePayment` lookup for `upgradeStripeFederalWithReps`, including
 * predicates on `createdById`, `affectedUserId`, `grantedAt`.
 */
export const findStripePaymentForUpgradeStripeFederalWithReps = (
  client: Pick<DrizzleClient, "query">,
  userId: string,
  currentTier: import("@/drizzle/schema").FederalStatus,
) =>
  client.query.stripePayment.findFirst({
    where: and(
      eq(stripePayment.createdById, userId),
      eq(stripePayment.affectedUserId, userId),
      isNotNull(stripePayment.grantedAt),
      gt(stripePayment.expiresAt, new Date()),
      lte(stripePayment.purchasedAt, new Date()),
      sql`COALESCE(${stripePayment.federalStatusOverride}, ${stripePayment.federalStatus}) = ${currentTier}`,
      ...(env.NODE_ENV === "production" ? [eq(stripePayment.isSandbox, false)] : []),
    ),
  });

/** Execute the database statement for `upgradeStripeFederalWithReps`. */
export const executeResultForUpgradeStripeFederalWithReps = (
  client: Pick<DrizzleClient, "execute">,
  cost: number,
  nextTier: import("@/drizzle/schema").FederalStatus,
  receipt: { id: string },
  userId: string,
  currentTier: import("@/drizzle/schema").FederalStatus,
) =>
  client.execute(sql`UPDATE ${userData} INNER JOIN ${stripePayment} ON ${stripePayment.affectedUserId} = ${userData.userId}
    SET ${userData.reputationPoints} = ${userData.reputationPoints} - ${cost},
        ${userData.reputationPointsTotal} = ${userData.reputationPointsTotal} - ${cost},
        ${userData.federalStatus} = ${nextTier},
        ${stripePayment.federalStatusOverride} = ${nextTier}
    WHERE ${stripePayment.id} = ${receipt.id} AND ${stripePayment.createdById} = ${userId} AND ${stripePayment.affectedUserId} = ${userId}
      AND ${stripePayment.grantedAt} IS NOT NULL AND ${stripePayment.purchasedAt} <= CURRENT_TIMESTAMP(3)
      AND ${stripePayment.expiresAt} > CURRENT_TIMESTAMP(3)
      AND COALESCE(${stripePayment.federalStatusOverride}, ${stripePayment.federalStatus}) = ${currentTier}
      AND ${userData.federalStatus} = ${currentTier} AND ${userData.reputationPoints} >= ${cost}`);

/** Table alias for recipient joins, keeping its columns distinct from other participants. */
const recipient = alias(userData, "recipient");

/** Build the `stripeCheckout` listing for `createCheckout`, including predicates on `createdById`, `id`, `closedAt`. */
export const listStripeCheckoutForCreateCheckout = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  input: { requestId: string },
) =>
  client.query.stripeCheckout.findMany({
    where: and(
      eq(stripeCheckout.createdById, ctx.userId),
      ne(stripeCheckout.id, input.requestId),
      ...openReservationConditions(),
    ),
  });

/** A checkout still reserving allowance: open, inside its window and not yet granted. */
const openReservationConditions = () => [
  isNull(stripeCheckout.closedAt),
  gte(
    stripeCheckout.createdAt,
    sql`NOW() - INTERVAL ${STRIPE_CHECKOUT_RESERVATION_SECONDS} SECOND`,
  ),
  sql`NOT EXISTS (SELECT 1 FROM ${stripePayment} p WHERE p.checkoutId = ${stripeCheckout.id} AND p.grantedAt IS NOT NULL)`,
];

/**
 * Build the `stripeCheckout` listing for `createCheckout`, using predicates on
 * `createdById`, `affectedUserId`, `subscriptionId`.
 */
export const listStripeCheckoutForCreateCheckout2 = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
  input: { userId: string },
) =>
  client.query.stripeCheckout.findMany({
    where: and(
      eq(stripeCheckout.createdById, ctx.userId),
      eq(stripeCheckout.affectedUserId, input.userId),
      isNotNull(stripeCheckout.subscriptionId),
    ),
  });

/** Build the `stripeCheckout` insert for `createCheckout`, updating duplicate keys. */
export const insertStripeCheckoutForCreateCheckout = (
  client: Pick<DrizzleClient, "insert">,
  input: { requestId: string; userId: string },
  ctx: { userId: string },
  amountCents: number,
  reputationPoints: number,
  tier: import("@/drizzle/schema").FederalStatus,
  priceId: undefined | null | string,
) =>
  client
    .insert(stripeCheckout)
    .values({
      id: input.requestId,
      createdById: ctx.userId,
      affectedUserId: input.userId,
      amountCents,
      reputationPoints,
      federalStatus: tier,
      priceId,
    })
    .onDuplicateKeyUpdate({ set: { id: input.requestId } });

/** Build the `stripeCheckout` update for `createCheckout`, setting `sessionId`, using predicates on `id`. */
export const updateStripeCheckoutForCreateCheckout = (
  client: Pick<DrizzleClient, "update">,
  session: { id: string },
  saved: { id: string },
) =>
  client
    .update(stripeCheckout)
    .set({ sessionId: session.id })
    .where(eq(stripeCheckout.id, saved.id));

/** Build the `stripeCheckout` update for `cancelCheckout`, setting `closedAt`, using predicates on `id`. */
export const updateStripeCheckoutForCancelCheckout = (
  client: Pick<DrizzleClient, "update">,
  checkout: { id: string },
) =>
  client
    .update(stripeCheckout)
    .set({ closedAt: new Date() })
    .where(eq(stripeCheckout.id, checkout.id));

/**
 * Build the `stripeCheckout` selection for `getPendingCheckouts`, including predicates
 * on `createdById`, `closedAt`, `subscriptionId`.
 */
export const selectStripeCheckoutForGetPendingCheckouts = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({
      id: stripeCheckout.id,
      affectedUserId: stripeCheckout.affectedUserId,
      federalStatus: stripeCheckout.federalStatus,
      reputationPoints: stripeCheckout.reputationPoints,
      recipientUsername: recipient.username,
    })
    .from(stripeCheckout)
    .leftJoin(recipient, eq(recipient.userId, stripeCheckout.affectedUserId))
    .where(
      and(
        eq(stripeCheckout.createdById, ctx.userId),
        isNull(stripeCheckout.subscriptionId),
        ...openReservationConditions(),
      ),
    )
    .orderBy(desc(stripeCheckout.createdAt));

/** Build the `stripePayment` listing for `getPayments`, using predicates on `createdById`. */
export const listStripePaymentForGetPayments = (
  client: Pick<DrizzleClient, "query">,
  ctx: { userId: string },
) =>
  client.query.stripePayment.findMany({
    where: eq(stripePayment.createdById, ctx.userId),
    orderBy: desc(stripePayment.createdAt),
    limit: 100,
  });

/**
 * Build the `stripeCheckout` selection for `getSubscriptions`, using predicates on
 * `createdById`, `affectedUserId`, `subscriptionId`.
 */
export const selectStripeCheckoutForGetSubscriptions = (
  client: Pick<DrizzleClient, "select">,
  ctx: { userId: string },
) =>
  client
    .select({ checkout: stripeCheckout, recipientUsername: recipient.username })
    .from(stripeCheckout)
    .leftJoin(recipient, eq(recipient.userId, stripeCheckout.affectedUserId))
    .where(
      and(
        or(
          eq(stripeCheckout.createdById, ctx.userId),
          eq(stripeCheckout.affectedUserId, ctx.userId),
        ),
        isNotNull(stripeCheckout.subscriptionId),
      ),
    )
    .orderBy(desc(stripeCheckout.createdAt))
    .limit(100);
