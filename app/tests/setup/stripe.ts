import { afterEach, beforeEach } from "bun:test";
import { env } from "@/env/server.mjs";

const placeholders = {
  STRIPE_SECRET_KEY: "sk_test_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  STRIPE_PRICE_NORMAL: "price_normal",
  STRIPE_PRICE_SILVER: "price_silver",
  STRIPE_PRICE_GOLD: "price_gold",
};

/** Give each test placeholder Stripe configuration on the validated `env` object. */
export const useStripeTestEnv = () => {
  const original = {
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_NORMAL: env.STRIPE_PRICE_NORMAL,
    STRIPE_PRICE_SILVER: env.STRIPE_PRICE_SILVER,
    STRIPE_PRICE_GOLD: env.STRIPE_PRICE_GOLD,
  };
  beforeEach(() => {
    Object.assign(env, placeholders);
  });
  afterEach(() => {
    Object.assign(env, original);
  });
};
