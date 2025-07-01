"use client";

import superjson from "superjson";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TRPCClientError, httpBatchLink, loggerLink } from "@trpc/client";
import { toast } from "@/components/ui/use-toast";
import { QueryCache, MutationCache } from "@tanstack/react-query";
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
            onMutate: () => {
              onMutateCheck();
              document.body.style.cursor = "wait";
            },
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
          onMutate: () => {
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
  console.error("onerror", err);
  if (err instanceof TRPCClientError) {
    toast({
      variant: "destructive",
      title: err?.data?.code ?? "Unknown", // eslint-disable-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      description: err.message,
    });
  } else if (err instanceof Error) {
    toast({
      variant: "destructive",
      title: "Error",
      description: err.message,
    });
  }
};
