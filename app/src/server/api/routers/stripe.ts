import { and, desc, eq, gte, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { FEDERAL_MONTHLY_USD_CENTS } from "@/drizzle/constants";
import {
  paypalTransaction,
  stripeCheckout,
  stripePayment,
  userData,
} from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import {
  reputationAllowanceUsed,
  STRIPE_CHECKOUT_LIFETIME_SECONDS,
  STRIPE_CHECKOUT_RESERVATION_SECONDS,
  STRIPE_CHECKOUT_RETRY_SECONDS,
} from "@/server/utils/purchases/allowance";
import {
  getStripe,
  isStripeConfigured,
  stripePriceIds,
  stripeReturnUrl,
  validFederalPrice,
} from "@/server/utils/stripe/client";
import { fulfillStripeSession } from "@/server/utils/stripe/fulfillment";
import { dollars2reps, dynamicMonthlyRepCap, reps2dollars } from "@/utils/paypal";
import {
  stripeCheckoutSchema,
  stripeSessionSchema,
  stripeSubscriptionSchema,
} from "@/validators/stripe";

export const stripeRouter = createTRPCRouter({
  availability: protectedProcedure.query(() => ({ enabled: isStripeConfigured() })),
  createCheckout: protectedProcedure
    .input(stripeCheckoutSchema)
    .mutation(async ({ ctx, input }) => {
      if (isNativeUserAgent(ctx.userAgent))
        return errorResponse("Use the in-app store to purchase in the native app.");
      if (input.expectedUserId !== ctx.userId)
        return errorResponse("Your account changed. Start checkout again.");
      if (!isStripeConfigured())
        return errorResponse("Card payments are temporarily unavailable.");
      const [buyer, recipient, existing, recentPaypal, recentStripe, pending] =
        await Promise.all([
          ctx.drizzle.query.userData.findFirst({
            where: eq(userData.userId, ctx.userId),
          }),
          ctx.drizzle.query.userData.findFirst({
            where: eq(userData.userId, input.userId),
          }),
          ctx.drizzle.query.stripeCheckout.findFirst({
            where: eq(stripeCheckout.id, input.requestId),
          }),
          ctx.drizzle
            .select({
              total:
                sql<number>`COALESCE(SUM(${paypalTransaction.reputationPoints}), 0)`.mapWith(
                  Number,
                ),
            })
            .from(paypalTransaction)
            .where(
              and(
                eq(paypalTransaction.createdById, ctx.userId),
                gte(paypalTransaction.createdAt, sql`NOW() - INTERVAL 30 DAY`),
                sql`${paypalTransaction.status} NOT IN ('CANCELLED', 'REVIEW_REQUIRED')`,
                sql`(${paypalTransaction.status} != 'RESERVED' OR ${paypalTransaction.createdAt} >= NOW() - INTERVAL 3 HOUR)`,
              ),
            ),
          ctx.drizzle
            .select({
              total:
                sql<number>`COALESCE(SUM(${stripePayment.reputationPoints}), 0)`.mapWith(
                  Number,
                ),
            })
            .from(stripePayment)
            .where(
              and(
                eq(stripePayment.createdById, ctx.userId),
                isNotNull(stripePayment.grantedAt),
                ...(env.NODE_ENV === "production"
                  ? [eq(stripePayment.isSandbox, false)]
                  : []),
                gte(stripePayment.purchasedAt, sql`NOW() - INTERVAL 30 DAY`),
              ),
            ),
          ctx.drizzle.query.stripeCheckout.findMany({
            where: and(
              eq(stripeCheckout.createdById, ctx.userId),
              ne(stripeCheckout.id, input.requestId),
              isNull(stripeCheckout.closedAt),
              gte(
                stripeCheckout.createdAt,
                sql`NOW() - INTERVAL ${STRIPE_CHECKOUT_RESERVATION_SECONDS} SECOND`,
              ),
              sql`NOT EXISTS (SELECT 1 FROM ${stripePayment} p WHERE p.checkoutId = ${stripeCheckout.id} AND p.grantedAt IS NOT NULL)`,
            ),
          }),
        ]);
      if (!buyer || !recipient)
        return errorResponse("The buyer or recipient no longer exists.");
      if (buyer.isBanned || recipient.isBanned)
        return errorResponse(
          "Banned accounts cannot purchase points or federal support.",
        );
      const tier =
        input.purchase.type === "federal" ? input.purchase.federalStatus : "NONE";
      const amountCents =
        input.purchase.type === "reputation"
          ? Math.round(reps2dollars(input.purchase.reputationPoints) * 100)
          : FEDERAL_MONTHLY_USD_CENTS[input.purchase.federalStatus];
      // Match PayPal's award for the rounded USD charge, including its volume curve.
      const reputationPoints =
        input.purchase.type === "reputation" ? dollars2reps(amountCents / 100) : 0;
      const priceId = tier === "NONE" ? null : stripePriceIds()[tier];
      if (
        existing &&
        (existing.createdById !== ctx.userId ||
          existing.affectedUserId !== input.userId ||
          existing.amountCents !== amountCents ||
          existing.federalStatus !== tier ||
          existing.reputationPoints !== reputationPoints)
      )
        return errorResponse("Checkout changed. Start a new checkout.");
      if (
        existing?.closedAt ||
        (existing &&
          Date.now() - existing.createdAt.getTime() >
            STRIPE_CHECKOUT_RETRY_SECONDS * 1000 &&
          !existing.sessionId)
      )
        return errorResponse(
          "This checkout cannot be resumed. Its reservation expires 25 hours after it started; then start a new checkout.",
        );
      if (existing?.sessionId) {
        const session = await getStripe().checkout.sessions.retrieve(
          existing.sessionId,
        );
        if (session.status === "open" && session.url)
          return { success: true, message: "Continue checkout", url: session.url };
        return errorResponse(
          "This checkout has already finished or expired. Start a new checkout.",
        );
      }
      if (
        tier === "NONE" &&
        reputationPoints +
          (recentPaypal[0]?.total ?? 0) +
          (recentStripe[0]?.total ?? 0) +
          pending.reduce((sum, checkout) => sum + checkout.reputationPoints, 0) >
          dynamicMonthlyRepCap(buyer)
      )
        return errorResponse("This purchase exceeds your monthly reputation limit.");
      const stripe = getStripe();
      if (tier !== "NONE") {
        if (
          pending.some(
            (checkout) =>
              checkout.affectedUserId === input.userId &&
              checkout.federalStatus !== "NONE",
          )
        )
          return errorResponse(
            "You have an unfinished Stripe subscription checkout for this recipient. Finish or cancel it before starting another.",
          );
        if (!priceId || !validFederalPrice(await stripe.prices.retrieve(priceId), tier))
          return errorResponse(
            "This federal support price is temporarily unavailable.",
          );
        const subscriptions = await ctx.drizzle.query.stripeCheckout.findMany({
          where: and(
            eq(stripeCheckout.createdById, ctx.userId),
            eq(stripeCheckout.affectedUserId, input.userId),
            isNotNull(stripeCheckout.subscriptionId),
          ),
        });
        const external = await Promise.all(
          subscriptions.map((checkout) =>
            stripe.subscriptions.retrieve(checkout.subscriptionId as string),
          ),
        );
        if (
          external.some(
            (subscription) =>
              !["canceled", "incomplete_expired"].includes(subscription.status),
          )
        )
          return errorResponse(
            "You already pay for Stripe support for this recipient. Manage that subscription below first.",
          );
      }
      // The checkout reservation and buyer snapshot advance together. Parallel requests
      // cannot both spend the same remaining monthly allowance or start duplicate support.
      // A short transaction is needed because the guard and durable reservation are two rows.
      if (!existing) {
        const reserved = await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            const claim = await claimUserSnapshot({
              client: tx as typeof ctx.drizzle,
              userId: ctx.userId,
              updatedAt: buyer.updatedAt,
            });
            if (!claim.success) return false;
            if (tier === "NONE") {
              // One statement sees a consistent receipt/reservation transition. Separate
              // upfront reads can miss a checkout that is being delivered between them.
              const allowance = await reputationAllowanceUsed(
                tx,
                ctx.userId,
                "",
                input.requestId,
              );
              if (reputationPoints + allowance > dynamicMonthlyRepCap(buyer))
                return false;
            }
            await tx
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
            return true;
          }),
        );
        if (!reserved)
          return errorResponse(
            "Your account changed during checkout. Please try again.",
          );
      }
      // A concurrent request using the same id must agree with the saved, server-authored terms.
      const saved = await ctx.drizzle.query.stripeCheckout.findFirst({
        where: eq(stripeCheckout.id, input.requestId),
      });
      if (
        !saved ||
        saved.createdById !== ctx.userId ||
        saved.affectedUserId !== input.userId ||
        saved.amountCents !== amountCents ||
        saved.federalStatus !== tier ||
        saved.reputationPoints !== reputationPoints
      )
        return errorResponse("Checkout changed. Start again.");
      const metadata = { tnrCheckoutId: saved.id };
      const session = await stripe.checkout.sessions.create(
        {
          mode: tier === "NONE" ? "payment" : "subscription",
          client_reference_id: saved.id,
          expires_at:
            Math.floor(saved.createdAt.getTime() / 1000) +
            STRIPE_CHECKOUT_LIFETIME_SECONDS,
          metadata,
          allowed_payment_method_types: ["card"],
          adaptive_pricing: { enabled: false },
          automatic_tax: { enabled: true },
          billing_address_collection: "required",
          line_items: [
            {
              quantity: 1,
              ...(tier === "NONE"
                ? {
                    price_data: {
                      currency: "usd",
                      unit_amount: amountCents,
                      tax_behavior: "inclusive",
                      product_data: {
                        name: `${reputationPoints} reputation points — TheNinjaRPG`,
                      },
                    },
                  }
                : { price: saved.priceId as string }),
            },
          ],
          ...(tier === "NONE"
            ? { payment_intent_data: { metadata }, customer_creation: "always" }
            : { subscription_data: { metadata } }),
          success_url: `${stripeReturnUrl()}?stripe_session={CHECKOUT_SESSION_ID}`,
          cancel_url: `${stripeReturnUrl()}?stripe_cancelled=${saved.id}`,
        },
        { idempotencyKey: `tnr-checkout-${saved.id}` },
      );
      await ctx.drizzle
        .update(stripeCheckout)
        .set({ sessionId: session.id })
        .where(eq(stripeCheckout.id, saved.id));
      if (!session.url)
        return errorResponse("Stripe could not open checkout. Please try again.");
      return { success: true, message: "Continue to Stripe", url: session.url };
    }),
  cancelCheckout: protectedProcedure
    .input(stripeSubscriptionSchema)
    .mutation(async ({ ctx, input }) => {
      const checkout = await ctx.drizzle.query.stripeCheckout.findFirst({
        where: eq(stripeCheckout.id, input.checkoutId),
      });
      if (!checkout || checkout.createdById !== ctx.userId)
        return errorResponse("This checkout belongs to another account.");
      if (checkout.closedAt) return { success: true, message: "Checkout cancelled." };
      if (!checkout.sessionId) {
        // A lost response may conceal a real payable session. Close it only after the
        // fixed provider deadline; before then retry with the original idempotency key.
        if (
          Date.now() - checkout.createdAt.getTime() <
          STRIPE_CHECKOUT_RESERVATION_SECONDS * 1000
        )
          return errorResponse(
            "Checkout is still being created. Retry opening it, or wait until its 25-hour reservation expires.",
          );
        await ctx.drizzle
          .update(stripeCheckout)
          .set({ closedAt: new Date() })
          .where(eq(stripeCheckout.id, checkout.id));
        return {
          success: true,
          message: "Expired checkout closed. Start a new checkout.",
        };
      }
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(checkout.sessionId);
      if (session.status === "complete")
        return errorResponse("Payment already completed. Check your payment status.");
      if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
      await ctx.drizzle
        .update(stripeCheckout)
        .set({ closedAt: new Date() })
        .where(eq(stripeCheckout.id, checkout.id));
      return {
        success: true,
        message: "Checkout cancelled. No purchase was confirmed.",
      };
    }),
  resolveSession: protectedProcedure
    .input(stripeSessionSchema)
    .mutation(async ({ ctx, input }) => {
      const session = await getStripe().checkout.sessions.retrieve(input.sessionId);
      const checkout = session.metadata?.tnrCheckoutId
        ? await ctx.drizzle.query.stripeCheckout.findFirst({
            where: eq(stripeCheckout.id, session.metadata.tnrCheckoutId),
          })
        : undefined;
      if (!checkout || checkout.createdById !== ctx.userId)
        return errorResponse("This checkout belongs to another account.");
      const outcome = await fulfillStripeSession(ctx.drizzle, input.sessionId);
      return {
        success: outcome === "fulfilled",
        message:
          outcome === "fulfilled"
            ? "Your Stripe payment has been delivered."
            : "Payment is still processing. You can check again; confirmed payments are delivered automatically.",
      };
    }),
  getPayments: protectedProcedure.query(async ({ ctx }) =>
    ctx.drizzle.query.stripePayment.findMany({
      where: eq(stripePayment.createdById, ctx.userId),
      orderBy: desc(stripePayment.createdAt),
      limit: 100,
    }),
  ),
  getSubscriptions: protectedProcedure.query(async ({ ctx }) => {
    const recipient = alias(userData, "recipient");
    const checkouts = await ctx.drizzle
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
    if (!checkouts.length || !isStripeConfigured()) return [];
    const stripe = getStripe();
    return Promise.all(
      checkouts.map(async ({ checkout, recipientUsername }) => {
        const subscription = await stripe.subscriptions.retrieve(
          checkout.subscriptionId as string,
        );
        return {
          checkoutId: checkout.id,
          federalStatus: checkout.federalStatus,
          affectedUserId: checkout.affectedUserId,
          recipientUsername,
          createdById: checkout.createdById,
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        };
      }),
    );
  }),
  cancelSubscription: protectedProcedure
    .input(stripeSubscriptionSchema)
    .mutation(async ({ ctx, input }) => {
      const checkout = await ctx.drizzle.query.stripeCheckout.findFirst({
        where: eq(stripeCheckout.id, input.checkoutId),
      });
      if (
        !checkout?.subscriptionId ||
        ![checkout.createdById, checkout.affectedUserId].includes(ctx.userId)
      )
        return errorResponse("You are not associated with this subscription.");
      const stripe = getStripe();
      const subscription = await stripe.subscriptions.retrieve(checkout.subscriptionId);
      if (["canceled", "incomplete_expired"].includes(subscription.status))
        return { success: true, message: "This subscription has already ended." };
      await stripe.subscriptions.update(checkout.subscriptionId, {
        cancel_at_period_end: true,
      });
      return {
        success: true,
        message:
          "Renewal cancelled. Federal support remains through the paid billing period.",
      };
    }),
});
