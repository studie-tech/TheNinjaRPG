import type Stripe from "stripe";
import { FEDERAL_MONTHLY_USD_CENTS } from "@/drizzle/constants";
import { env } from "@/env/server.mjs";

/** Resolve the configured USD recurring prices without capturing environment at import time. */
export const stripePriceIds = () => ({
  NORMAL: env.STRIPE_PRICE_NORMAL,
  SILVER: env.STRIPE_PRICE_SILVER,
  GOLD: env.STRIPE_PRICE_GOLD,
});

/** Offer checkout only with complete credentials and live mode in production. */
export const isStripeConfigured = () =>
  Boolean(
    (env.NODE_ENV !== "production" || stripeIsLive()) &&
      env.STRIPE_SECRET_KEY &&
      env.STRIPE_WEBHOOK_SECRET &&
      Object.values(stripePriceIds()).every(Boolean),
  );
/** Create the server-only SDK client with bounded network retries; callers supply write idempotency. */
export const getStripe = async () => {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured");
  const { default: StripeClient } = await import("stripe");
  return new StripeClient(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });
};
/** Match receipts and webhook events to the configured standard or restricted key environment. */
export const stripeIsLive = () =>
  Boolean(
    env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ||
      env.STRIPE_SECRET_KEY?.startsWith("rk_live_"),
  );

/** Reject archived, foreign, exclusive-tax or nonmonthly prices before opening checkout. */
export const validFederalPrice = (
  price: Stripe.Price,
  tier: keyof typeof FEDERAL_MONTHLY_USD_CENTS,
) =>
  price.active &&
  price.currency === "usd" &&
  price.tax_behavior === "inclusive" &&
  price.unit_amount === FEDERAL_MONTHLY_USD_CENTS[tier] &&
  price.recurring?.interval === "month" &&
  price.recurring.interval_count === 1 &&
  price.type === "recurring";

/** Return to the same configured application origin after hosted checkout. */
export const stripeReturnUrl = () =>
  new URL("/points", env.NEXT_PUBLIC_BASE_URL).toString();
