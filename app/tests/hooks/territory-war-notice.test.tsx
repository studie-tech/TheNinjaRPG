import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import * as client from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import { useTerritoryWarNotice } from "@/hooks/useTerritoryWarNotice";
import { fakeTrpcClient, testApi, TrpcTestProviders } from "../setup/trpc";

type Notice = RouterOutputs["territoryWar"]["getNotice"];
const clients: QueryClient[] = [];
let now = 0;

beforeEach(() => {
  now = Date.UTC(2026, 10, 1, 12);
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  Object.assign(vi.spyOn(client, "api" as never), {
    territoryWar: testApi.territoryWar,
  });
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

/** Flush transport promises and query notifications without advancing the server clock. */
const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 30; index++) await Promise.resolve();
    vi.advanceTimersByTime(1);
  });
};

/** Advance both the client clock and the existing deadline/poll timers. */
const advance = async (ms: number) => {
  await act(async () => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
  await settle();
};

/** Mount the production notice hook with an independent tab cache and real tRPC query binding. */
const setup = (initial: Notice, timeDiff = 0) => {
  let authoritative = initial;
  let fail = false;
  const read = vi.fn(() => {
    if (fail) throw new Error("Notice unavailable");
    return authoritative;
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(queryClient);
  const trpcClient = fakeTrpcClient(() => read());
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  const view = renderHook(
    ({ enabled, active, offset }) => useTerritoryWarNotice(enabled, offset, active),
    {
      wrapper,
      initialProps: { enabled: true, active: true, offset: timeDiff },
    },
  );
  return {
    ...view,
    read,
    set: (notice: Notice) => {
      authoritative = notice;
    },
    fail: (value: boolean) => {
      fail = value;
    },
  };
};

/** A complete event snapshot makes query structural sharing and deadline dates realistic. */
const event = (
  endsAt: number,
  startsAt = now - 1000,
): NonNullable<Notice["event"]> => ({
  id: "event",
  predecessorId: "previous",
  sector: 100,
  guardianId: "guardian",
  version: 0,
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
  resolvedAt: null,
});

it("makes one cold-cache request across three quiet hours in independent tabs", async () => {
  const snapshot = { event: null, nextStartsAt: new Date(now + 5 * 3_600_000) };
  const tabs = [setup(snapshot), setup(snapshot)];
  await settle();
  await advance(3 * 3_600_000);
  tabs.forEach((tab) => {
    expect(tab.read).toHaveBeenCalledTimes(1);
    expect(tab.result.current).toBeNull();
  });
});

it("keeps active-event checks and skips interval requests throughout the five-hour quiet window", async () => {
  const endsAt = now + 3_600_000;
  const tab = setup({ event: event(endsAt), nextStartsAt: null });
  await settle();
  for (let index = 0; index < 119; index++) await advance(30_000);
  expect(tab.read).toHaveBeenCalledTimes(120);
  tab.set({ event: null, nextStartsAt: new Date(endsAt + 5 * 3_600_000) });
  await advance(30_000);
  expect(tab.result.current).toBeNull();
  await advance(5 * 3_600_000 - 1000);
  expect(tab.read).toHaveBeenCalledTimes(121);
});

it("discovers a delayed opening with 30-second retries after its known deadline", async () => {
  const tab = setup({ event: null, nextStartsAt: new Date(now + 60_000) });
  await settle();
  await advance(60_000);
  expect(tab.read).toHaveBeenCalledTimes(1);
  await advance(1000);
  expect(tab.read).toHaveBeenCalledTimes(2);
  tab.set({ event: event(now + 60_000), nextStartsAt: null });
  await advance(30_000);
  expect(tab.read).toHaveBeenCalledTimes(3);
  expect(tab.result.current?.sector).toBe(100);
});

it("retries a failed boundary refresh and keeps discovering before the first event", async () => {
  const tab = setup({ event: null, nextStartsAt: new Date(now + 1000) });
  await settle();
  tab.fail(true);
  await advance(2000);
  expect(tab.read).toHaveBeenCalledTimes(2);
  tab.fail(false);
  tab.set({ event: null, nextStartsAt: null });
  await advance(30_000);
  expect(tab.read).toHaveBeenCalledTimes(3);
  tab.set({ event: event(now + 60_000), nextStartsAt: null });
  await advance(30_000);
  expect(tab.result.current?.id).toBe("event");
});

it.each([-120_000, 120_000])(
  "expires notices against server time with client offset %s",
  async (offset) => {
    const tab = setup(
      { event: event(now - offset + 5000), nextStartsAt: null },
      offset,
    );
    await settle();
    expect(tab.result.current?.id).toBe("event");
    // Even a stale response cannot extend an expired notice's visible lifetime.
    await advance(6000);
    expect(tab.result.current).toBeNull();
  },
);

it("hides a notice that expires while its response is in flight", async () => {
  const tab = setup({ event: event(now + 500), nextStartsAt: null });
  now += 1000;
  await settle();
  expect(tab.result.current).toBeNull();
});

it("refreshes quiet-window snapshots on focus, reconnect and return from a hidden page", async () => {
  const tab = setup({ event: null, nextStartsAt: new Date(now + 60_000) });
  await settle();
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(2);
  await act(async () => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(3);
  tab.rerender({ enabled: true, active: false, offset: 0 });
  await advance(120_000);
  expect(tab.read).toHaveBeenCalledTimes(3);
  tab.set({ event: event(now + 60_000), nextStartsAt: null });
  tab.rerender({ enabled: true, active: true, offset: 0 });
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(4);
  expect(tab.result.current?.id).toBe("event");
  tab.rerender({ enabled: false, active: true, offset: 0 });
  await advance(60_000);
  expect(tab.result.current).toBeNull();
  expect(tab.read).toHaveBeenCalledTimes(4);
});
