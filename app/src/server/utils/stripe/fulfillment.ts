import { and, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { FEDERAL_MONTHLY_USD_CENTS, type FederalStatus } from "@/drizzle/constants";
import { stripeCheckout, stripePayment, userData } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { errorResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import {
  canonicalStoreUserId,
  isRetiredStoreUserId,
  setFederalStatusWithStoreFloor,
} from "@/server/utils/purchases/grant";
import { calcFedUgradeCost } from "@/utils/paypal";
import { getStripe, stripeIsLive } from "./client";

type Checkout = typeof stripeCheckout.$inferSelect;
export type StripeReceipt = typeof stripePayment.$inferInsert;

/** A receipt and its balance change share a single atomic claim, as store grants do. */
export const grantStripeReceipt = async (
  client: DrizzleClient,
  receipt: StripeReceipt,
) =>
  retryOnDeadlock(async () => {
    await client
      .insert(stripePayment)
      .values(receipt)
      .onDuplicateKeyUpdate({ set: { id: receipt.id } });
    const stored = await client.query.stripePayment.findFirst({
      where: eq(stripePayment.id, receipt.id),
    });
    if (
      !stored ||
      stored.checkoutId !== receipt.checkoutId ||
      stored.amountCents !== receipt.amountCents ||
      stored.reputationPoints !== receipt.reputationPoints ||
      stored.federalStatus !== receipt.federalStatus ||
      stored.isSandbox !== (receipt.isSandbox ?? false)
    ) {
      throw new Error("Stripe receipt terms changed");
    }
    if (stored.isSandbox && env.NODE_ENV === "production") return;
    const [recipientId, buyerId] = await Promise.all([
      canonicalStoreUserId(client, stored.affectedUserId),
      canonicalStoreUserId(client, stored.createdById),
    ]);
    if (recipientId !== stored.affectedUserId || buyerId !== stored.createdById) {
      await client
        .update(stripePayment)
        .set({ affectedUserId: recipientId, createdById: buyerId })
        .where(
          and(
            eq(stripePayment.id, stored.id),
            eq(stripePayment.affectedUserId, stored.affectedUserId),
            eq(stripePayment.createdById, stored.createdById),
          ),
        );
    }
    if (!stored.grantedAt) {
      // The marker and credit commit together; an interrupted response can safely retry.
      const result =
        await client.execute(sql`UPDATE ${userData} u INNER JOIN ${stripePayment} p ON p.affectedUserId = u.userId
      SET u.reputationPoints = u.reputationPoints + p.reputationPoints,
          u.reputationPointsTotal = u.reputationPointsTotal + p.reputationPoints,
          p.grantedAt = CURRENT_TIMESTAMP(3)
      WHERE p.id = ${receipt.id} AND p.grantedAt IS NULL`);
      if (result.rowsAffected === 0) {
        const current = await client.query.stripePayment.findFirst({
          where: eq(stripePayment.id, receipt.id),
        });
        if (!current?.grantedAt && !(await isRetiredStoreUserId(client, recipientId)))
          throw new Error("Stripe receipt recipient is unavailable");
      }
    }
    // Recompute even on duplicate delivery: a failure after the claim must be recoverable.
    await setFederalStatusWithStoreFloor(client, recipientId, "NONE");
  });

const objectId = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : value?.id;

/** Immutable paid invoice periods, rather than webhook order, determine federal coverage. */
export const invoiceCoverage = (invoice: Stripe.Invoice, checkout: Checkout) => {
  const tier = checkout.federalStatus;
  if (
    tier === "NONE" ||
    !checkout.priceId ||
    invoice.status !== "paid" ||
    invoice.currency !== "usd" ||
    invoice.livemode !== stripeIsLive()
  )
    return null;
  if (invoice.automatic_tax?.enabled && invoice.automatic_tax.status !== "complete")
    return null;
  const line = invoice.lines.data.find(
    (candidate) =>
      candidate.pricing?.price_details?.price === checkout.priceId &&
      candidate.quantity === 1 &&
      !candidate.parent?.subscription_item_details?.proration,
  );
  if (
    !line ||
    invoice.lines.has_more ||
    line.amount !== FEDERAL_MONTHLY_USD_CENTS[tier] ||
    invoice.total !== checkout.amountCents ||
    line.period.end <= line.period.start
  )
    return null;
  return {
    purchasedAt: new Date(line.period.start * 1000),
    expiresAt: new Date(line.period.end * 1000),
  };
};

export const fulfillStripeInvoice = async (
  client: DrizzleClient,
  invoiceId: string,
) => {
  if (!stripeIsLive() && env.NODE_ENV === "production") return;
  const stripe = getStripe();
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const subscriptionId = objectId(invoice.parent?.subscription_details?.subscription);
  if (!subscriptionId) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const checkoutId = subscription.metadata.tnrCheckoutId;
  // Other products in the same Stripe account must never grant game value.
  if (!checkoutId) return;
  const checkout = await client.query.stripeCheckout.findFirst({
    where: eq(stripeCheckout.id, checkoutId),
  });
  if (!checkout) throw new Error("Unknown Stripe subscription checkout");
  if (checkout.subscriptionId && checkout.subscriptionId !== subscriptionId)
    throw new Error("Stripe subscription does not match checkout");
  const coverage = invoiceCoverage(invoice, checkout);
  if (!coverage) throw new Error("Stripe paid invoice does not match checkout terms");
  const linked = await client
    .update(stripeCheckout)
    .set({ subscriptionId })
    .where(
      and(
        eq(stripeCheckout.id, checkoutId),
        sql`(${stripeCheckout.subscriptionId} IS NULL OR ${stripeCheckout.subscriptionId} = ${subscriptionId})`,
      ),
    );
  if (linked.rowsAffected === 0) {
    const current = await client.query.stripeCheckout.findFirst({
      where: eq(stripeCheckout.id, checkoutId),
    });
    if (current?.subscriptionId !== subscriptionId)
      throw new Error("Stripe subscription does not match checkout");
  }
  const [buyerId, recipientId] = await Promise.all([
    canonicalStoreUserId(client, checkout.createdById),
    canonicalStoreUserId(client, checkout.affectedUserId),
  ]);
  await grantStripeReceipt(client, {
    id: invoice.id,
    isSandbox: !invoice.livemode,
    checkoutId,
    createdById: buyerId,
    affectedUserId: recipientId,
    amountCents: checkout.amountCents,
    reputationPoints: 0,
    federalStatus: checkout.federalStatus,
    ...coverage,
  });
};

/** Fetch authoritative session state; redirect query strings never establish payment. */
export const fulfillStripeSession = async (
  client: DrizzleClient,
  sessionId: string,
) => {
  if (!stripeIsLive() && env.NODE_ENV === "production") return "ignored" as const;
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  });
  const checkoutId = session.metadata?.tnrCheckoutId;
  if (!checkoutId) return "ignored" as const;
  const checkout = await client.query.stripeCheckout.findFirst({
    where: eq(stripeCheckout.id, checkoutId),
  });
  if (!checkout) throw new Error("Unknown Stripe checkout");
  if (
    session.livemode !== stripeIsLive() ||
    session.client_reference_id !== checkout.id ||
    (checkout.sessionId && checkout.sessionId !== session.id)
  )
    throw new Error("Stripe session does not match checkout");
  if (session.status !== "complete" || session.payment_status !== "paid")
    return "pending" as const;
  if (session.automatic_tax?.enabled && session.automatic_tax.status !== "complete")
    throw new Error("Stripe tax calculation is incomplete");
  if (session.currency !== "usd" || session.amount_total !== checkout.amountCents)
    throw new Error("Stripe payment amount does not match checkout");
  if (checkout.federalStatus !== "NONE") {
    if (session.mode !== "subscription") throw new Error("Wrong Stripe checkout mode");
    const subscriptionId = objectId(session.subscription);
    if (!subscriptionId) throw new Error("Stripe checkout has no subscription");
    const subscription =
      typeof session.subscription === "object" && session.subscription
        ? session.subscription
        : await stripe.subscriptions.retrieve(subscriptionId);
    const invoiceId =
      objectId(session.invoice) ?? objectId(subscription.latest_invoice);
    if (!invoiceId) throw new Error("Stripe subscription has no invoice");
    await fulfillStripeInvoice(client, invoiceId);
  } else {
    const paymentIntentId = objectId(session.payment_intent);
    if (session.mode !== "payment" || !paymentIntentId)
      throw new Error("Stripe checkout has no payment intent");
    await grantStripeReceipt(client, {
      id: paymentIntentId,
      isSandbox: !session.livemode,
      checkoutId,
      createdById: await canonicalStoreUserId(client, checkout.createdById),
      affectedUserId: await canonicalStoreUserId(client, checkout.affectedUserId),
      amountCents: checkout.amountCents,
      reputationPoints: checkout.reputationPoints,
      federalStatus: "NONE",
      purchasedAt: new Date(session.created * 1000),
    });
  }
  return "fulfilled" as const;
};

/** Restore retained paid coverage and finish pending deliveries when a character returns. */
export const settleStripePayments = async (client: DrizzleClient, userId: string) => {
  const receipts = await client.query.stripePayment.findMany({
    where: eq(stripePayment.affectedUserId, userId),
  });
  for (const receipt of receipts) {
    if (!receipt.grantedAt && (!receipt.isSandbox || env.NODE_ENV !== "production"))
      await grantStripeReceipt(client, receipt);
  }
  await setFederalStatusWithStoreFloor(client, userId, "NONE");
};

/** Reputation upgrades apply to the current paid period; renewals retain the billed tier. */
export const upgradeStripeFederalWithReps = async (
  client: DrizzleClient,
  userId: string,
  currentTier: FederalStatus,
  nextTier: FederalStatus,
) => {
  const cost = calcFedUgradeCost(currentTier, nextTier);
  if (!cost || cost < 0) return errorResponse("Invalid federal support upgrade.");
  const receipt = await client.query.stripePayment.findFirst({
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
  if (!receipt)
    return errorResponse(
      "Could not find a paid subscription you own for this upgrade.",
    );
  const result = await retryOnDeadlock(() =>
    client.execute(sql`UPDATE ${userData} u INNER JOIN ${stripePayment} p ON p.affectedUserId = u.userId
    SET u.reputationPoints = u.reputationPoints - ${cost},
        u.reputationPointsTotal = u.reputationPointsTotal - ${cost},
        u.federalStatus = ${nextTier},
        p.federalStatusOverride = ${nextTier}
    WHERE p.id = ${receipt.id} AND p.createdById = ${userId} AND p.affectedUserId = ${userId}
      AND p.grantedAt IS NOT NULL AND p.purchasedAt <= CURRENT_TIMESTAMP(3)
      AND p.expiresAt > CURRENT_TIMESTAMP(3)
      AND COALESCE(p.federalStatusOverride, p.federalStatus) = ${currentTier}
      AND u.federalStatus = ${currentTier} AND u.reputationPoints >= ${cost}`),
  );
  if (result.rowsAffected === 0)
    return errorResponse(
      "Your subscription or balance changed. Please reload and try again.",
    );
  return {
    success: true,
    message: "Federal support upgraded for the remainder of this billing period.",
  };
};
