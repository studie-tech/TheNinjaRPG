import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type Pusher from "pusher-js";
import type { ReactNode } from "react";
import type { AppRouter } from "@/api/root";
import * as appClient from "@/app/_trpc/client";
import {
  useRankedQueueCount,
  useRankedQueueCountCache,
} from "@/hooks/useRankedQueueCount";

const api = createTRPCReact<AppRouter>();
const clients: QueryClient[] = [];
const actualSetTimeout = globalThis.setTimeout;
beforeEach(() =>
  Object.assign(vi.spyOn(appClient, "api" as never), {
    pvpRank: api.pvpRank,
    useUtils: api.useUtils,
  }),
);
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  globalThis.setTimeout = actualSetTimeout;
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

/** Advance only the event throttle; React/tRPC scheduling retains the real timer implementation. */
const signalClock = () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const timeouts: (() => void)[] = [];
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    const handle = originalTimeout(callback, delay);
    if (delay === 30_000)
      timeouts.push(() => {
        clearTimeout(handle);
        now += delay;
        callback();
      });
    return handle;
  }) as typeof setTimeout;
  return {
    advance: () => {
      const next = timeouts.shift();
      expect(next).toBeDefined();
      next!();
    },
    pending: () => timeouts.length,
  };
};

/** Use the real query cache and tRPC observer; control only the transport and socket delivery. */
const setup = (initial?: number, defer = false) => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  clients.push(client);
  const key = getQueryKey(api.pvpRank.getRankedQueueCount, undefined, "query");
  if (initial !== undefined) client.setQueryData(key, initial);
  let serverCount = initial ?? 0;
  let reads = 0;
  const pending: (() => void)[] = [];
  const trpc = api.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            expect(op.path).toBe("pvpRank.getRankedQueueCount");
            reads++;
            const snapshot = serverCount;
            const complete = () => {
              observer.next({ result: { data: snapshot } });
              observer.complete();
            };
            if (defer) pending.push(complete);
            else complete();
          }),
    ],
  });
  const handlers = new Map<string, Set<() => void>>();
  const channel = {
    bind: vi.fn((event: string, handler: () => void) => {
      const bound = handlers.get(event) ?? new Set();
      bound.add(handler);
      handlers.set(event, bound);
    }),
    unbind: vi.fn((event: string, handler: () => void) => {
      handlers.get(event)?.delete(handler);
    }),
  };
  const socket = { subscribe: vi.fn(() => channel), unsubscribe: vi.fn() };
  const pusher = socket as unknown as Pusher;
  const emit = (event: string) => handlers.get(event)?.forEach((handler) => handler());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <api.Provider client={trpc} queryClient={client}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </api.Provider>
  );
  return {
    client,
    key,
    pusher,
    socket,
    channel,
    emit,
    wrapper,
    pending,
    reads: () => reads,
    setCount: (value: number) => {
      serverCount = value;
    },
  };
};

it("loads a cold count and refreshes for remote joins, concurrent changes and match removals", async () => {
  const clock = signalClock();
  const t = setup();
  const view = renderHook(() => useRankedQueueCount(true, t.pusher), {
    wrapper: t.wrapper,
  });
  await waitFor(() => expect(view.result.current.data).toBe(0));
  t.setCount(2);
  await act(async () => t.emit("updated"));
  await waitFor(() => expect(view.result.current.data).toBe(2));
  // Signals carry no arithmetic: repeated/out-of-order delivery reads the current aggregate.
  t.setCount(1);
  await act(async () => {
    t.emit("updated");
    t.emit("updated");
    clock.advance();
  });
  await waitFor(() => expect(view.result.current.data).toBe(1));
  t.setCount(0);
  await act(async () => {
    t.emit("updated");
    clock.advance();
  });
  await waitFor(() => expect(view.result.current.data).toBe(0));
  expect(t.socket.subscribe).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(t.socket.unsubscribe).toHaveBeenCalledWith("ranked-queue");
  expect(t.channel.unbind).toHaveBeenCalledTimes(2);
});

it("cancels a pre-change cold read before recovering a committed mutation", async () => {
  const t = setup(undefined, true);
  const view = renderHook(
    () => ({
      count: useRankedQueueCount(true, t.pusher),
      cache: useRankedQueueCountCache(),
    }),
    { wrapper: t.wrapper },
  );
  await waitFor(() => expect(t.reads()).toBe(1));
  t.setCount(1);
  let refreshed: Promise<boolean> | undefined;
  await act(async () => {
    refreshed = view.result.current.cache.refreshRankedQueueCount();
  });
  expect(t.reads()).toBe(2);
  await act(async () => {
    t.pending[1]!();
    await refreshed;
  });
  await waitFor(() => expect(view.result.current.count.data).toBe(1));
  await act(async () => t.pending[0]!());
  expect(t.client.getQueryData(t.key)).toBe(1);
});

it("recovers missed events on subscription confirmation and skips signed-out or hidden observers", async () => {
  const t = setup();
  const view = renderHook(({ enabled }) => useRankedQueueCount(enabled, t.pusher), {
    initialProps: { enabled: false },
    wrapper: t.wrapper,
  });
  expect(t.reads()).toBe(0);
  expect(t.socket.subscribe).not.toHaveBeenCalled();
  view.rerender({ enabled: true });
  await waitFor(() => expect(view.result.current.data).toBe(0));
  t.setCount(3);
  await act(async () => t.emit("pusher:subscription_succeeded"));
  await waitFor(() => expect(view.result.current.data).toBe(3));
  view.rerender({ enabled: false });
  const reads = t.reads();
  t.setCount(0);
  await act(async () => t.emit("updated"));
  expect(t.reads()).toBe(reads);
  view.rerender({ enabled: true });
  await waitFor(() => expect(view.result.current.data).toBe(0));
});

it("uses a five-minute foreground recovery interval without a working socket", async () => {
  const intervals: { callback: () => void; delay: number | undefined }[] = [];
  const originalInterval = globalThis.setInterval;
  vi.spyOn(globalThis, "setInterval").mockImplementation(((
    callback: () => void,
    delay?: number,
  ) => {
    intervals.push({ callback, delay });
    return originalInterval(callback, delay);
  }) as typeof setInterval);
  const t = setup();
  const view = renderHook(() => useRankedQueueCount(true, undefined), {
    wrapper: t.wrapper,
  });
  await waitFor(() => expect(view.result.current.data).toBe(0));
  expect(intervals.some((interval) => interval.delay === 30_000)).toBe(false);
  const recovery = [...intervals]
    .reverse()
    .find((interval) => interval.delay === 300_000);
  expect(recovery).toBeDefined();
  t.setCount(4);
  await act(async () => recovery!.callback());
  await waitFor(() => expect(view.result.current.data).toBe(4));
});

it.each([false, true])(
  "bounds event storms with a trailing read while the initial cache is pending=%s",
  async (pending) => {
    const clock = signalClock();
    const t = setup(undefined, pending);
    const view = renderHook(() => useRankedQueueCount(true, t.pusher), {
      wrapper: t.wrapper,
    });
    await waitFor(() => expect(t.reads()).toBe(1));
    t.setCount(2);
    await act(async () => {
      for (let i = 0; i < 100; i++) t.emit("updated");
    });
    expect(t.reads()).toBe(2);
    expect(clock.pending()).toBe(1);
    t.setCount(0);
    await act(async () => {
      for (let i = 0; i < 100; i++) t.emit("updated");
    });
    expect(t.reads()).toBe(2);
    await act(async () => clock.advance());
    expect(t.reads()).toBe(3);
    if (pending) {
      await act(async () => t.pending[2]!());
      await act(async () => {
        t.pending[1]!();
        t.pending[0]!();
      });
    }
    await waitFor(() => expect(view.result.current.data).toBe(0));
    expect(t.client.getQueryData(t.key)).toBe(0);
    expect(clock.pending()).toBe(0);
  },
);

it("recovers missed changes on browser focus and network reconnect", async () => {
  const t = setup();
  const view = renderHook(() => useRankedQueueCount(true, undefined), {
    wrapper: t.wrapper,
  });
  await waitFor(() => expect(view.result.current.data).toBe(0));
  t.setCount(1);
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(view.result.current.data).toBe(1));
  t.setCount(0);
  await act(async () => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await waitFor(() => expect(view.result.current.data).toBe(0));
});

it("keeps local mutation recovery immediate during a remote-event throttle window", async () => {
  const clock = signalClock();
  const t = setup();
  const view = renderHook(
    () => ({
      count: useRankedQueueCount(true, t.pusher),
      cache: useRankedQueueCountCache(),
    }),
    { wrapper: t.wrapper },
  );
  await waitFor(() => expect(view.result.current.count.data).toBe(0));
  t.setCount(1);
  await act(async () => t.emit("updated"));
  await waitFor(() => expect(view.result.current.count.data).toBe(1));
  t.setCount(2);
  await act(async () => t.emit("updated"));
  expect(clock.pending()).toBe(1);
  await act(async () => view.result.current.cache.refreshRankedQueueCount());
  await waitFor(() => expect(view.result.current.count.data).toBe(2));
});
