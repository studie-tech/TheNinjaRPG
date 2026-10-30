import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as navigation from "next/navigation";
import * as Pusher from "pusher-js";
import { useContext } from "react";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as ContentBox from "@/layout/ContentBox";
import { EventTournaments } from "@/layout/EventTournaments";
import { type UserEvent, usePusherHandler } from "@/layout/PusherHandler";
import * as toast from "@/libs/toast";
import { createEventState } from "@/libs/tournament/events";
import * as routing from "@/utils/routing";
import * as userContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { eventTournamentConfigSchema } from "@/validators/tournament";
import { ensureDom } from "../setup/dom.mjs";

const testApi = createTRPCReact<AppRouter>();
const { UserContext } = userContext;
const key = getQueryKey(testApi.profile.getUser, undefined, "query");
const clients: QueryClient[] = [];
const router = {
  back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), push: vi.fn(),
  replace: vi.fn(), prefetch: vi.fn(), bfcacheId: "tournament-cache",
};
type Profile = NonNullable<RouterOutputs["profile"]["getUser"]>;
type Action = "JOIN" | "WITHDRAW" | "DECLINE";
type Connection = {
  socket_id?: string;
  receive: (event: UserEvent) => Promise<void>;
};
/** Seed participation and invitation notices independently for event cache assertions. */
const snapshot = (participant: boolean, invitation = false) => ({
  userData: { userId: "player", role: "USER", status: "AWAKE", battleId: null, money: 100 },
  isEventParticipant: participant,
  notifications: [
    { href: "/inbox", name: "Inbox", color: "blue" },
    ...(invitation ? [{ href: "/tournaments/event", name: "Invitation", color: "green" }] : []),
  ],
}) as Profile;

beforeEach(() => {
  ensureDom();
  vi.spyOn(navigation, "useRouter").mockReturnValue(router);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/tournaments/event");
  Object.assign(vi.spyOn(client, "api" as never), {
    tournament: testApi.tournament, profile: testApi.profile, useUtils: testApi.useUtils,
  });
  // Bun retains module mocks across suites; read this fixture's live provider.
  vi.spyOn(userContext, "useUserData").mockImplementation(() => useContext(UserContext));
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  for (const queryClient of clients.splice(0)) queryClient.clear();
  vi.restoreAllMocks();
});

/** Mount one tab with its own profile cache and the production Pusher handler. */
const LiveTab = ({ actor }: { actor: boolean }) => {
  const defaults = useContext(UserContext);
  const pusher = usePusherHandler("player");
  const queryClient = useQueryClient();
  const profile = testApi.profile.getUser.useQuery();
  testApi.tournament.getEventNotices.useQuery();
  return (
    <UserContext.Provider value={{
      ...defaults, pusher, data: profile.data?.userData, status: "success",
      prepareUserUpdate: () => prepareUserUpdate(queryClient, key),
      updateUser: (patch, options) => updateUserCache(queryClient, key, patch, options),
    }}>
      {actor && <EventTournaments tournamentId="event" />}
    </UserContext.Provider>
  );
};

/** Drive actor and observer tabs through production cache and event handlers. */
const setup = (action: Action, options: {
  eventAfterResponse?: boolean;
  lostResponse?: boolean;
  missingPatch?: boolean;
  rejection?: boolean;
} = {}) => {
  const connections: Connection[] = [];
  vi.spyOn(Pusher, "default").mockImplementation(function () {
    const connection: Connection = {
      socket_id: `${connections.length + 1}.1`, receive: async () => undefined,
    };
    connections.push(connection);
    return {
      connection,
      subscribe: () => ({ bind: (_name: string, handler: Connection["receive"]) => { connection.receive = handler; } }),
      unsubscribe: vi.fn(), disconnect: vi.fn(),
    };
  } as never);
  const event = createEventState(eventTournamentConfigSchema.parse({
    name: "Cache Cup", description: "Tournament", registration: "OPEN",
    format: "SINGLE_ELIMINATION", seeding: "RANDOM", rules: "OPEN", scheduling: "SIMULTANEOUS",
    capacity: 8, bestOf: 1, roundBestOf: [], minBracket: 0, maxBracket: 7,
    minPvpWins: 0, minWinRate: 0, minMasteredJutsu: 0,
    registrationClosesAt: Date.now() + 3600_000, endsAt: Date.now() + 7200_000,
    rewards: { winner: {}, runnerUp: {}, semifinalist: {}, participation: {}, perWin: {} },
  }));
  event.status = "REGISTRATION";
  if (action !== "JOIN") event.participants = [{
    id: "seat", userId: "player", username: "Player", invited: true, accepted: action === "WITHDRAW",
    withdrawn: false, seed: 0, previousUsers: [],
    snapshot: { bracket: 0, pvpWins: 0, winRate: 0, masteredJutsu: 0 },
  }];
  let authoritative = snapshot(action !== "JOIN", action === "DECLINE");
  const defaultError = vi.fn();
  const emit = (packet: UserEvent) => Promise.all(connections.map((connection) => connection.receive(packet)));
  let packet: UserEvent | undefined;
  const mutate = vi.fn(async (input: { originSocketId?: string }) => {
    if (options.rejection) return { success: false, message: "Registration closed" };
    authoritative = snapshot(action === "JOIN");
    event.participants = action === "JOIN" ? [{
      id: "seat", userId: "player", username: "Player", invited: false, accepted: true,
      withdrawn: false, seed: 0, previousUsers: [],
      snapshot: { bracket: 0, pvpWins: 0, winRate: 0, masteredJutsu: 0 },
    }] : [];
    packet = { type: "eventTournament", originSocketId: input.originSocketId };
    if (!options.eventAfterResponse) await emit(packet);
    if (options.lostResponse) throw new Error("Response lost after commit");
    return {
      success: true, message: "Updated tournament",
    };
  });
  const reads = [vi.fn(() => authoritative), vi.fn(() => authoritative)];
  const tabs = reads.map((read, index) => {
    const queryClient = new QueryClient({ defaultOptions: {
      queries: { retry: false, staleTime: Infinity }, mutations: { onError: defaultError },
    } });
    clients.push(queryClient);
    queryClient.setQueryData(key, authoritative);
    const trpcClient = testApi.createClient({ links: [() => ({ op }) => observable((observer) => {
      void Promise.resolve().then(async (): Promise<unknown> => {
        if (op.path === "profile.getUser") return read();
        if (op.path === "tournament.getEvent") return { eventData: structuredClone(event), eligibility: [] };
        if (op.path === "tournament.getEventNotices") return [];
        if (op.path === "tournament.participateEvent") return mutate(op.input as never);
        throw new Error(`Unexpected procedure ${op.path}`);
      }).then(
        (data) => { observer.next({ result: { data } }); observer.complete(); },
        (error) => observer.error(error),
      );
    })] });
    return <testApi.Provider key={index} client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}><LiveTab actor={index === 0} /></QueryClientProvider>
    </testApi.Provider>;
  });
  const view = render(<AppRouterContext.Provider value={router}>{tabs}</AppRouterContext.Provider>);
  return {
    ...view, reads, mutate, defaultError, connections, emit,
    profile: (index: number) => clients[index]!.getQueryData<Profile>(key)!,
    setAuthoritative: (next: Profile) => { authoritative = next; },
    sendPacket: () => emit(packet!),
    click: async () => {
      const name = action === "JOIN" ? "Join tournament" : action === "WITHDRAW" ? "Withdraw from tournament" : "Decline invitation";
      fireEvent.click(await view.findByRole("button", { name }));
    },
  };
};

for (const action of ["JOIN", "WITHDRAW", "DECLINE"] as const) {
  it.each([false, true])(`${action} recovers the actor and refreshes another tab (event after response: %s)`, async (eventAfterResponse) => {
    const test = setup(action, { eventAfterResponse });
    await test.click();
    await test.findByText("Updated tournament");
    await waitFor(() => expect(test.profile(0).isEventParticipant).toBe(action === "JOIN"));
    if (eventAfterResponse) await act(() => test.sendPacket());
    await waitFor(() => expect(test.reads[1]).toHaveBeenCalledTimes(1));
    expect(test.mutate).toHaveBeenCalledWith(expect.objectContaining({ originSocketId: "1.1" }));
    expect(test.reads[0]).toHaveBeenCalledTimes(1);
    for (const index of [0, 1]) {
      expect(test.profile(index).isEventParticipant).toBe(action === "JOIN");
      expect(test.profile(index).notifications).toEqual([{ href: "/inbox", name: "Inbox", color: "blue" }]);
      expect(test.profile(index).userData?.money).toBe(100);
    }
  });
}

it("recovers a committed action with a lost response and retains the default error callback", async () => {
  const test = setup("JOIN", { lostResponse: true });
  await test.click();
  await waitFor(() => expect(test.defaultError).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(test.reads[0]).toHaveBeenCalledTimes(1));
  expect(test.reads[1]).toHaveBeenCalledTimes(1);
  expect(test.profile(0).isEventParticipant).toBe(true);
  await waitFor(() => expect((test.getByRole("button", { name: "Withdraw from tournament" }) as HTMLButtonElement).disabled).toBe(false));
});

it.each([{ missingPatch: true }, { rejection: true }])("reconciles incomplete or rejected responses: %j", async (options) => {
  const test = setup("JOIN", options);
  await test.click();
  await waitFor(() => expect(test.reads[0]).toHaveBeenCalledTimes(1));
  expect(test.defaultError).not.toHaveBeenCalled();
});

it("refreshes an idle tab on an invitation without an originating socket", async () => {
  const test = setup("JOIN");
  await test.findByRole("button", { name: "Join tournament" });
  test.setAuthoritative(snapshot(true, true));
  await act(() => test.emit({ type: "eventTournament" }));
  for (const index of [0, 1]) {
    expect(test.reads[index]).toHaveBeenCalledTimes(1);
    expect(test.profile(index).isEventParticipant).toBe(true);
    expect(test.profile(index).notifications).toHaveLength(2);
  }
});

it("reads the connected socket at submission and refreshes events from an earlier connection", async () => {
  const test = setup("JOIN");
  await test.findByRole("button", { name: "Join tournament" });
  test.connections[0]!.socket_id = "3.1";
  await test.click();
  await test.findByText("Updated tournament");
  expect(test.mutate).toHaveBeenCalledWith(expect.objectContaining({ originSocketId: "3.1" }));
  expect(test.reads[0]).toHaveBeenCalledTimes(1);
  test.connections[0]!.socket_id = "4.1";
  await act(() => test.emit({ type: "eventTournament", originSocketId: "3.1" }));
  expect(test.reads[0]).toHaveBeenCalledTimes(2);
});
