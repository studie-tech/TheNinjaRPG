// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { RATE_LIMIT_MESSAGES } from "@/libs/rateLimitMessages";
import { SENTRY_BASE_OPTIONS } from "@/libs/sentryOptions";

Sentry.init({
  ...SENTRY_BASE_OPTIONS,
  // NODE_ENV is "production" for every Vercel build, so VERCEL_ENV is what separates
  // production from preview deployments.
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,

  // Which edge errors to ignore
  ignoreErrors: [
    "Unauthorized for tRPC endpoint",
    "You are acting too fast",
    // UX: the tRPC provider shows rate-limit retry guidance. Combat's local handler
    // keeps the battle visible, clears pending state and lets its automatic driver retry.
    ...RATE_LIMIT_MESSAGES,
  ],
});
