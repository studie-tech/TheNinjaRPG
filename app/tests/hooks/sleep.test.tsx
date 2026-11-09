import { afterEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import type { ReactNode } from "react";
import superjson from "superjson";
import * as clientModule from "@/app/_trpc/client";
import { useSleepToggle } from "@/hooks/sleep";
import type { UserWithRelations } from "@/server/api/routers/profile";
import * as userContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { deferred } from "../setup/deferred";
import { TrpcTestProviders, testApi } from "../setup/trpc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("reconciles a delayed sleep response instead of replacing a newer hospitalization", async () => {
  const key = ["profile"];
  const profile = (status: "AWAKE" | "ASLEEP" | "HOSPITALIZED") => ({
    userData: { status } as NonNullable<UserWithRelations>,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(key, profile("AWAKE"));
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: async () => profile("HOSPITALIZED"),
  });
  const unsubscribe = observer.subscribe(() => {});
  let finish!: () => void;
  const { promise: dispatched, resolve: started } = deferred<void>();
  // Fresh hooks preserve mutation lifecycles after other suites replace the shared API.
  Object.assign(vi.spyOn(clientModule, "api" as never), { home: testApi.home });
  const trpc = testApi.createClient({
    links: [
      httpBatchLink({
        url: "http://localhost/api/trpc",
        transformer: superjson,
        fetch: async () => {
          started();
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return Response.json([
            {
              result: {
                data: superjson.serialize({
                  success: true,
                  message: "Asleep",
                  newStatus: "ASLEEP",
                }),
              },
            },
          ]);
        },
      }),
    ],
  });
  const user = {
    prepareUserUpdate: () => prepareUserUpdate(client, key),
    updateUser: (patch, mutation) => updateUserCache(client, key, patch, mutation),
  } as ReturnType<typeof userContext.useUserData>;
  vi.spyOn(userContext, "useUserData").mockReturnValue(user);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TrpcTestProviders client={trpc} queryClient={client}>
      {children}
    </TrpcTestProviders>
  );
  const { result } = renderHook(() => useSleepToggle(), { wrapper });
  act(() => result.current.toggleSleep());
  await dispatched;
  client.setQueryData(key, profile("HOSPITALIZED"));
  await act(async () => finish());
  await waitFor(() => expect(result.current.isTogglingSleep).toBe(false));
  expect(client.getQueryData<ReturnType<typeof profile>>(key)).toEqual(
    profile("HOSPITALIZED"),
  );
  unsubscribe();
  client.clear();
});
