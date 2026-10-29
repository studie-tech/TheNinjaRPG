import { z } from "zod";
import { FEDERAL_MONTHLY_USD_CENTS } from "@/drizzle/constants";
import { isNativeUserAgent } from "@/libs/native/userAgent";
import { findUserById } from "@/queries/profile";
import {
  findStripeCheckoutById,
  insertStripeCheckoutForCreateCheckout,
  listStripeCheckoutForCreateCheckout,
  listStripeCheckoutForCreateCheckout2,
  listStripePaymentForGetPayments,
  selectStripeCheckoutForGetPendingCheckouts,
  selectStripeCheckoutForGetSubscriptions,
  updateStripeCheckoutForCancelCheckout,
  updateStripeCheckoutForCreateCheckout,
} from "@/queries/stripe";
import { createTRPCRouter, errorResponse, protectedProcedure } from "@/server/api/trpc";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import {
  reputationAllowanceUsed,
  STRIPE_CHECKOUT_LIFETIME_SECONDS,
  STRIPE_CHECKOUT_RESERVATION_SECONDS,
  STRIPE_CHECKOUT_RETRY_SECONDS,
} from "@/server/utils/purchases/allowance";
import { getPurchaseUserUpdate } from "@/server/utils/purchases/cache";
import { logError } from "@/server/utils/sentry";
import {
  getStripe,
  isStripeConfigured,
  stripePriceIds,
  stripeReturnUrl,
  validFederalPrice,
} from "@/server/utils/stripe/client";
import { fulfillStripeSession } from "@/server/utils/stripe/fulfillment";
import { dollars2reps, dynamicMonthlyRepCap, reps2dollars } from "@/utils/paypal";
import { stripePurchaseSchema } from "@/validators/stripe";

/** Authenticated web checkout, recovery and management; provider objects establish payment. */
export const stripeRouter = createTRPCRouter({
  /** Expose readiness without leaking credentials or provider configuration. */
  availability: protectedProcedure.query(() => ({ enabled: isStripeConfigured() })),
  /** Persist server-authored terms before idempotently creating a payable session. */
  createCheckout: protectedProcedure
    .input(
      z.object({
        requestId: z.string().regex(/^[A-Za-z0-9_-]{21}$/),
        expectedUserId: z.string().min(1).max(191),
        userId: z.string().min(1).max(191),
        purchase: stripePurchaseSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (isNativeUserAgent(ctx.userAgent))
        return errorResponse("Use the in-app store to purchase in the native app.");
      if (input.expectedUserId !== ctx.userId)
        return errorResponse("Your account changed. Start checkout again.");
      if (!isStripeConfigured())
        return errorResponse("Card payments are temporarily unavailable.");
      const [buyer, recipient, existing, allowanceUsed, pending] = await Promise.all([
        findUserById(ctx.drizzle, ctx.userId),
        findUserById(ctx.drizzle, input.userId),
        findStripeCheckoutById(ctx.drizzle, input.requestId),
        reputationAllowanceUsed(ctx.drizzle, ctx.userId, "", input.requestId),
        listStripeCheckoutForCreateCheckout(ctx.drizzle, ctx, input),
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
        reputationPoints + allowanceUsed > dynamicMonthlyRepCap(buyer)
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
        const subscriptions = await listStripeCheckoutForCreateCheckout2(
          ctx.drizzle,
          ctx,
          input,
        );
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
      // The buyer lock must precede the cross-provider allowance snapshot and reservation
      // INSERT. A joined UPDATE cannot insert a reservation or claim an absent checkout;
      // keeping them together also prevents concurrent duplicate Federal checkouts.
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
            await insertStripeCheckoutForCreateCheckout(
              tx,
              input,
              ctx,
              amountCents,
              reputationPoints,
              tier,
              priceId,
            );
            return true;
          }),
        );
        if (!reserved)
          return errorResponse(
            "Your account changed during checkout. Please try again.",
          );
      }
      // A concurrent request using the same id must agree with the saved, server-authored terms.
      const saved = await findStripeCheckoutById(ctx.drizzle, input.requestId);
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
          managed_payments: { enabled: true },
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
                        tax_code: "txcd_10000000",
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
      await updateStripeCheckoutForCreateCheckout(ctx.drizzle, session, saved);
      if (!session.url)
        return errorResponse("Stripe could not open checkout. Please try again.");
      return { success: true, message: "Continue to Stripe", url: session.url };
    }),
  /** Release allowance only after Stripe confirms that the session cannot be paid. */
  cancelCheckout: protectedProcedure
    .input(z.object({ checkoutId: z.string().min(1).max(191) }))
    .mutation(async ({ ctx, input }) => {
      const checkout = await findStripeCheckoutById(ctx.drizzle, input.checkoutId);
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
        await updateStripeCheckoutForCancelCheckout(ctx.drizzle, checkout);
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
      await updateStripeCheckoutForCancelCheckout(ctx.drizzle, checkout);
      return {
        success: true,
        message: "Checkout cancelled. No purchase was confirmed.",
      };
    }),
  /** Check ownership before authoritative fulfillment; URL parameters never grant value. */
  resolveSession: protectedProcedure
    .input(
      z.object({
        sessionId: z
          .string()
          .regex(/^cs_(?:test_|live_)?[A-Za-z0-9]+$/)
          .max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await getStripe().checkout.sessions.retrieve(input.sessionId);
      const checkout = session.metadata?.tnrCheckoutId
        ? await findStripeCheckoutById(ctx.drizzle, session.metadata.tnrCheckoutId)
        : undefined;
      if (!checkout || checkout.createdById !== ctx.userId)
        return errorResponse("This checkout belongs to another account.");
      const outcome = await fulfillStripeSession(ctx.drizzle, input.sessionId);
      return {
        success: outcome === "fulfilled",
        ...(outcome === "fulfilled"
          ? await getPurchaseUserUpdate(ctx.drizzle, ctx.userId)
          : {}),
        message:
          outcome === "fulfilled"
            ? "Your Stripe payment has been delivered."
            : outcome === "review_required"
              ? "Payment received but exceeds your monthly allowance. Contact support with your Stripe payment ID for review or refund; no points were delivered."
              : "Payment is still processing. You can check again; confirmed payments are delivered automatically.",
      };
    }),
  /** Recover payer-owned reservations with their original immutable checkout terms. */
  getPendingCheckouts: protectedProcedure.query(async ({ ctx }) => {
    return selectStripeCheckoutForGetPendingCheckouts(ctx.drizzle, ctx);
  }),
  /** Return payer receipts, including held payments needed for support or refund review. */
  getPayments: protectedProcedure.query(async ({ ctx }) =>
    listStripePaymentForGetPayments(ctx.drizzle, ctx),
  ),
  /** Read provider renewal state for subscriptions the caller pays for or receives. */
  getSubscriptions: protectedProcedure.query(async ({ ctx }) => {
    const checkouts = await selectStripeCheckoutForGetSubscriptions(ctx.drizzle, ctx);
    if (!checkouts.length || !isStripeConfigured()) return [];
    const stripe = getStripe();
    return Promise.all(
      checkouts.map(async ({ checkout, recipientUsername }) => {
        // One missing or rate-limited object must not hide healthy renewal controls.
        // Keep the failed row visible as unknown so its own retry/cancellation stays available.
        const subscription = await stripe.subscriptions
          .retrieve(checkout.subscriptionId as string)
          .catch((error: unknown) => {
            logError(error, "Could not load Stripe subscription", {
              checkoutId: checkout.id,
            });
            return null;
          });
        return {
          checkoutId: checkout.id,
          federalStatus: checkout.federalStatus,
          affectedUserId: checkout.affectedUserId,
          recipientUsername,
          createdById: checkout.createdById,
          status: subscription?.status ?? "unavailable",
          cancelAtPeriodEnd: subscription?.cancel_at_period_end ?? false,
        };
      }),
    );
  }),
  /** Stop future renewals while retaining the already-paid invoice period. */
  cancelSubscription: protectedProcedure
    .input(z.object({ checkoutId: z.string().min(1).max(191) }))
    .mutation(async ({ ctx, input }) => {
      const checkout = await findStripeCheckoutById(ctx.drizzle, input.checkoutId);
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
