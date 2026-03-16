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
import { isRetryableTrpcError } from "@/utils/error";
import {
  api,
  SIGN_IN_REQUIRED_MUTATION_MESSAGE,
  useGlobalOnMutateProtect,
} from "./client";

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
          mutations: {
            onError: (error) => handleTrpcError(error),
          },
        },
        queryCache: new QueryCache({
          onError: (error, _query) => handleTrpcError(error),
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

/**
 * Check if an error message indicates a JSON parsing error.
 * Detects browser-specific JSON parsing error messages from tRPC responses.
 */
const isJsonParseError = (message: string): boolean => {
  return (
    message.includes("Failed to execute 'json' on 'Response'") ||
    message.includes("Unexpected end of JSON input") ||
    message.includes("JSON.parse") ||
    message.includes("The string did not match the expected pattern") ||
    message.includes("is not valid JSON")
  );
};

const handleTrpcError = (error: unknown) => {
  const trpcErrorCode =
    error instanceof TRPCClientError
      ? (error.data as { code?: string } | undefined)?.code
      : undefined;

  // Ignore "Unauthorized for tRPC endpoint", since this could be just the user logging out, thus queries failing
  // This error is thrown server-side by auth middleware, so we silently handle it to avoid showing
  // destructive toasts during normal logout flows. Some client/network error shapes do not
  // preserve error.data.code, so only require the code when tRPC actually provided one.
  if (
    error instanceof TRPCClientError &&
    error.message.includes("Unauthorized for tRPC endpoint") &&
    (trpcErrorCode === undefined || trpcErrorCode === "UNAUTHORIZED")
  ) {
    return;
  }

  // Ignore JSON parsing errors from 403 responses (auth session expired)
  // When Clerk sessions expire, protected endpoints return 403 with HTML error pages.
  // tRPC attempts to parse as JSON, triggering browser-specific JSON errors:
  // - Safari: "The string did not match the expected pattern"
  // - Chrome: '"<!DOCTYPE "... is not valid JSON'
  // - Firefox: "JSON.parse: unexpected character at line 1 column 1"
  // These are legitimate auth transitions, not actionable errors.
  // UX: No toast shown, user either gets redirected by useRequiredUserData or stays on page silently.
  // This check must come BEFORE console.error and Sentry logging to prevent noise.
  // Note: When JSON parsing fails, error.data is null/undefined, so we only check the message pattern.
  // HTML error pages (403/404/500) all trigger similar JSON parse errors and should be filtered here.
  if (error instanceof TRPCClientError && isJsonParseError(error.message)) {
    // Check if this is an HTML error page (DOCTYPE or common HTML tags in the response)
    // tRPC wraps the unparseable response body in the error message like: '"<!DOCTYPE "... is not valid JSON'
    if (
      error.message.includes("<!DOCTYPE") ||
      error.message.includes("<html") ||
      error.message.includes("<HTML")
    ) {
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
  // Use spec-compliant cause.name check with message-based fallback for browsers
  // that don't properly set cause.name
  if (error instanceof TRPCClientError) {
    if (error.cause?.name === "AbortError") {
      // AbortError cause is reliable, no validation needed
      return;
    }
    if (error.message.includes("The operation was aborted")) {
      // Message-based fallback: abort errors always have this specific message
      // and originate from fetch/navigation context, so message match is sufficient
      return;
    }
  }
  // Handle "not signed in" errors gracefully (from useGlobalOnMutateProtect)
  // This specific error message is only thrown from useGlobalOnMutateProtect in client.ts,
  // so message matching is sufficient (stack trace checking doesn't work in production builds)
  if (error instanceof Error && error.message === SIGN_IN_REQUIRED_MUTATION_MESSAGE) {
    showMutationToast({ success: false, message: error.message });
    return;
  }
  console.error("onerror", error);
  if (error instanceof TRPCClientError) {
    const errorCode = trpcErrorCode;
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
