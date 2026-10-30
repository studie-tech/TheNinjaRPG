import type Stripe from "stripe";
import { FEDERAL_MONTHLY_USD_CENTS, type FederalStatus } from "@/drizzle/constants";
import type { stripeCheckout, stripePayment } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import {
  executeResultForClaim,
  executeResultForUpgradeStripeFederalWithReps,
  findStripeCheckoutById,
  findStripePaymentForGrantStripeReceipt,
  findStripePaymentForUpgradeStripeFederalWithReps,
  insertStripePaymentForGrantStripeReceipt,
  listStripePaymentForSettleStripePayments,
  updateStripeCheckoutForFulfillStripeInvoice,
  updateStripePaymentForClaim,
  updateStripePaymentForGrantStripeReceipt,
} from "@/queries/stripe";
import { errorResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import {
  lockPurchaseBuyer,
  reputationAllowanceUsed,
} from "@/server/utils/purchases/allowance";
import {
  fetchPurchaseUserCacheInputs,
  getKnownPurchaseUserUpdate,
} from "@/server/utils/purchases/cache";
import {
  canonicalStoreUserId,
  isRetiredStoreUserId,
  setFederalStatusWithStoreFloor,
} from "@/server/utils/purchases/grant";
import { logError } from "@/server/utils/sentry";
import { calcFedUgradeCost, dynamicMonthlyRepCap } from "@/utils/paypal";
import { getStripe, stripeIsLive } from "./client";

type Checkout = typeof stripeCheckout.$inferSelect;
/** Immutable provider terms persisted before an idempotent game-value claim. */
export type StripeReceipt = typeof stripePayment.$inferInsert;

/** Persist verified terms, then atomically claim delivery; held receipts never grant value. */
export const grantStripeReceipt = async (
  client: DrizzleClient,
  receipt: StripeReceipt,
) =>
  retryOnDeadlock(async () => {
    await insertStripePaymentForGrantStripeReceipt(client, receipt);
    const stored = await findStripePaymentForGrantStripeReceipt(client, receipt);
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
      await updateStripePaymentForGrantStripeReceipt(
        client,
        recipientId,
        buyerId,
        stored,
      );
    }
    // Reputation delivery shares the buyer lock with checkout reservations and PayPal
    // grants, so released reservations cannot turn delayed payments into excess credit.
    // The SUM must run after acquiring that lock; a joined credit UPDATE alone cannot
    // serialize the cross-provider aggregate. Federal-only claims need no transaction.
    const claim = async (client: DrizzleClient) => {
      if (stored.reputationPoints > 0) {
        const buyer = await lockPurchaseBuyer(client, buyerId);
        if (!buyer) throw new Error("Stripe receipt buyer is unavailable");
        const current = await findStripePaymentForGrantStripeReceipt(client, stored);
        if (current?.grantedAt) return;
        if (current?.reviewRequired) return "review_required" as const;
        if (
          (await reputationAllowanceUsed(client, buyerId, "", stored.checkoutId)) +
            stored.reputationPoints >
          dynamicMonthlyRepCap(buyer)
        ) {
          await updateStripePaymentForClaim(client, stored);
          return "review_required" as const;
        }
      }
      if (!stored.grantedAt) {
        // The marker and credit commit together; an interrupted response can safely retry.
        const result = await executeResultForClaim(client, receipt);
        if (result.rowsAffected === 0) {
          const current = await findStripePaymentForGrantStripeReceipt(client, receipt);
          if (!current?.grantedAt && !(await isRetiredStoreUserId(client, recipientId)))
            throw new Error("Stripe receipt recipient is unavailable");
        }
      }
    };
    const outcome = stored.grantedAt
      ? undefined
      : stored.reputationPoints > 0
        ? await client.transaction(claim)
        : await claim(client);
    if (outcome) return outcome;
    // Recompute even on duplicate delivery: a failure after the claim must be recoverable.
    await setFederalStatusWithStoreFloor(client, recipientId, "NONE");
  });

/** Accept either the SDK's expanded object or its unexpanded provider reference. */
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
  if (!invoice.automatic_tax?.enabled || invoice.automatic_tax.status !== "complete")
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

/** Validate a managed paid invoice and bind its exact period to the original checkout. */
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
  const checkout = await findStripeCheckoutById(client, checkoutId);
  if (!checkout) throw new Error("Unknown Stripe subscription checkout");
  if (checkout.subscriptionId && checkout.subscriptionId !== subscriptionId)
    throw new Error("Stripe subscription does not match checkout");
  const coverage = invoiceCoverage(invoice, checkout);
  if (!subscription.managed_payments?.enabled)
    throw new Error("Stripe subscription is not managed by Stripe");
  if (!coverage) throw new Error("Stripe paid invoice does not match checkout terms");
  const linked = await updateStripeCheckoutForFulfillStripeInvoice(
    client,
    subscriptionId,
    checkoutId,
  );
  if (linked.rowsAffected === 0) {
    const current = await findStripeCheckoutById(client, checkoutId);
    if (current?.subscriptionId !== subscriptionId)
      throw new Error("Stripe subscription does not match checkout");
  }
  await grantStripeReceipt(client, {
    id: invoice.id,
    isSandbox: !invoice.livemode,
    checkoutId,
    createdById: checkout.createdById,
    affectedUserId: checkout.affectedUserId,
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
  const checkout = await findStripeCheckoutById(client, checkoutId);
  if (!checkout) throw new Error("Unknown Stripe checkout");
  if (
    session.livemode !== stripeIsLive() ||
    session.client_reference_id !== checkout.id ||
    (checkout.sessionId && checkout.sessionId !== session.id)
  )
    throw new Error("Stripe session does not match checkout");
  if (session.status !== "complete" || session.payment_status !== "paid")
    return "pending" as const;
  if (!session.managed_payments?.enabled)
    throw new Error("Stripe checkout is not managed by Stripe");
  if (!session.automatic_tax?.enabled || session.automatic_tax.status !== "complete")
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
    const outcome = await grantStripeReceipt(client, {
      id: paymentIntentId,
      isSandbox: !session.livemode,
      checkoutId,
      createdById: checkout.createdById,
      affectedUserId: checkout.affectedUserId,
      amountCents: checkout.amountCents,
      reputationPoints: checkout.reputationPoints,
      federalStatus: "NONE",
      purchasedAt: new Date(session.created * 1000),
    });
    if (outcome) return outcome;
  }
  return "fulfilled" as const;
};

/** Restore retained paid coverage and finish pending deliveries when a character returns. */
export const settleStripePayments = async (client: DrizzleClient, userId: string) => {
  // Settlement is recoverable background work: a failed payment must not interrupt
  // registration after the character row exists but before starter data is created.
  try {
    const receipts = await listStripePaymentForSettleStripePayments(client, userId);
    for (const receipt of receipts) {
      if (!receipt.grantedAt && (!receipt.isSandbox || env.NODE_ENV !== "production")) {
        try {
          await grantStripeReceipt(client, receipt);
        } catch (error) {
          logError(error, "Stripe receipt remains pending for settlement", {
            receiptId: receipt.id,
            userId,
          });
        }
      }
    }
    await setFederalStatusWithStoreFloor(client, userId, "NONE");
  } catch (error) {
    logError(error, "Stripe settlement will retry after character registration", {
      userId,
    });
  }
};

/** Reputation upgrades apply to the current paid period; renewals retain the billed tier. */
export const upgradeStripeFederalWithReps = async (
  client: DrizzleClient,
  userId: string,
  currentTier: FederalStatus,
  nextTier: FederalStatus,
  inputs?: Awaited<ReturnType<typeof fetchPurchaseUserCacheInputs>>,
) => {
  const cost = calcFedUgradeCost(currentTier, nextTier);
  if (!cost || cost < 0) return errorResponse("Invalid federal support upgrade.");
  const [receipt, purchaseInputs] = await Promise.all([
    findStripePaymentForUpgradeStripeFederalWithReps(client, userId, currentTier),
    inputs ?? fetchPurchaseUserCacheInputs(client, userId).catch(() => undefined),
  ]);
  if (!receipt)
    return errorResponse(
      "Could not find a paid subscription you own for this upgrade.",
    );
  const result = await retryOnDeadlock(() =>
    executeResultForUpgradeStripeFederalWithReps(
      client,
      cost,
      nextTier,
      receipt,
      userId,
      currentTier,
    ),
  );
  if (result.rowsAffected === 0)
    return errorResponse(
      "Your subscription or balance changed. Please reload and try again.",
    );
  return {
    success: true,
    message: "Federal support upgraded for the remainder of this billing period.",
    ...getKnownPurchaseUserUpdate(
      purchaseInputs,
      { federalStatus: nextTier },
      {
        reputationPoints: -cost,
        reputationPointsTotal: -cost,
      },
    ),
  };
};
