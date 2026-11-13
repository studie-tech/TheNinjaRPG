import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import * as navigation from "next/navigation";
import * as Pusher from "pusher-js";
import { createContext, useContext } from "react";
import type { AppRouter } from "@/api/root";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import * as ContentBox from "@/layout/ContentBox";
import { HuntingBoard } from "@/layout/HuntingBoard";
import { type UserEvent, usePusherHandler } from "@/layout/PusherHandler";
import * as routing from "@/utils/routing";
import * as userContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { huntingHabitatContent } from "../setup/hunting";
import { mockUserContextValue } from "../setup/userContext";

const testApi = createTRPCReact<AppRouter>();
const UserContext = createContext<ReturnType<typeof userContext.useUserData> | null>(
  null,
);
const key = getQueryKey(testApi.profile.getUser, undefined, "query");
const clients: QueryClient[] = [];
const router = {
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  bfcacheId: "hunting-cache",
};
type Profile = NonNullable<RouterOutputs["profile"]["getUser"]>;
type Connection = { socket_id?: string; receive: (event: UserEvent) => Promise<void> };
const snapshot = (admitted = false) =>
  ({
    userData: {
      userId: "hunter",
      role: "USER",
      rank: "GENIN",
      titles: [],
      items: [],
      occupation: "HUNTER",
      status: admitted ? "BATTLE" : "AWAKE",
      battleId: admitted ? "hunt" : null,
      pveFights: admitted ? 3 : 2,
    },
    notifications: admitted
      ? [{ href: "/combat", name: "In combat", color: "red" }]
      : [],
  }) as unknown as Profile;

beforeEach(() => {
  vi.spyOn(navigation, "useRouter").mockReturnValue(router as never);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/occupation");
  vi.spyOn(routing, "pushToCombat")
    .mockImplementation(() => undefined)
    .mockClear();
  Object.assign(vi.spyOn(client, "api" as never), {
    hunting: testApi.hunting,
    profile: testApi.profile,
    tournament: testApi.tournament,
    useUtils: testApi.useUtils,
  });
  mockUserContextValue(() => {
    const value = useContext(UserContext);
    if (!value) throw new Error("Test user context unavailable");
    return value;
  });
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
});
afterEach(() => {
  cleanup();
  for (const queryClient of clients.splice(0)) queryClient.clear();
  vi.restoreAllMocks();
});

/** Mount the board with the production profile revision and battle-event handlers. */
// The provider defaults come from the real hook; the board reads this test provider instead.
const useProviderDefaults = userContext.useUserInfo;

const LiveTab = ({ actor }: { actor: boolean }) => {
  const defaults = useProviderDefaults();
  const pusher = usePusherHandler("hunter");
  const queryClient = useQueryClient();
  const profile = testApi.profile.getUser.useQuery();
  return (
    <UserContext.Provider
      value={{
        ...defaults,
        pusher,
        data: profile.data?.userData,
        status: "success",
        prepareUserUpdate: () => prepareUserUpdate(queryClient, key),
        updateUser: (patch, options) =>
          updateUserCache(queryClient, key, patch, options),
      }}
    >
      {actor && <HuntingBoard />}
    </UserContext.Provider>
  );
};

const setup = (
  options: { eventAfterResponse?: boolean; lostResponse?: boolean } = {},
) => {
  const connections: Connection[] = [];
  vi.spyOn(Pusher, "default").mockImplementation((() => {
    const connection: Connection = {
      socket_id: `${connections.length + 1}.1`,
      receive: async () => undefined,
    };
    connections.push(connection);
    return {
      connection,
      subscribe: () => ({
        bind: (_name: string, handler: Connection["receive"]) => {
          connection.receive = handler;
        },
      }),
      unsubscribe: vi.fn(),
      disconnect: vi.fn(),
    };
  }) as never);
  const content = huntingHabitatContent();
  const board = {
    user: { ...snapshot().userData, sector: 1, huntingExperience: 123 },
    session: {
      content,
      id: "session",
      habitatId: "forest",
      contractId: "contract",
      sector: 1,
      readyAt: new Date(0),
      battleId: null,
      version: 1,
    },
    progress: [{ contractId: "contract", used: 0, cooldownUntil: null }],
    serverTime: new Date(),
    habitats: [],
    creatures: [],
    materials: [],
  };
  let authoritative = snapshot();
  let packet: UserEvent;
  const emit = (event: UserEvent) =>
    Promise.all(connections.map((connection) => connection.receive(event)));
  const mutate = vi.fn(async (input: { id: string; originSocketId?: string }) => {
    authoritative = snapshot(true);
    packet = { type: "battle", battleId: "hunt", originSocketId: input.originSocketId };
    if (!options.eventAfterResponse) await emit(packet);
    if (options.lostResponse) throw new Error("Response lost after commit");
    return {
      success: true,
      message: "Hunt started",
      battleId: "hunt",
      userPatch: { status: "BATTLE", battleId: "hunt" },
      userDelta: { pveFights: 1 },
    };
  });
  const reads = [vi.fn(() => authoritative), vi.fn(() => authoritative)];
  const tabs = reads.map((read, index) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    clients.push(queryClient);
    queryClient.setQueryData(key, authoritative);
    const trpcClient = testApi.createClient({
      links: [
        () =>
          ({ op }) =>
            observable((observer) => {
              void Promise.resolve()
                .then(async (): Promise<unknown> => {
                  if (op.path === "profile.getUser") return read();
                  if (op.path === "hunting.getBoard") return board;
                  if (op.path === "hunting.start") return mutate(op.input as never);
                  throw new Error(`Unexpected procedure ${op.path}`);
                })
                .then(
                  (data) => {
                    observer.next({ result: { data } });
                    observer.complete();
                  },
                  (error) => observer.error(error),
                );
            }),
      ],
    });
    return (
      <testApi.Provider key={index} client={trpcClient} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <LiveTab actor={index === 0} />
        </QueryClientProvider>
      </testApi.Provider>
    );
  });
  const view = render(<>{tabs}</>);
  return {
    ...view,
    reads,
    mutate,
    connections,
    emit,
    profile: (index: number) => clients[index]!.getQueryData<Profile>(key)!,
    sendPacket: () => emit(packet),
    click: async () =>
      fireEvent.click(await view.findByRole("button", { name: "Fight creature" })),
  };
};

it.each([false, true])(
  "applies the hunting response without refetching the actor (event after response: %s)",
  async (eventAfterResponse) => {
    const test = setup({ eventAfterResponse });
    await test.click();
    await test.findByText("Hunt started");
    await waitFor(() =>
      expect(test.profile(0).userData).toMatchObject({
        status: "BATTLE",
        battleId: "hunt",
        pveFights: 3,
      }),
    );
    if (eventAfterResponse) await act(() => test.sendPacket());
    expect(test.mutate).toHaveBeenCalledWith({ id: "session", originSocketId: "1.1" });
    expect(test.reads[0]).not.toHaveBeenCalled();
    expect(test.profile(1).userData).toMatchObject({
      status: "BATTLE",
      battleId: "hunt",
    });
    expect(routing.pushToCombat).toHaveBeenCalledWith(expect.anything(), "hunt");
  },
);

it.each([false, true])(
  "recovers known hunting admission without reading the profile (event after failure: %s)",
  async (eventAfterResponse) => {
    const test = setup({ lostResponse: true, eventAfterResponse });
    await test.click();
    await test.findByText("Response lost after commit");
    if (eventAfterResponse) await act(() => test.sendPacket());
    await waitFor(() =>
      expect(test.profile(0).userData).toMatchObject({
        status: "BATTLE",
        battleId: "hunt",
        pveFights: 2,
      }),
    );
    expect(test.reads[0]).not.toHaveBeenCalled();
    expect(test.reads[1]).not.toHaveBeenCalled();
    expect(routing.pushToCombat).toHaveBeenCalledWith(expect.anything(), "hunt");
    await waitFor(() =>
      expect(
        (test.getByRole("button", { name: "Fight creature" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  },
);

it("reads the current socket at submission and accepts events from a prior connection", async () => {
  const test = setup();
  await test.findByRole("button", { name: "Fight creature" });
  test.connections[0]!.socket_id = "3.1";
  await test.click();
  await test.findByText("Hunt started");
  expect(test.mutate).toHaveBeenCalledWith({ id: "session", originSocketId: "3.1" });
  test.connections[0]!.socket_id = "4.1";
  await act(() =>
    test.emit({ type: "battle", battleId: "next-hunt", originSocketId: "3.1" }),
  );
  expect(test.profile(0).userData?.battleId).toBe("next-hunt");
});
