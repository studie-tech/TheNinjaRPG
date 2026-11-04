/** Options shared by the client, server and edge Sentry configs. */
export const SENTRY_BASE_OPTIONS = {
  dsn: "https://c35c54f99b73b4a3b8a7e60936bc2967@o4507797256601600.ingest.de.sentry.io/4507797262958672",

  // Adjust this value in production, or use tracesSampler for greater control
  tracesSampleRate: 0.001,

  // Keep diagnostics without sending account credentials or request/user data.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
  },
};

/**
 * Server-side environment. NODE_ENV is "production" for every Vercel build, so VERCEL_ENV
 * is what separates production from preview deployments.
 */
export const SENTRY_SERVER_ENVIRONMENT = process.env.VERCEL_ENV ?? process.env.NODE_ENV;
