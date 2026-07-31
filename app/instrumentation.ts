import * as Sentry from "@sentry/nextjs";

export async function register() {
  const marker: Record<string, unknown> = {
    called: true,
    nextRuntime: process.env.NEXT_RUNTIME ?? null,
    at: new Date().toISOString(),
  };
  (globalThis as Record<string, unknown>).__TNR_SENTRY_REGISTER__ = marker;
  try {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      await import("./sentry.server.config");
      marker.imported = "nodejs";
    }
    if (process.env.NEXT_RUNTIME === "edge") {
      await import("./sentry.edge.config");
      marker.imported = "edge";
    }
    marker.clientAfterInit = !!Sentry.getClient();
  } catch (error) {
    marker.error = error instanceof Error ? error.message : String(error);
  }
  console.log("[sentry-probe] register()", JSON.stringify(marker));
}

export const onRequestError = Sentry.captureRequestError;
