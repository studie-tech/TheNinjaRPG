import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type { ReactNode } from "react";
import type { AppRouter } from "@/server/api/root";

/** Real tRPC hooks for UI suites; other suites replace the app's shared `api` with stubs. */
export const testApi = createTRPCReact<AppRouter>();

/**
 * Client whose transport is `respond`: its result or rejection settles the procedure on a later
 * microtask, and it runs in the same tick the procedure was requested.
 */
export const fakeTrpcClient = (respond: (path: string, input: unknown) => unknown) =>
  testApi.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            const settle = async () => respond(op.path, op.input);
            void settle().then(
              (data) => {
                observer.next({ result: { data } });
                observer.complete();
              },
              (error) => observer.error(error),
            );
          }),
    ],
  });

export const TrpcTestProviders = ({
  client,
  queryClient,
  children,
}: {
  client: ReturnType<typeof testApi.createClient>;
  queryClient: QueryClient;
  children: ReactNode;
}) => (
  <testApi.Provider client={client} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  </testApi.Provider>
);
