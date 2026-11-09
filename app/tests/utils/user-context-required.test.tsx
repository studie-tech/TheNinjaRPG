import * as clerk from "@clerk/nextjs";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as trpc from "@trpc/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import * as pusher from "@/layout/PusherHandler";
import { UserContextProvider, useRequiredUserDataSelector } from "@/utils/UserContext";

type Snapshot = {
  serverTime: number;
  notifications: never[];
  userData: { userId: string } | null;
};

const key: ReturnType<typeof trpc.getQueryKey> = [
  ["profile", "getUser"],
  { type: "query" },
];
const clients: QueryClient[] = [];
const push = vi.fn();

beforeEach(() => {
  push.mockClear();
  vi.spyOn(trpc, "getQueryKey").mockReturnValue(key);
  vi.spyOn(pusher, "usePusherHandler").mockReturnValue(undefined);
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
});

afterEach(() => {
  cleanup();
  for (const queryClient of clients.splice(0)) queryClient.clear();
  vi.restoreAllMocks();
});

const Consumer = () => {
  useRequiredUserDataSelector((user) => user.userId);
  return null;
};

const mount = async (
  session: { isLoaded: boolean; isSignedIn?: boolean },
  cached?: Snapshot,
  response: Promise<Snapshot> = new Promise(() => undefined),
  initialIsSignedIn = true,
) => {
  vi.spyOn(clerk, "useUser").mockReturnValue({
    ...session,
    user: session.isSignedIn ? { id: "required-test" } : null,
  } as never);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(queryClient);
  if (cached) queryClient.setQueryData(key, cached);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    profile: {
      getUser: {
        useQuery: (_input: undefined, options: UseQueryOptions<Snapshot>) => ({
          ...useQuery({ ...options, queryKey: key, queryFn: () => response }),
        }),
      },
    },
  });
  await act(async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <UserContextProvider initialIsSignedIn={initialIsSignedIn}>
          <Consumer />
        </UserContextProvider>
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe("useRequiredUserDataSelector", () => {
  it("waits for Clerk before judging the session", async () => {
    await mount({ isLoaded: false });
    expect(push).not.toHaveBeenCalled();
  });

  it("waits for Clerk on a hard load that starts signed out", async () => {
    await mount({ isLoaded: false }, undefined, undefined, false);
    expect(push).not.toHaveBeenCalled();
  });

  it("sends signed-out visitors home", async () => {
    await mount({ isLoaded: true, isSignedIn: false });
    expect(push).toHaveBeenCalledWith("/");
  });

  it("waits while the signed-in profile is loading", async () => {
    await mount({ isLoaded: true, isSignedIn: true });
    expect(push).not.toHaveBeenCalled();
  });

  it("sends signed-in users without a character home", async () => {
    await mount(
      { isLoaded: true, isSignedIn: true },
      undefined,
      Promise.resolve({ serverTime: 0, notifications: [], userData: null }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
  });

  it("keeps users with a character on the page", async () => {
    await mount(
      { isLoaded: true, isSignedIn: true },
      { serverTime: 0, notifications: [], userData: { userId: "required-test" } },
    );
    expect(push).not.toHaveBeenCalled();
  });
});
