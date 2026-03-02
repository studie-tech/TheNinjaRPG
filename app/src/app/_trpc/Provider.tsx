"use client";

import * as Sentry from "@sentry/nextjs";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink, loggerLink, retryLink, TRPCClientError } from "@trpc/client";
import { useState } from "react";
import superjson from "superjson";
import { toast } from "@/components/ui/use-toast";
import { showMutationToast } from "@/libs/toast";
import { extractStackFramesFromError, parseStackFrames } from "@/utils/error";
import { api, useGlobalOnMutateProtect } from "./client";
import { isRetryableTrpcError } from "./errors";

const getBaseUrl = () => {
  if (typeof window !== "undefined") return "";
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://127.0.0.1:${process.env.PORT ?? 3000}`;
};

const TrpcClientProvider = (props: { children: React.ReactNode }) => {
  const onMutateCheck = useGlobalOnMutateProtect();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: Infinity,
          },
        },
        queryCache: new QueryCache({
          onError: (error, _query) => onError(error),
        }),
        mutationCache: new MutationCache({
          onMutate: (_variables, mutation) => {
            // Extract tRPC mutation path from mutation key (e.g., [["towerDefense", "initiateGuestSession"]])
            const key = mutation.options.mutationKey;
            const mutationPath =
              Array.isArray(key) && Array.isArray(key[0])
                ? key[0].join(".")
                : undefined;
            onMutateCheck(mutationPath);
            document.body.style.cursor = "wait";
          },
          onError: (error, _variables, _context, _mutation) => onError(error),
          onSettled: () => {
            document.body.style.cursor = "default";
          },
        }),
      }),
  );
  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        retryLink({
          retry(options) {
            // Retry transient network/CDN errors (network failures, offline, invalid JSON responses)
            if (isRetryableTrpcError(options.error) && options.op.type === "query") {
              return options.attempts <= 3;
            }
            // Don't retry on non-500s
            if (
              options.error.data &&
              (options.error.data as { code?: string }).code !== "INTERNAL_SERVER_ERROR"
            ) {
              return false;
            }
            // Only retry queries
            if (options.op.type !== "query") {
              return false;
            }
            // Retry up to 3 times
            return options.attempts <= 3;
          },
          // Double every attempt, with max of 30 seconds (starting at 1 second)
          retryDelayMs: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
        }),
        loggerLink({
          enabled: (opts) =>
            process.env.NODE_ENV === "development" ||
            (opts.direction === "down" && opts.result instanceof Error),
        }),
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
        }),
      ],
    }),
  );
  return (
    <api.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{props.children}</QueryClientProvider>
    </api.Provider>
  );
};

export default TrpcClientProvider;

export const onError = (error: unknown) => {
  // Ignore "Unauthorized for tRPC endpoint", since this could be just the user logging out, thus queries failing
  // This error is thrown server-side by auth middleware, so we silently handle it to avoid showing
  // destructive toasts during normal logout flows
  // Validate error originates from auth middleware by checking stack trace
  if (
    error instanceof TRPCClientError &&
    error.message.includes("Unauthorized for tRPC endpoint")
  ) {
    const stackFrames = extractStackFramesFromError(error);
    const isFromAuthMiddleware =
      stackFrames?.some(
        (frame) =>
          frame.filename?.includes("trpc") || frame.filename?.includes("middleware"),
      ) ||
      !stackFrames ||
      stackFrames.length === 0;
    if (isFromAuthMiddleware) {
      return;
    }
  }
  // Ignore transient network/CDN errors (retries handle these gracefully)
  // Queries are retried by retryLink (up to 3 attempts), mutations are never retried
  // All retryable errors are suppressed here to avoid user-facing toasts for transient issues
  if (error instanceof TRPCClientError) {
    if (isRetryableTrpcError(error)) {
      // Filtered from Sentry in instrumentation-client.ts (isNetworkNavigationError)
      return;
    }
  }
  // Ignore abort errors (user navigated away before request completed)
  // Use spec-compliant cause.name check
  if (error instanceof TRPCClientError && error.cause?.name === "AbortError") {
    return;
  }
  // Handle "not signed in" errors gracefully (from useGlobalOnMutateProtect)
  // Validate error originates from useGlobalOnMutateProtect by checking stack trace
  if (
    error instanceof Error &&
    error.message.includes("You need to be signed in to perform this action")
  ) {
    const stackFrames = parseStackFrames(error.stack);
    const isFromOnMutateProtect = stackFrames?.some(
      (frame) =>
        frame.filename?.includes("useGlobalOnMutateProtect") ||
        frame.filename?.includes("Provider"),
    );
    if (isFromOnMutateProtect || !stackFrames || stackFrames.length === 0) {
      showMutationToast({ success: false, message: error.message });
      return;
    }
  }
  console.error("onerror", error);
  if (error instanceof TRPCClientError) {
    const errorCode = (error.data as { code?: string })?.code;
    // Handle rate limiting errors with a softer toast (not logged to Sentry, not destructive)
    if (errorCode === "TOO_MANY_REQUESTS") {
      showMutationToast({ success: false, message: error.message });
      return;
    }
    Sentry.captureException(error, { extra: { message: "TRPC Client Error" } });
    toast({
      variant: "destructive",
      title: error?.data?.code ?? "Unknown",
      description: error.message,
    });
  } else if (error instanceof Error) {
    Sentry.captureException(error, { extra: { message: "TRPC Frontend Error" } });
    toast({
      variant: "destructive",
      title: "Error",
      description: error.message,
    });
  } else if (error !== null && error !== undefined) {
    Sentry.captureMessage("Non-Error object thrown", {
      level: "warning",
      extra: { error },
    });
  }
};
