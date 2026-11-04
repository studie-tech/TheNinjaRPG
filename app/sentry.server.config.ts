// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { stripQueryMetricUserAttributes } from "@/libs/queryTelemetry";
import { SENTRY_BASE_OPTIONS, SENTRY_SERVER_ENVIRONMENT } from "@/libs/sentryOptions";

Sentry.init({
  ...SENTRY_BASE_OPTIONS,
  environment: SENTRY_SERVER_ENVIRONMENT,
  beforeSendMetric: stripQueryMetricUserAttributes,

  // Which server errors to ignore
  ignoreErrors: [
    "Unauthorized for tRPC endpoint",
    "You are acting too fast",
    // Stale client after a deployment: the router state tree's last element used
    // to be a boolean and is now a number, so a browser still running the
    // previous build fails Next's schema check on every RSC request. UX: the
    // failed RSC fetch makes Next fall back to a full page load, and the client
    // picks up the new build in the process, so it self-heals on that navigation.
    "The router state header was sent but could not be parsed.",
  ],
});
