import * as clerk from "@clerk/nextjs";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import * as trpc from "@trpc/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { type ContextType, type ReactNode, useContext } from "react";
import * as client from "@/app/_trpc/client";
import Countdown from "@/layout/Countdown";
import * as pusher from "@/layout/PusherHandler";
import { UserContextProvider, useUserDataRef, selectUserWithoutPosition, useUserData, useUserInfo, useUserDataSelector } from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { shareUserCache } from "@/utils/userCacheSharing";

const BASE = Date.UTC(2026, 9, 26, 12);
const key: ReturnType<typeof trpc.getQueryKey> = [
  ["profile", "getUser"],
  { type: "query" },
];
let now = BASE;
const snapshot = (serverTime = BASE - 100) => ({
  serverTime,
  userData: {
    userId: "sharing-test",
    username: "Sharing",
    status: "AWAKE",
    updatedAt: new Date(BASE - 60_000),
    regenAt: new Date(BASE - 30_000),
    money: 100,
    village: { id: "village", createdAt: new Date(BASE - 86_400_000) },
    userQuests: [{ id: "quest", endAt: new Date(BASE + 60_000) }],
  },
  achievementProgress: [{ id: "achievement", updatedAt: new Date(BASE - 1000) }],
  notifications: [{ href: "/shrine", name: "Active boost", color: "green" }],
});
type Snapshot = ReturnType<typeof snapshot>;
const clients: QueryClient[] = [];

beforeEach(() => {
  now = BASE;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(trpc, "getQueryKey").mockReturnValue(key);
  vi.spyOn(clerk, "useUser").mockReturnValue({
    isSignedIn: true,
    isLoaded: true,
    user: { id: "sharing-test" },
  } as never);
  vi.spyOn(pusher, "usePusherHandler").mockReturnValue(undefined);
});

afterEach(() => {
  cleanup();
  for (const queryClient of clients.splice(0)) queryClient.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const mount = (initial = snapshot(), children: ReactNode = null, observeFull = true) => {
  let providerRenders = 0;
  let response = initial;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryDefaults(key, { structuralSharing: shareUserCache });
  clients.push(queryClient);
  queryClient.setQueryData(key, initial);
  const utils = {};
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => utils,
    profile: {
      getUser: {
        // Exercise the provider's query options with a real TanStack cache and observer.
        useQuery: (_input: undefined, options: UseQueryOptions<Snapshot>) => {
          if (options.enabled !== false) providerRenders++;
          // Compiled consumers can enumerate metadata while memoizing a query result.
          return { ...useQuery({ ...options, queryKey: key, queryFn: async () => response }) };
        },
      },
    },
  });
  const seen: ReturnType<typeof useUserData>[] = [];
  const Consumer = () => {
    seen.push(useUserDataSelector((user) => user));
    return children;
  };
  render(
    <QueryClientProvider client={queryClient}>
      <UserContextProvider initialIsSignedIn>
        {observeFull ? <Consumer /> : children}
      </UserContextProvider>
    </QueryClientProvider>,
  );
  const settle = async (action: () => Promise<unknown>) => {
    await act(async () => {
      await action();
      // TanStack batches observer notifications through a scheduled task.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return {
    queryClient,
    providerRenders: () => providerRenders,
    seen,
    current: () => seen.at(-1)!,
    read: () => queryClient.getQueryData<Snapshot>(key)!,
    refresh: async (next: Snapshot) => {
      response = next;
      await settle(() => queryClient.refetchQueries({ queryKey: key }));
    },
    settle,
  };
};

describe("profile context structural sharing", () => {
  it("keeps session services and selected UI idle while imperative position readers stay current", async () => {
    let renders = 0;
    let latest: ReturnType<typeof useUserDataRef> | undefined;
    const changed = vi.fn();
    const Scene = () => {
      useUserDataSelector(selectUserWithoutPosition);
      latest = useUserDataRef(changed);
      renders++;
      return null;
    };
    const test = mount(snapshot(), <Scene />, false);
    const initialRenders = renders, providerRenders = test.providerRenders();
    for (const longitude of [8, 9, 10]) {
      await test.settle(() => updateUserCache(test.queryClient, key, { longitude, latitude: 9, location: "Village", updatedAt: new Date(BASE + longitude) }));
      expect(latest?.current?.longitude).toBe(longitude);
    }
    expect(renders).toBe(initialRenders);
    expect(test.providerRenders()).toBe(providerRenders);
    expect(changed).toHaveBeenCalledTimes(3);
    await test.settle(() => updateUserCache(test.queryClient, key, { status: "BATTLE", battleId: "fight" }));
    expect(latest?.current?.status).toBe("BATTLE");
    expect(renders).toBeGreaterThan(initialRenders);
    await test.settle(async () => { test.queryClient.setQueryData(key, { ...test.read(), userData: undefined }); });
    expect(latest?.current).toBeUndefined();
  });

  it("keeps selected UI stable during movement and publishes relevant changes and profile removal", async () => {
    const seen: unknown[] = [];
    const SelectedProfile = () => {
      const { data } = useUserDataSelector((user) => ({ username: user.username }));
      seen.push(data);
      return null;
    };
    const test = mount(snapshot(), <SelectedProfile />);
    const selected = seen.at(-1), renders = seen.length;
    await test.settle(() => updateUserCache(test.queryClient, key, { longitude: 8, latitude: 9, updatedAt: new Date(BASE) }));
    expect(seen).toHaveLength(renders);
    expect(seen.at(-1)).toBe(selected);
    expect(test.current().data?.longitude).toBe(8);
    await test.settle(() => updateUserCache(test.queryClient, key, { username: "Renamed" }));
    expect(seen.at(-1)).toEqual({ username: "Renamed" });
    await test.settle(async () => { test.queryClient.setQueryData(key, { ...test.read(), userData: undefined }); });
    expect(seen.at(-1)).toBeUndefined();
  });
  it.each([100, 800, -800, 0])("does not fan out unchanged refetches after a first %i ms calibration", async (offset) => {
    const test = mount(snapshot(BASE - offset));
    const before = test.current();
    const renders = test.seen.length;
    for (const jitter of [25, 150, -50]) {
      now += 300_000;
      await test.refresh(snapshot(now - offset - jitter));
      expect(test.current()).toBe(before);
      expect<unknown>(test.read().userData).toBe(before.data);
      expect<unknown>(test.read().achievementProgress).toBe(before.achievementProgress);
    }
    expect(test.seen.length - renders).toBe(0);
    expect(test.current().timeDiff).toBe(offset);
  });

  it.each([800, -800])("calibrates an initial %i ms offset before a server countdown completes", (offset) => {
    vi.useFakeTimers();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const finishesAt = BASE + 3000 - offset;
    // Eligibility uses the server's clock, as quests.getPetTask does on refetch.
    const onFinish = vi.fn(() => finishesAt <= now - offset);
    const ServerCountdown = () => {
      const { timeDiff } = useUserInfo();
      return <Countdown targetDate={new Date(finishesAt)} timeDiff={timeDiff} onFinish={onFinish} />;
    };
    mount(snapshot(BASE - offset), <ServerCountdown />);

    act(() => {
      now += 2500;
      vi.advanceTimersByTime(2500);
    });
    expect(onFinish).not.toHaveBeenCalled();
    act(() => {
      now += 500;
      vi.advanceTimersByTime(500);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveReturnedWith(true);
    act(() => {
      now += 5000;
      vi.advanceTimersByTime(5000);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("keeps server timestamps immutable across repeated responses and clock corrections", async () => {
    const initial = snapshot(BASE - 5000);
    Object.freeze(initial.userData);
    const test = mount(initial);
    expect(test.current().timeDiff).toBe(5000);
    expect(test.read().userData.updatedAt.getTime()).toBe(BASE - 60_000);
    now += 300_000;
    await test.refresh(snapshot(now - 5200));
    expect(test.current().timeDiff).toBe(5000);
    now += 300_000;
    await test.refresh(snapshot(now - 6000));
    expect(test.current().timeDiff).toBe(6000);
    now += 300_000;
    await test.refresh(snapshot(now + 2000));
    expect(test.current().timeDiff).toBe(-2000);
    expect(test.read().userData.updatedAt.getTime()).toBe(BASE - 60_000);
  });

  it("keeps sharing when an imperative fetch replaces the mounted observer's options", async () => {
    const test = mount();
    const before = test.current();
    await test.settle(() =>
      test.queryClient.fetchQuery({
        queryKey: key,
        staleTime: 0,
        queryFn: async () => snapshot(BASE - 50),
      }),
    );
    expect(test.current()).toBe(before);
  });

  it("propagates changed nested Dates, achievements and expired notifications independently", async () => {
    const test = mount();
    const before = test.read();
    const changed = snapshot(BASE - 50);
    changed.userData.userQuests[0]!.endAt = new Date(BASE + 120_000);
    await test.refresh(changed);
    expect(test.current().data).not.toBe(before.userData);
    expect(test.read().userData.userQuests).not.toBe(before.userData.userQuests);
    expect(test.read().userData.village).toBe(before.userData.village);
    expect<unknown>(test.current().achievementProgress).toBe(before.achievementProgress);

    const afterNested = test.current().data;
    const achievement = structuredClone(changed);
    achievement.achievementProgress[0]!.updatedAt = new Date(BASE);
    await test.refresh(achievement);
    const afterAchievement = test.current();
    expect(afterAchievement.achievementProgress).not.toBe(before.achievementProgress);
    expect(afterAchievement.data).toBe(afterNested);
    expect<unknown>(afterAchievement.data).toEqual(test.read().userData);

    await test.refresh({ ...achievement, notifications: [] });
    expect(test.current()).not.toBe(afterAchievement);
    expect(test.current().data).toBe(afterAchievement.data);
    expect(test.current().achievementProgress).toBe(afterAchievement.achievementProgress);
    expect(test.current().notifications).toEqual([]);
  });

  it("advances cache revisions for equal reads and preserves confirmed mutation patches", async () => {
    const test = mount();
    const revision = prepareUserUpdate(test.queryClient, key);
    await test.refresh(snapshot(BASE - 50));
    expect(prepareUserUpdate(test.queryClient, key)).toBe(revision! + 1);
    const currentRevision = prepareUserUpdate(test.queryClient, key);
    const before = test.read();
    await test.settle(() =>
      updateUserCache(test.queryClient, key, { money: 90 }, { revision: currentRevision }),
    );
    expect(test.current().data?.money).toBe(90);
    expect(test.read().userData.village).toBe(before.userData.village);
    expect(test.read().userData.updatedAt).toBe(before.userData.updatedAt);

    // A delayed delta must refresh after a completed read, even when its data was equal.
    const stale = prepareUserUpdate(test.queryClient, key);
    await test.refresh(snapshot(BASE - 25));
    await test.settle(() =>
      updateUserCache(test.queryClient, key, undefined, { revision: stale, delta: { money: -10 } }),
    );
    expect(test.current().data?.money).toBe(100);
  });
});
