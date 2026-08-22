// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://c35c54f99b73b4a3b8a7e60936bc2967@o4507797256601600.ingest.de.sentry.io/4507797262958672",

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 0.001,

  // Error sample rate
  sampleRate: 1.0,

  // Which errors to ignore from frontend
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

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,

  // Adds request headers and IP for users, for more info visit:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  // Set the environment. NODE_ENV is "production" for every Vercel build, so
  // VERCEL_ENV is what separates production from preview deployments.
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,

  // Uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: process.env.NODE_ENV === 'development',
});
