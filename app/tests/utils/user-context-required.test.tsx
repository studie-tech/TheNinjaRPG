import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import {
  QueryClient,
  QueryClientProvider,
  type UseQueryOptions,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as trpc from "@trpc/react-query";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import * as sector from "@/hooks/useSectorVillage";
import * as pusher from "@/layout/PusherHandler";
import * as userContext from "@/utils/UserContext";
import { UserContextProvider, useRequiredUserDataSelector, useRequireInVillage } from "@/utils/UserContext";
import { actualUserContext } from "../setup/preload";

type Snapshot = {
  serverTime: number;
  notifications: never[];
  userData: { userId: string; isOutlaw?: boolean } | null;
};

const key: ReturnType<typeof trpc.getQueryKey> = [
  ["profile", "getUser"],
  { type: "query" },
];
const clients: QueryClient[] = [];
const push = vi.fn();

beforeEach(() => {
  push.mockClear();
  // Bun retains partial module mocks from UI suites; access checks need real profile observers.
  vi.spyOn(userContext, "useRequiredUserData").mockImplementation(actualUserContext.useRequiredUserData);
  vi.spyOn(userContext, "useRequiredUserDataSelector").mockImplementation(actualUserContext.useRequiredUserDataSelector);
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation(actualUserContext.useUserDataSelector);
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
  consumer = <Consumer />,
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
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <QueryClientProvider client={queryClient}>
        <UserContextProvider initialIsSignedIn={initialIsSignedIn}>
          {consumer}
        </UserContextProvider>
      </QueryClientProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
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

describe("useRequireInVillage", () => {
  const VillageConsumer = ({ enabled = true, redirectTo }: { enabled?: boolean; redirectTo?: string }) => {
    const { access } = useRequireInVillage("/hospital", { enabled, redirectTo });
    return <span>{access ? "Allowed" : "Waiting"}</span>;
  };

  it.each([false, true])("preserves ordinary hospital access for outlaw=%s", async isOutlaw => {
    vi.spyOn(sector, "useSectorVillage").mockReturnValue({ sectorVillage: undefined, isLoading: false } as never);
    const view = await mount({ isLoaded: true, isSignedIn: true }, { serverTime: 0, notifications: [], userData: { userId: "required-test", isOutlaw } }, undefined, true, <VillageConsumer />);
    if (isOutlaw) {
      await waitFor(() => expect(view.getByText("Allowed")).toBeDefined());
      expect(push).not.toHaveBeenCalled();
    } else {
      expect(push).toHaveBeenCalledWith("/");
    }
  });

  it.each([false, true])("waits for recovery then prioritizes confirmed relocation for outlaw=%s", async isOutlaw => {
    vi.spyOn(sector, "useSectorVillage").mockReturnValue({ sectorVillage: undefined, isLoading: false } as never);
    let enabled = false;
    const Relocation = () => <VillageConsumer enabled={enabled} redirectTo={enabled ? "/shrine" : undefined} />;
    const view = await mount({ isLoaded: true, isSignedIn: true }, { serverTime: 0, notifications: [], userData: { userId: "required-test", isOutlaw } }, undefined, true, <Relocation />);
    expect(push).not.toHaveBeenCalled();
    enabled = true;
    view.rerender(<QueryClientProvider client={clients[clients.length - 1]!}><UserContextProvider initialIsSignedIn><Relocation /></UserContextProvider></QueryClientProvider>);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/shrine"));
    expect(push).not.toHaveBeenCalledWith("/");
  });
});
