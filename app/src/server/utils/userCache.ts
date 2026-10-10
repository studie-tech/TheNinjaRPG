import * as Sentry from "@sentry/nextjs";

/** Cache reads follow committed writes; failure falls back to the normal profile refresh. */
export const handleUserCacheReadError = (error: unknown): undefined => {
  Sentry.captureException(error, {
    level: "warning",
    tags: { source: "userCacheRead" },
  });
  return undefined;
};
