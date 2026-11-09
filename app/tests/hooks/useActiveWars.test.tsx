import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import type { PropsWithChildren } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import { useActiveWars } from "@/hooks/useActiveWars";
import { defaultWarRules } from "@/validators/war";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

type Wars = RouterOutputs["war"]["getActiveWars"];
type Props = {
  villageId: string;
  enabled: boolean;
  polling: "discovery" | "live" | false;
  timeDiff: number;
};
const clients: QueryClient[] = [];
let now = 0;

beforeEach(() => {
  now = Date.UTC(2026, 10, 1, 12);
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  Object.assign(vi.spyOn(client, "api" as never), { war: testApi.war });
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

const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 30; index++) await Promise.resolve();
    vi.advanceTimersByTime(1);
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
  await settle();
};

/** Exercise the production hook through its real tRPC binding and a tab-local QueryClient. */
const setup = (initial: Wars = [], props: Partial<Props> = {}) => {
  let authoritative = initial;
  let shouldFail = false;
  const read = vi.fn((_input: unknown) => {
    if (shouldFail) throw new Error("War data unavailable");
    return authoritative;
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(queryClient);
  const trpcClient = fakeTrpcClient((_path, input) => read(input));
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  const initialProps: Props = {
    villageId: "own",
    enabled: true,
    polling: "discovery",
    timeDiff: 0,
    ...props,
  };
  const view = renderHook(
    ({ villageId, ...options }: Props) => useActiveWars(villageId, options),
    {
      wrapper,
      initialProps,
    },
  );
  return {
    ...view,
    read,
    initialProps,
    set: (wars: Wars) => {
      authoritative = wars;
    },
    fail: (value: boolean) => {
      shouldFail = value;
    },
    invalidate: () =>
      queryClient.invalidateQueries({
        queryKey: getQueryKey(testApi.war.getActiveWars),
      }),
  };
};

/** The query transports the server's masked rows without rebuilding participation on the client. */
const war = (combatStartedAt = now - 3_600_000): Wars[number] =>
  ({
    id: "war",
    status: "ACTIVE",
    endedAt: null,
    combatStartedAt: new Date(combatStartedAt),
    rules: { ...defaultWarRules, durationDays: 1 },
    attackerWarHealth: 10_000,
    defenderWarHealth: 10_000,
    warAllies: [],
    warMercenaries: [],
    mercenaryWarIds: {},
    objectiveState: null,
  }) as unknown as Wars[number];

it("bounds closed discovery to 181 reads per tab over three quiet hours", async () => {
  const tabs = [setup(), setup()];
  await settle();
  for (let index = 0; index < 180; index++) await advance(60_000);
  tabs.forEach((tab) => expect(tab.read).toHaveBeenCalledTimes(181));
});

it("discovers remote participation changes without a notification, including the first war", async () => {
  const tab = setup([], { villageId: "" });
  await settle();
  expect(tab.read).toHaveBeenCalledWith({ villageId: "" });
  tab.set([war()]);
  await advance(59_000);
  expect(tab.result.current.data).toEqual([]);
  await advance(1000);
  expect(tab.result.current.data?.[0]?.id).toBe("war");
  tab.set([]);
  await advance(60_000);
  expect(tab.result.current.data).toEqual([]);
});

it("refreshes immediately on opening, polls live health every 10 seconds and slows on close", async () => {
  const tab = setup([war()]);
  await settle();
  await advance(20_000);
  tab.set([{ ...war(), defenderWarHealth: 9000 }]);
  tab.rerender({ ...tab.initialProps, polling: "live" });
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(2);
  expect(tab.result.current.data?.[0]?.defenderWarHealth).toBe(9000);
  tab.set([{ ...war(), defenderWarHealth: 8000 }]);
  await advance(10_000);
  expect(tab.read).toHaveBeenCalledTimes(3);
  expect(tab.result.current.data?.[0]?.defenderWarHealth).toBe(8000);
  tab.rerender(tab.initialProps);
  await advance(59_000);
  expect(tab.read).toHaveBeenCalledTimes(3);
  await advance(1000);
  expect(tab.read).toHaveBeenCalledTimes(4);
});

it("deduplicates the initial live read and leaves nonpolling overview queries quiet", async () => {
  const live = setup([war()], { polling: "live" });
  const overview = setup([war()], { polling: false });
  await settle();
  expect(live.read).toHaveBeenCalledTimes(1);
  for (let index = 0; index < 6; index++) await advance(10_000);
  expect(live.read).toHaveBeenCalledTimes(7);
  expect(overview.read).toHaveBeenCalledTimes(1);
});

it.each([-120_000, 120_000])(
  "refreshes preparation and duration deadlines with clock offset %s",
  async (timeDiff) => {
    const startsAt = now - timeDiff + 5000;
    const tab = setup([war(startsAt)], { timeDiff });
    await settle();
    await advance(6000);
    expect(tab.read).toHaveBeenCalledTimes(2);
    // Moving combat to its final seconds also moves the duration boundary.
    tab.set([war(now - timeDiff - 86_400_000 + 5000)]);
    await act(async () => {
      await tab.invalidate();
    });
    await settle();
    expect(tab.read).toHaveBeenCalledTimes(3);
    tab.set([]);
    await advance(6000);
    expect(tab.read).toHaveBeenCalledTimes(4);
    expect(tab.result.current.data).toEqual([]);
  },
);

it("retries missed remote changes after a failed discovery request", async () => {
  const tab = setup([war()]);
  await settle();
  tab.fail(true);
  await advance(60_000);
  expect(tab.read).toHaveBeenCalledTimes(2);
  expect(tab.result.current.data?.[0]?.id).toBe("war");
  tab.fail(false);
  tab.set([]);
  await advance(60_000);
  expect(tab.read).toHaveBeenCalledTimes(3);
  expect(tab.result.current.data).toEqual([]);
});

it("skips hidden and offline interval requests and refreshes on focus and reconnect", async () => {
  const tab = setup([war()]);
  await settle();
  await act(async () => {
    focusManager.setFocused(false);
  });
  await advance(120_000);
  expect(tab.read).toHaveBeenCalledTimes(1);
  tab.set([]);
  await act(async () => {
    focusManager.setFocused(true);
  });
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(2);
  expect(tab.result.current.data).toEqual([]);
  await act(async () => {
    onlineManager.setOnline(false);
  });
  await advance(120_000);
  expect(tab.read).toHaveBeenCalledTimes(2);
  tab.set([war()]);
  await act(async () => {
    onlineManager.setOnline(true);
  });
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(3);
  expect(tab.result.current.data?.[0]?.id).toBe("war");
});

it("refreshes a fresh snapshot on focus/reconnect and invalidates immediately after local actions", async () => {
  const tab = setup([war()]);
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
  tab.set([]);
  await act(async () => {
    await tab.invalidate();
  });
  await settle();
  expect(tab.read).toHaveBeenCalledTimes(4);
  expect(tab.result.current.data).toEqual([]);
});

it("changes the exact village key, preserves server masks and stops disabled or unmounted queries", async () => {
  const masked = war();
  const tab = setup([masked]);
  await settle();
  expect(tab.result.current.data).toEqual([masked]);
  tab.set([]);
  tab.rerender({ ...tab.initialProps, villageId: "other" });
  await settle();
  expect(tab.read).toHaveBeenLastCalledWith({ villageId: "other" });
  expect(tab.result.current.data).toEqual([]);
  tab.rerender({
    ...tab.initialProps,
    villageId: "other",
    enabled: false,
    polling: "live",
  });
  await advance(120_000);
  expect(tab.read).toHaveBeenCalledTimes(2);
  tab.unmount();
  await advance(120_000);
  expect(tab.read).toHaveBeenCalledTimes(2);
});
