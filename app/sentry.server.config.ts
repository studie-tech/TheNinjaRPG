// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  integrations: [nodeProfilingIntegration()],

  dsn: "https://c35c54f99b73b4a3b8a7e60936bc2967@o4507797256601600.ingest.de.sentry.io/4507797262958672",

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 0.001,

  // Error sample rate
  sampleRate: 1.0,

  // Which errors to ignore from frontend
  ignoreErrors: ["Unauthorized for tRPC endpoint"],

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  // Set the environment
  environment: process.env.NODE_ENV,

  // Profiling
  profileSessionSampleRate: 1,
  profileLifecycle: "manual",

  // Uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: process.env.NODE_ENV === 'development',
});
