import Stripe from "stripe";
import { FEDERAL_MONTHLY_USD_CENTS } from "@/drizzle/constants";
import { env } from "@/env/server.mjs";

export const stripePriceIds = () => ({
  NORMAL: env.STRIPE_PRICE_NORMAL,
  SILVER: env.STRIPE_PRICE_SILVER,
  GOLD: env.STRIPE_PRICE_GOLD,
});

export const isStripeConfigured = () =>
  Boolean(
    (env.NODE_ENV !== "production" || stripeIsLive()) &&
      env.STRIPE_SECRET_KEY &&
      env.STRIPE_WEBHOOK_SECRET &&
      Object.values(stripePriceIds()).every(Boolean),
  );
export const getStripe = () => {
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured");
  return new Stripe(env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 });
};
export const stripeIsLive = () =>
  Boolean(
    env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ||
      env.STRIPE_SECRET_KEY?.startsWith("rk_live_"),
  );

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

export const stripeReturnUrl = () =>
  new URL("/points", env.NEXT_PUBLIC_BASE_URL).toString();
