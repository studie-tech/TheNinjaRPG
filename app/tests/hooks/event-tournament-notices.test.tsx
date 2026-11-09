import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type Pusher from "pusher-js";
import type { PropsWithChildren } from "react";
import * as client from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import { EVENT_TOURNAMENT_READY_SECONDS } from "@/drizzle/constants";
import {
  useEventTournamentNoticeCache,
  useEventTournamentNotices,
} from "@/hooks/useEventTournamentNotices";
import { testApi, TrpcTestProviders } from "../setup/trpc";

type Notices = RouterOutputs["tournament"]["getEventNotices"];
const clients: QueryClient[] = [];
let now = 0;

beforeEach(() => {
  now = Date.UTC(2026, 10, 1, 12);
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  Object.assign(vi.spyOn(client, "api" as never), { tournament: testApi.tournament });
  focusManager.setFocused(true);
});

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((queryClient) => queryClient.clear());
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Flush transport promises and query notifications without advancing server time. */
const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 30; index++) await Promise.resolve();
    vi.advanceTimersByTime(1);
  });
};

/** Move both the local clock and production deadline/recovery timers. */
const advance = async (ms: number) => {
  await act(async () => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
  await settle();
};

/** Observe the production hook through a real tRPC cache with controlled server and socket delivery. */
const setup = (
  initial: Notices = [],
  options: { offset?: number; defer?: boolean; fail?: boolean } = {},
) => {
  let authoritative = initial;
  let fail = options.fail ?? false;
  const pending: (() => void)[] = [];
  const read = vi.fn(() => authoritative);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(queryClient);
  const trpcClient = testApi.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            expect(op.path).toBe("tournament.getEventNotices");
            const snapshot = read();
            const shouldFail = fail;
            const complete = () => {
              if (shouldFail) observer.error(new Error("Notice unavailable") as never);
              else {
                observer.next({ result: { data: snapshot } });
                observer.complete();
              }
            };
            if (options.defer) pending.push(complete);
            else void Promise.resolve().then(complete);
          }),
    ],
  });
  const handlers = new Set<() => void>();
  const channel = {
    bind: vi.fn((_event: string, callback: () => void) => handlers.add(callback)),
    unbind: vi.fn((_event: string, callback: () => void) => handlers.delete(callback)),
  };
  const socket = { channel: vi.fn(() => channel) };
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  const props = {
    enabled: true,
    isPageActive: true,
    timeDiff: options.offset ?? 0,
    pusher: socket as unknown as Pusher | undefined,
    userId: "player" as string | null,
  };
  const view = renderHook(
    (input: typeof props) => ({
      notices: useEventTournamentNotices(input),
      cache: useEventTournamentNoticeCache(),
    }),
    { wrapper, initialProps: props },
  );
  return {
    ...view,
    props,
    pending,
    read,
    queryClient,
    channel,
    key: getQueryKey(testApi.tournament.getEventNotices, undefined, "query"),
    set: (notices: Notices) => {
      authoritative = notices;
    },
    fail: (value: boolean) => {
      fail = value;
    },
    reconnect: () => handlers.forEach((handler) => handler()),
  };
};

/** Construct an actionable notice using the server's fixed ready-check response window. */
const notice = (
  deadline = now + EVENT_TOURNAMENT_READY_SECONDS * 1000,
  message = "Your tournament match is ready",
): Notices => [
  {
    tournamentId: "event",
    name: "Notice Cup",
    message,
    deadline,
  },
];

it("uses one-minute discovery for empty registered-player notices across three hours in independent tabs", async () => {
  const tabs = [setup(), setup()];
  await settle();
  for (let index = 0; index < 180; index++) await advance(60_000);
  tabs.forEach((tab) => {
    expect(tab.read).toHaveBeenCalledTimes(181);
    expect(tab.result.current.notices).toEqual([]);
  });
});

it("discovers a new ready check within one minute and retains 15-second checks while it is visible", async () => {
  const tab = setup();
  await settle();
  for (let index = 0; index < 4; index++) await advance(60_000);
  expect(tab.read).toHaveBeenCalledTimes(5);
  tab.set(notice());
  await advance(60_000);
  expect(tab.result.current.notices[0]?.message).toBe("Your tournament match is ready");
  await advance(15_000);
  expect(tab.read).toHaveBeenCalledTimes(7);
});

it.each(["You have a tournament invitation", "Your tournament match is ready"])(
  "discovers a missed remote notice without a socket: %s",
  async (message) => {
    const tab = setup();
    tab.rerender({ ...tab.props, pusher: undefined });
    await settle();
    // Invitations and substitutions are discovered even when their push was lost.
    const deadline = now + EVENT_TOURNAMENT_READY_SECONDS * 1000;
    tab.set(notice(deadline, message));
    await advance(60_000);
    expect(tab.result.current.notices[0]?.message).toBe(message);
    expect(deadline - now).toBeGreaterThan(0);
    await advance(15_000);
    expect(tab.read).toHaveBeenCalledTimes(3);
  },
);

it("retains one-minute discovery for an invitation with only 90 seconds to respond", async () => {
  const tab = setup();
  await settle();
  tab.set(notice(now + 90_000, "You have a tournament invitation"));
  await advance(60_000);
  expect(tab.result.current.notices).toHaveLength(1);
  expect(tab.result.current.notices[0]!.deadline - now).toBe(30_000);
});

it("returns to one-minute discovery after a response clears the current prompt", async () => {
  const tab = setup(notice());
  await settle();
  tab.set([]);
  await advance(15_000);
  expect(tab.result.current.notices).toEqual([]);
  expect(tab.read).toHaveBeenCalledTimes(2);
  await advance(30_000);
  expect(tab.read).toHaveBeenCalledTimes(2);
  tab.set(notice());
  await advance(30_000);
  expect(tab.read).toHaveBeenCalledTimes(3);
  expect(tab.result.current.notices).toHaveLength(1);
});

it("refreshes after subscription confirmation, browser focus and network reconnect", async () => {
  const tab = setup();
  await settle();
  tab.set(notice());
  await act(async () => tab.reconnect());
  await settle();
  expect(tab.result.current.notices).toHaveLength(1);
  tab.set([]);
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await settle();
  expect(tab.result.current.notices).toEqual([]);
  await act(async () => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(4);
  tab.unmount();
  expect(tab.channel.unbind).toHaveBeenCalledTimes(1);
});

it("pauses hidden and signed-out observers and refreshes on return", async () => {
  const tab = setup();
  await settle();
  tab.rerender({ ...tab.props, isPageActive: false });
  await advance(10 * 60_000);
  expect(tab.read).toHaveBeenCalledTimes(1);
  tab.set(notice());
  tab.rerender(tab.props);
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(2);
  expect(tab.result.current.notices).toHaveLength(1);
  tab.rerender({ ...tab.props, enabled: false, userId: null });
  await advance(10 * 60_000);
  expect(tab.result.current.notices).toEqual([]);
  expect(tab.read).toHaveBeenCalledTimes(2);
});

it.each([-120_000, 120_000])(
  "expires a notice despite a failed boundary refresh with clock offset %s",
  async (offset) => {
    const tab = setup(notice(now - offset + 5000), { offset });
    await settle();
    expect(tab.result.current.notices).toHaveLength(1);
    tab.fail(true);
    await advance(6000);
    expect(tab.result.current.notices).toEqual([]);
    tab.fail(false);
    tab.set([]);
    await advance(15_000);
    expect(tab.read).toHaveBeenCalledTimes(3);
    expect(tab.result.current.notices).toEqual([]);
  },
);

it("rejects an invitation whose deadline passes while the request is in flight", async () => {
  const tab = setup(notice(now + 500, "You have a tournament invitation"), {
    defer: true,
  });
  await settle();
  now += 1000;
  await act(async () => tab.pending[0]!());
  await settle();
  expect(tab.result.current.notices).toEqual([]);
});

it("recovers an initial failure through the bounded discovery interval", async () => {
  const tab = setup([], { fail: true });
  await settle();
  await advance(60_000);
  tab.fail(false);
  tab.set(notice());
  await advance(60_000);
  expect(tab.read).toHaveBeenCalledTimes(3);
  expect(tab.result.current.notices).toHaveLength(1);
});

it("cancels a pre-change cold read before reconciling a committed tournament action", async () => {
  const tab = setup([], { defer: true });
  await settle();
  tab.set(notice());
  let refresh: Promise<boolean> | undefined;
  await act(async () => {
    refresh = tab.result.current.cache.refreshEventTournamentNotices();
  });
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(2);
  await act(async () => {
    tab.pending[1]!();
    await refresh;
  });
  await settle();
  await act(async () => tab.pending[0]!());
  await settle();
  expect(tab.queryClient.getQueryData(tab.key)).toHaveLength(1);
  expect(tab.result.current.notices).toHaveLength(1);
});
