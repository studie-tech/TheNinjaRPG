import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { PropsWithChildren } from "react";
import type { AppRouter } from "@/api/root";
import * as appClient from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import { useDungeonAvailability } from "@/hooks/useDungeonAvailability";
import { dungeonContent } from "../setup/dungeon";

type Available = RouterOutputs["coop"]["dungeon"]["getAvailable"];
const api = createTRPCReact<AppRouter>();
const clients: QueryClient[] = [];
let now = 0;
beforeEach(() => {
  now = Date.UTC(2026, 10, 1, 12);
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  Object.assign(vi.spyOn(appClient, "api" as never), { coop: api.coop });
  focusManager.setFocused(true);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Flush the real tRPC transport and observer notifications without advancing deadlines. */
const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 30; index++) await Promise.resolve();
    vi.advanceTimersByTime(1);
  });
};
/** Advance observer intervals, signal throttles and server-adjusted expiration deadlines together. */
const advance = async (ms: number) => {
  await act(async () => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
  await settle();
};
/** Validated definitions include personal admission even though map entrances use only content. */
const entrance = (sector = 1, expiresAt: number | null = null): Available[number] => ({
  id: `definition-${sector}`,
  updatedAt: new Date(now),
  content: {
    ...dungeonContent(),
    sector,
    expiresAt: expiresAt === null ? null : new Date(expiresAt),
  },
  admission: {
    requirements: dungeonContent().requirements,
    attempts: [],
    completions: [],
    error: null,
  },
});
/** Keep actual input-specific tRPC keys and query lifecycles while controlling transport snapshots. */
const setup = (
  initial: Available = [],
  { defer = false, admission = false, offset = 0 } = {},
) => {
  let authoritative = initial;
  let fail = false;
  const pending: (() => void)[] = [];
  const read = vi.fn((_sector: number) => {
    if (fail) throw new Error("Entrances unavailable");
    return authoritative;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const trpc = api.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            expect(op.path).toBe("coop.dungeon.getAvailable");
            try {
              const data = read((op.input as { sector: number }).sector);
              const complete = () => {
                observer.next({ result: { data } });
                observer.complete();
              };
              if (defer) pending.push(complete);
              else void Promise.resolve().then(complete);
            } catch (error) {
              observer.error(TRPCClientError.from(error as Error));
            }
          }),
    ],
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <api.Provider client={trpc} queryClient={client}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </api.Provider>
  );
  const view = renderHook(
    ({ sector, enabled }) => useDungeonAvailability(sector, enabled, offset, admission),
    {
      wrapper,
      initialProps: { sector: 1, enabled: true },
    },
  );
  return {
    ...view,
    client,
    read,
    pending,
    set: (value: Available) => {
      authoritative = value;
    },
    fail: (value: boolean) => {
      fail = value;
    },
    key: (sector: number) =>
      getQueryKey(api.coop.dungeon.getAvailable, { sector }, "query"),
  };
};

it("uses 37 reads per tab over three quiet hours and recovers a missed publication without a socket", async () => {
  const tabs = [setup(), setup()];
  await settle();
  for (let interval = 0; interval < 36; interval++) await advance(300_000);
  for (const tab of tabs) expect(tab.read).toHaveBeenCalledTimes(37);
  tabs[0]!.set([entrance()]);
  await advance(300_000);
  expect(tabs[0]!.result.current.data?.[0]?.id).toBe("definition-1");
});

it("reconciles published and hidden definitions while bounding sustained signals to the ten-second baseline", async () => {
  const tab = setup();
  await settle();
  tab.set([entrance()]);
  await act(async () => {
    for (let signal = 0; signal < 100; signal++) tab.result.current.onContentUpdated();
  });
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(2);
  expect(tab.result.current.data).toHaveLength(1);
  tab.set([]);
  for (let second = 0; second < 10; second++) {
    await act(async () => tab.result.current.onContentUpdated());
    await advance(1000);
  }
  expect(tab.read).toHaveBeenCalledTimes(3);
  expect(tab.result.current.data).toEqual([]);
  await advance(10_000);
  expect(tab.read).toHaveBeenCalledTimes(3);
});

it("cancels an in-flight cold snapshot when publication arrives", async () => {
  const tab = setup([], { defer: true });
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(1);
  tab.set([entrance()]);
  await act(async () => tab.result.current.onContentUpdated());
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(2);
  await act(async () => {
    tab.pending[1]!();
    tab.pending[0]!();
  });
  await settle();
  expect(tab.result.current.data).toHaveLength(1);
  expect(tab.client.getQueryData(tab.key(1))).toHaveLength(1);
});

it("captures the action's sector and cancels pending signals when inputs switch", async () => {
  const tab = setup([entrance()]);
  await settle();
  const snapshot = tab.result.current.prepareAvailabilityUpdate();
  await act(async () => {
    tab.result.current.onContentUpdated();
    tab.result.current.onContentUpdated();
  });
  await settle();
  tab.set([entrance(2)]);
  tab.rerender({ sector: 2, enabled: true });
  await settle();
  expect(tab.result.current.data?.[0]?.content.sector).toBe(2);
  const reads = tab.read.mock.calls.length;
  await act(async () => tab.result.current.refreshAvailability(snapshot));
  expect(tab.read).toHaveBeenCalledTimes(reads);
  expect(tab.client.getQueryState(tab.key(1))?.isInvalidated).toBe(true);
  expect(tab.client.getQueryState(tab.key(2))?.isInvalidated).toBe(false);
  await advance(10_000);
  expect(tab.read).toHaveBeenCalledTimes(reads);
  tab.rerender({ sector: 1, enabled: true });
  await settle();
  expect(tab.read.mock.calls.at(-1)).toEqual([1]);
  expect(tab.result.current.data).toEqual([]);
});

it.each([-120_000, 120_000])(
  "expires cached entrances locally with server clock offset %s despite stale data",
  async (offset) => {
    const tab = setup([entrance(1, now - offset + 5000)], { offset });
    await settle();
    expect(tab.result.current.data).toHaveLength(1);
    await advance(6000);
    expect(tab.result.current.data).toEqual([]);
    expect(tab.read).toHaveBeenCalledTimes(1);
  },
);

it("rejects an entrance that expires while its response is pending", async () => {
  const tab = setup([entrance(1, now + 500)], { defer: true });
  await settle();
  await advance(1000);
  await act(async () => tab.pending[0]!());
  await settle();
  expect(tab.result.current.data).toEqual([]);
});

it("recovers failed lookups every ten seconds and restores the slower interval after success", async () => {
  const tab = setup();
  await settle();
  tab.fail(true);
  await act(async () => tab.result.current.onContentUpdated());
  await settle();
  expect(tab.result.current.isError).toBe(true);
  tab.fail(false);
  tab.set([entrance()]);
  await advance(10_000);
  expect(tab.result.current.isError).toBe(false);
  expect(tab.result.current.data).toHaveLength(1);
  const reads = tab.read.mock.calls.length;
  await advance(10_000);
  expect(tab.read).toHaveBeenCalledTimes(reads);
});

it("recovers missed updates on subscription, focus and network reconnect", async () => {
  const tab = setup();
  await settle();
  tab.set([entrance()]);
  await act(async () => tab.result.current.onContentSubscribed());
  await settle();
  expect(tab.result.current.data).toHaveLength(1);
  tab.set([]);
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await settle();
  expect(tab.result.current.data).toEqual([]);
  await act(async () => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(4);
});

it("keeps personal admission fresh on the entry screen and disables all input-specific work when ineligible", async () => {
  const tab = setup([entrance()], { admission: true });
  await settle();
  const denied = entrance();
  denied.admission.error = "A required quest has not been completed.";
  tab.set([denied]);
  await advance(10_000);
  expect(tab.result.current.data?.[0]?.admission.error).toBe(denied.admission.error);
  tab.rerender({ sector: 1, enabled: false });
  await act(async () => {
    tab.result.current.onContentUpdated();
    tab.result.current.onContentSubscribed();
  });
  await advance(300_000);
  expect(tab.read).toHaveBeenCalledTimes(2);
  expect(tab.result.current.data).toBeUndefined();
});
