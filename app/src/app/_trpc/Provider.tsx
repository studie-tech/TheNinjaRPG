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
import { isRetryableError } from "@/utils/trpc-errors";
import { api, useGlobalOnMutateProtect } from "./client";

const getBaseUrl = () => {
  if (typeof window !== "undefined") return "";
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://127.0.0.1:${process.env.PORT ?? 3000}`;
};

export default function TrpcClientProvider(props: { children: React.ReactNode }) {
  const onMutateCheck = useGlobalOnMutateProtect();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: Infinity,
          },
          mutations: {
            onSettled: () => {
              document.body.style.cursor = "default";
            },
            onError: onError,
          },
        },
        queryCache: new QueryCache({
          onError: onError,
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
          retry(opts) {
            // Retry transient network/CDN errors (network failures, offline, invalid JSON responses)
            if (isRetryableError(opts.error.message) && opts.op.type === "query") {
              return opts.attempts <= 3;
            }
            // Don't retry on non-500s
            if (
              opts.error.data &&
              (opts.error.data as { code?: string }).code !== "INTERNAL_SERVER_ERROR"
            ) {
              return false;
            }
            // Only retry queries
            if (opts.op.type !== "query") {
              return false;
            }
            // Retry up to 3 times
            return opts.attempts <= 3;
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
}

export const onError = (err: unknown) => {
  // Ignore "Unauthorized for tRPC endpoint", since this could be just the user logging out, thus queries failing
  if (
    err instanceof TRPCClientError &&
    err.message.includes("Unauthorized for tRPC endpoint")
  ) {
    return;
  }
  // Ignore transient network/CDN errors (retries handle these gracefully)
  // Only suppress if the error was actually retried and failed (not first attempt failures)
  if (err instanceof TRPCClientError && isRetryableError(err.message)) {
    // Check if this is from a retry context (has retry metadata)
    // If meta.attempts exists and is > 1, this was retried before failing
    const attempts = (err as unknown as { meta?: { attempts?: number } }).meta
      ?.attempts;
    if (attempts && attempts > 1) {
      // Retried and still failed - suppress as it's a persistent network issue
      return;
    }
    // First attempt failure - let it through to Sentry for visibility
  }
  // Ignore abort errors (user navigated away before request completed)
  // Check both cause.name (spec-compliant) and message (fallback for browser variations)
  if (
    err instanceof TRPCClientError &&
    (err.cause?.name === "AbortError" ||
      err.message.includes("The operation was aborted"))
  ) {
    return;
  }
  // Handle "not signed in" errors gracefully (from useGlobalOnMutateProtect)
  if (
    err instanceof Error &&
    err.message.includes("You need to be signed in to perform this action")
  ) {
    showMutationToast({ success: false, message: err.message });
    return;
  }
  console.error("onerror", err);
  if (err instanceof TRPCClientError) {
    const errorCode = (err.data as { code?: string })?.code;
    // Handle rate limiting errors with a softer toast (not logged to Sentry, not destructive)
    if (errorCode === "TOO_MANY_REQUESTS") {
      showMutationToast({ success: false, message: err.message });
      return;
    }
    Sentry.captureException(err, { extra: { message: "TRPC Client Error" } });
    toast({
      variant: "destructive",
      title: err?.data?.code ?? "Unknown",
      description: err.message,
    });
  } else if (err instanceof Error) {
    Sentry.captureException(err, { extra: { message: "TRPC Frontend Error" } });
    toast({
      variant: "destructive",
      title: "Error",
      description: err.message,
    });
  } else if (err !== null && err !== undefined) {
    Sentry.captureMessage("Non-Error object thrown", {
      level: "warning",
      extra: { err },
    });
  }
};
