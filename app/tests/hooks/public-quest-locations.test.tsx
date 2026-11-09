import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { focusManager, onlineManager, QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type { PropsWithChildren } from "react";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import { usePublicQuestLocations } from "@/hooks/usePublicQuestLocations";
import { publicQuestLocations } from "@/libs/mapLocations";
import { MoveToObjective } from "@/validators/objectives";
import { TrpcTestProviders, testApi } from "../setup/trpc";

const clients: QueryClient[] = [];
let now = 0;
beforeEach(() => {
  now = Date.UTC(2026, 10, 2, 12);
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  Object.assign(vi.spyOn(client, "api" as never), { quests: testApi.quests });
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

/** Flush real tRPC/cache notifications while controlling only publication and polling time. */
const settle = async () => {
  await act(async () => {
    for (let index = 0; index < 30; index++) await Promise.resolve();
    vi.advanceTimersByTime(1);
  });
};
/** Advance both the recovery/deadline timers and the simulated server clock. */
const advance = async (ms: number) => {
  await act(async () => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
  await settle();
};

/** Exercise the feature hook against the same public projection used by the server. */
const setup = (offset = 0, deferred = false, initialOffset = offset) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(queryClient);
  let name = "Landmark";
  let fail = false;
  const pending: (() => void)[] = [];
  const revisions: number[] = [];
  const read = vi.fn(() =>
    publicQuestLocations(
      [
        {
          id: "ending",
          hidden: false,
          startsAt: null,
          endsAt: "2026-11-03",
          content: {
            objectives: [
              MoveToObjective.parse({
                id: "ending",
                task: "move_to_location",
                structureAssetId: "tower",
                locationName: name,
                sectorType: "specific",
                sector: 1,
                locationType: "specific",
                longitude: 4,
                latitude: 5,
              }),
            ],
          },
        },
        {
          id: "starting",
          hidden: false,
          startsAt: "2026-11-03",
          endsAt: null,
          content: {
            objectives: [
              MoveToObjective.parse({
                id: "starting",
                task: "move_to_location",
                structureAssetId: "tower",
                locationName: name,
                sectorType: "specific",
                sector: 1,
                locationType: "specific",
                longitude: 6,
                latitude: 7,
              }),
            ],
          },
        },
      ],
      new Date(now - offset),
    ),
  );
  const trpc = testApi.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            revisions.push((op.input as { revision: number }).revision);
            const snapshot = read();
            const complete = () => {
              observer.next({ result: { data: snapshot } });
              observer.complete();
            };
            if (fail)
              observer.error(
                TRPCClientError.from<AppRouter>(new Error("Landmarks unavailable")),
              );
            else if (deferred) pending.push(complete);
            else void Promise.resolve().then(complete);
          }),
    ],
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpc} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  const view = renderHook(({ timeDiff }) => usePublicQuestLocations(timeDiff), {
    wrapper,
    initialProps: { timeDiff: initialOffset },
  });
  return {
    view,
    wrapper,
    queryClient,
    read,
    revisions,
    pending,
    setName: (value: string) => {
      name = value;
    },
    fail: (value: boolean) => {
      fail = value;
    },
  };
};

it("uses37 reads across three quiet hours in each independent map tab", async () => {
  const tabs = [setup(), setup()];
  await settle();
  for (let index = 0; index < 36; index++) await advance(5 * 60_000);
  tabs.forEach((tab) => {
    expect(tab.read).toHaveBeenCalledTimes(37);
    expect(tab.view.result.current.data?.[0]?.questId).toBe("ending");
  });
});

it("resumes five-minute polling after the UTC publication recovery window", async () => {
  now = Date.UTC(2026, 10, 3);
  const t = setup();
  await settle();
  for (let index = 0; index < 30; index++) await advance(10_000);
  expect(t.read).toHaveBeenCalledTimes(31);
  await advance(10_000);
  expect(t.read).toHaveBeenCalledTimes(31);
  await advance(290_000);
  expect(t.read).toHaveBeenCalledTimes(32);
});

it.each([-120_000, 0, 120_000])(
  "publishes and expires scenery at UTC midnight with clock offset %s",
  async (offset) => {
    now = Date.UTC(2026, 10, 2, 23, 59, 58) + offset;
    const t = setup(offset);
    await settle();
    expect(t.view.result.current.data?.map((row) => row.questId)).toEqual(["ending"]);
    await advance(3_001);
    expect(t.view.result.current.data?.map((row) => row.questId)).toEqual(["starting"]);
    expect(t.read).toHaveBeenCalledTimes(2);
    expect(t.revisions.at(-1)).toBe(Date.UTC(2026, 10, 3));
  },
);

it("refreshes at a day change even when a render precedes the deadline's one-second grace", async () => {
  now = Date.UTC(2026, 10, 2, 23, 59, 59);
  const t = setup();
  await settle();
  await act(async () => {
    now += 1_100;
    t.view.rerender({ timeDiff: 0 });
  });
  await settle();
  expect(t.view.result.current.data?.[0]?.questId).toBe("starting");
  expect(t.read).toHaveBeenCalledTimes(2);
});

it.each([false, true])(
  "publishes at midnight despite a future content revision, early render %s",
  async (earlyRender) => {
    now = Date.UTC(2026, 10, 2, 23, 59, 59, 500);
    const t = setup();
    await settle();
    const revision = now + 1000;
    await act(async () => t.view.result.current.updatePublicLocations(revision));
    await settle();
    expect(t.view.result.current.data?.[0]?.questId).toBe("ending");
    expect(t.read).toHaveBeenCalledTimes(2);
    if (earlyRender) {
      await act(async () => {
        now += 600;
        t.view.rerender({ timeDiff: 0 });
      });
      await settle();
    } else await advance(1_501);
    expect(t.view.result.current.data?.map((row) => row.questId)).toEqual(["starting"]);
    expect(t.read).toHaveBeenCalledTimes(3);
    expect(t.revisions.at(-1)).toBe(revision);
  },
);

it("keeps midnight publication independent of a recovered revision after clock correction", async () => {
  const offset = 120_000;
  now = Date.UTC(2026, 10, 2, 23, 59) + offset;
  const t = setup(offset, false, 0);
  await settle();
  await act(async () => t.view.result.current.recoverPublicLocations());
  await settle();
  const revision = t.revisions.at(-1);
  await act(async () => t.view.rerender({ timeDiff: offset }));
  await settle();
  expect(t.view.result.current.data?.[0]?.questId).toBe("ending");
  await advance(61_001);
  expect(t.view.result.current.data?.map((row) => row.questId)).toEqual(["starting"]);
  expect(t.revisions.at(-1)).toBe(revision);
});

it("replaces pending pre-midnight reads after a calibrated clock correction", async () => {
  const offset = 120_000;
  now = Date.UTC(2026, 10, 2, 23, 59, 59, 500) + offset;
  // Worker skew can put an already-calibrated client into the next day's cache early.
  const t = setup(offset, true, offset - 1000);
  await settle();
  await act(async () => t.view.result.current.recoverPublicLocations());
  await settle();
  await act(async () => t.view.rerender({ timeDiff: offset }));
  await settle();
  await act(async () => t.pending[2]!());
  await settle();
  expect(t.view.result.current.data?.[0]?.questId).toBe("ending");
  expect(t.read).toHaveBeenCalledTimes(3);
  await advance(1_501);
  expect(t.read).toHaveBeenCalledTimes(4);
  await act(async () => t.pending[3]!());
  await settle();
  expect(t.view.result.current.data?.map((row) => row.questId)).toEqual(["starting"]);
  await act(async () => {
    t.pending[1]!();
    t.pending[0]!();
  });
  await settle();
  expect(t.view.result.current.data?.map((row) => row.questId)).toEqual(["starting"]);
});

it.each([false, true])(
  "recovers a pre-midnight snapshot received after publication, correcting clock %s",
  async (correctClock) => {
    const offset = 120_000;
    now = Date.UTC(2026, 10, 2, 23, 59, 59, 500) + offset;
    const t = setup(offset, true, offset - 1000);
    await settle();
    await act(async () => t.view.result.current.recoverPublicLocations());
    await settle();
    // The next-day key already exists; receipt time alone cannot date the server's projection.
    await act(async () => {
      now += 700;
      t.pending[1]!();
    });
    await settle();
    expect(t.view.result.current.data?.[0]?.questId).toBe("ending");
    if (correctClock) {
      await act(async () => t.view.rerender({ timeDiff: offset }));
      await settle();
    }
    await advance(10_000);
    expect(t.read).toHaveBeenCalledTimes(3);
    await act(async () => t.pending[2]!());
    await settle();
    expect(t.view.result.current.data?.map((row) => row.questId)).toEqual(["starting"]);
  },
);

it("does not reuse a fresh preceding-day cache after navigation across midnight", async () => {
  now = Date.UTC(2026, 10, 2, 23, 59, 58);
  const t = setup();
  await settle();
  t.view.unmount();
  await advance(3_000);
  const next = renderHook(() => usePublicQuestLocations(0), { wrapper: t.wrapper });
  await settle();
  expect(next.result.current.data?.[0]?.questId).toBe("starting");
  expect(t.read).toHaveBeenCalledTimes(2);
});

it("carries newer edit revisions and stable callbacks without another channel subscription", async () => {
  const t = setup();
  await settle();
  const { updatePublicLocations, recoverPublicLocations } = t.view.result.current;
  t.setName("Edited");
  await act(async () => updatePublicLocations(now));
  await settle();
  expect(t.view.result.current.data?.[0]?.name).toBe("Edited");
  expect(t.view.result.current.updatePublicLocations).toBe(updatePublicLocations);
  expect(t.view.result.current.recoverPublicLocations).toBe(recoverPublicLocations);
  await act(async () => updatePublicLocations(now - 1));
  await settle();
  expect(t.read).toHaveBeenCalledTimes(2);
});

it("rejects an older in-flight reply after subscription recovery", async () => {
  const t = setup(0, true);
  await settle();
  t.setName("Recovered");
  await act(async () => t.view.result.current.recoverPublicLocations());
  await settle();
  expect(t.read).toHaveBeenCalledTimes(2);
  await act(async () => {
    t.pending[1]!();
    t.pending[0]!();
  });
  await settle();
  expect(t.view.result.current.data?.[0]?.name).toBe("Recovered");
});

it("recovers same-revision pending reads rather than allowing a pre-event snapshot to win", async () => {
  now = Date.UTC(2026, 10, 2);
  const t = setup(0, true);
  await settle();
  t.setName("Canonical");
  await act(async () => t.view.result.current.recoverPublicLocations());
  await settle();
  expect(t.read).toHaveBeenCalledTimes(2);
  await act(async () => {
    t.pending[1]!();
    t.pending[0]!();
  });
  await settle();
  expect(t.view.result.current.data?.[0]?.name).toBe("Canonical");
});

it("retains ten-second error recovery and immediate focus/network recovery", async () => {
  const t = setup();
  await settle();
  t.fail(true);
  await advance(5 * 60_000);
  const key = getQueryKey(
    testApi.quests.getPublicLocations,
    { revision: t.revisions.at(-1)!, refreshKey: Date.UTC(2026, 10, 2) },
    "query",
  );
  expect(t.queryClient.getQueryState(key)?.status).toBe("error");
  t.fail(false);
  t.setName("Recovered");
  await advance(10_000);
  expect(t.view.result.current.data?.[0]?.name).toBe("Recovered");
  t.setName("Focused");
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await settle();
  expect(t.view.result.current.data?.[0]?.name).toBe("Focused");
  t.setName("Online");
  await act(async () => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await settle();
  expect(t.view.result.current.data?.[0]?.name).toBe("Online");
});
