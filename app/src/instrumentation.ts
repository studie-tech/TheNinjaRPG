import * as Sentry from "@sentry/nextjs";

// This file has to live next to the `app` directory, which for this project
// means inside `src`. At the repository root `next build` never picks it up,
// leaving the server SDK uninitialised on Vercel.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
