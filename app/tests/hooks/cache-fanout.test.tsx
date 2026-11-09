import {
  InfiniteQueryObserver,
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { ReactNode } from "react";
import type { AppRouter } from "@/api/root";
import * as appClient from "@/app/_trpc/client";
import { getStartedJutsuTrainingUpdate } from "@/deltas/jutsu";
import { useJutsuLoadoutCacheUpdate } from "@/hooks/useJutsuLoadoutCacheUpdate";
import { useJutsuTrainingCacheUpdate } from "@/hooks/useJutsuTrainingCacheUpdate";
import { useSectorCacheUpdate } from "@/hooks/useSectorCacheUpdate";

const api = createTRPCReact<AppRouter>();
const clients: QueryClient[] = [];
const stops: (() => void)[] = [];
beforeEach(() =>
  Object.assign(vi.spyOn(appClient, "api" as never), {
    profile: api.profile,
    jutsu: api.jutsu,
    travel: api.travel,
    useUtils: api.useUtils,
  }),
);
afterEach(() => {
  cleanup();
  stops.splice(0).forEach((stop) => stop());
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

/** Observe real feature keys so only application-requested recovery counts as a read. */
const setup = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  clients.push(client);
  const startedAt = new Date("2026-11-01T10:00:00Z"),
    finishAt = new Date("2026-11-01T11:00:00Z");
  const training = getStartedJutsuTrainingUpdate(
    { id: "owned", jutsuId: "jutsu", level: 3 },
    "Test jutsu",
    startedAt,
    finishAt,
  );
  const user = {
    userId: "viewer",
    status: "AWAKE",
    battleId: null,
    sector: 1,
    longitude: 4,
    latitude: 5,
    location: "",
    villageId: null,
    anbuId: null,
    isOutlaw: true,
    userQuests: [],
    attributes: [],
    items: [],
    gender: "Male",
    spriteBodyStyle: null,
    curHealth: 100,
    maxHealth: 100,
    updatedAt: startedAt,
  };
  const sector = {
    users: [{ ...user, isMasked: false, longitude: 1 }],
    sectorData: { sector: 1 },
    village: null,
    warData: [],
    overworldAis: [],
    questPlacements: [],
  };
  client.setQueryData(getQueryKey(api.profile.getUser, undefined, "query"), {
    userData: user,
  });
  const keys = [
    getQueryKey(api.jutsu.getLoadouts, undefined, "query"),
    getQueryKey(api.jutsu.getUserJutsus, {}, "query"),
    getQueryKey(api.jutsu.getTrainingQueue, undefined, "query"),
    getQueryKey(api.profile.getSidebarTimers, undefined, "query"),
    getQueryKey(api.travel.getSectorData, { sector: 1 }, "query"),
  ];
  const values: unknown[] = [
    [{ id: "loadout", name: "Main", jutsuIds: ["a"] }],
    [
      {
        id: "owned",
        jutsuId: "jutsu",
        level: 3,
        trainingStartedAt: null,
        finishTraining: null,
      },
    ],
    { capacity: 3, waiting: [] },
    {
      jutsuTraining: null,
      jutsuQueue: { count: 0, next: null },
      crafting: { itemId: "craft" },
      imbuement: null,
    },
    sector,
  ];
  const events: number[] = [];
  const reads = keys.map((queryKey, i) => {
    client.setQueryData(queryKey, values[i]);
    const queryFn = vi.fn(async () => {
      events.push(i);
      return values[i];
    });
    stops.push(new QueryObserver(client, { queryKey, queryFn }).subscribe(() => {}));
    return queryFn;
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <api.Provider client={api.createClient({ links: [] })} queryClient={client}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </api.Provider>
  );
  const view = renderHook(
    ({ sector }: { sector: number }) => ({
      loadouts: useJutsuLoadoutCacheUpdate(),
      training: useJutsuTrainingCacheUpdate(),
      sector: useSectorCacheUpdate(sector),
    }),
    { initialProps: { sector: 1 }, wrapper },
  );
  return { client, keys, reads, view, values, training, user, sector, events };
};

it("keeps confirmed loadout equipment and ordering local, preserving the saved name", async () => {
  const t = setup(),
    hook = t.view.result.current.loadouts;
  await act(async () =>
    hook.updateEquippedLoadout(
      { equipped: true, jutsuId: "b", loadout: { id: "loadout", jutsuIds: ["a"] } },
      hook.prepareLoadoutUpdate(),
    ),
  );
  expect(t.client.getQueryData(t.keys[0]!)).toEqual([
    { id: "loadout", name: "Main", jutsuIds: ["a", "b"] },
  ]);
  await act(async () =>
    hook.updateLoadoutOrder("loadout", ["b", "a"], hook.prepareLoadoutUpdate()),
  );
  expect(t.client.getQueryData(t.keys[0]!)).toEqual([
    { id: "loadout", name: "Main", jutsuIds: ["b", "a"] },
  ]);
  expect(t.reads[0]).not.toHaveBeenCalled();
});

it.each(["revision", "missing metadata", "server baseline"])(
  "recovers loadouts after %s",
  async (reason) => {
    const t = setup(),
      hook = t.view.result.current.loadouts,
      snapshot = hook.prepareLoadoutUpdate();
    if (reason === "revision") t.client.setQueryData(t.keys[0]!, t.values[0]);
    await act(async () =>
      hook.updateEquippedLoadout(
        {
          equipped: true,
          jutsuId: "b",
          loadout:
            reason === "missing metadata"
              ? undefined
              : { id: "loadout", jutsuIds: reason === "server baseline" ? [] : ["a"] },
        },
        snapshot,
      ),
    );
    expect(t.reads[0]).toHaveBeenCalledTimes(1);
  },
);

it("projects confirmed existing-jutsu training, preserving unrelated crafting and imbuement timers", async () => {
  const t = setup(),
    hook = t.view.result.current.training;
  await act(async () =>
    hook.updateTraining(
      { success: true, message: "Training", trainingUpdate: t.training },
      hook.prepareTrainingUpdate(),
    ),
  );
  expect(t.client.getQueryData<{ level: number }[]>(t.keys[1]!)?.[0]?.level).toBe(4);
  expect(t.client.getQueryData(t.keys[3]!)).toEqual({
    ...(t.values[3] as object),
    jutsuTraining: {
      name: "Test jutsu",
      level: 4,
      trainingStartedAt: t.training.trainingStartedAt,
      finishTraining: t.training.finishTraining,
    },
  });
  t.reads.forEach((read) => expect(read).not.toHaveBeenCalled());
});

it.each(["missing projection", "rejected", "uncertain transport", "queue revision"])(
  "settles the queue before dependent recovery after %s",
  async (reason) => {
    const t = setup(),
      hook = t.view.result.current.training,
      snapshot = hook.prepareTrainingUpdate();
    if (reason === "queue revision") t.client.setQueryData(t.keys[2]!, t.values[2]);
    const result =
      reason === "uncertain transport"
        ? undefined
        : {
            success: reason !== "rejected",
            message: "Training",
            trainingUpdate: reason === "queue revision" ? t.training : undefined,
          };
    await act(async () => hook.updateTraining(result, snapshot));
    expect(t.events).toEqual([2, 1, 3]);
    t.reads.slice(1, 4).forEach((read) => expect(read).toHaveBeenCalledTimes(1));
  },
);

it("recovers the dependent timer after the ownership baseline rejects a training projection", async () => {
  const t = setup(),
    hook = t.view.result.current.training;
  await act(async () =>
    hook.updateTraining(
      {
        success: true,
        message: "Training",
        trainingUpdate: { ...t.training, beforeLevel: 99 },
      },
      hook.prepareTrainingUpdate(),
    ),
  );
  expect(t.events).toEqual([1, 3]);
  expect(t.client.getQueryData(t.keys[3]!)).toEqual(t.values[3]);
});

it.each(["start", "cancel"])(
  "reconciles owned-first offset pages after training %s without refreshing other catalogues",
  async (action) => {
    const t = setup(),
      hook = t.view.result.current.training;
    const queryKey = getQueryKey(
      api.jutsu.getAll,
      { limit: 1, ownedFirst: true },
      "infinite",
    );
    const ordinaryKey = getQueryKey(api.jutsu.getAll, { limit: 1 }, "infinite");
    let order = ["high", "active"];
    const queryFn = vi.fn(async ({ pageParam }: { pageParam: number }) => ({
      data: [order[pageParam]],
      nextCursor: pageParam + 1 < order.length ? pageParam + 1 : undefined,
    }));
    const observer = new InfiniteQueryObserver(t.client, {
      queryKey,
      queryFn,
      initialPageParam: 0,
      getNextPageParam: (page) => page.nextCursor,
    });
    stops.push(observer.subscribe(() => {}));
    await observer.refetch();
    t.client.setQueryData(ordinaryKey, {
      pages: [{ data: ["ordinary"] }],
      pageParams: [0],
    });
    order = ["active", "high"];
    await act(async () =>
      action === "start"
        ? hook.updateTraining(
            { success: true, message: "Training", trainingUpdate: t.training },
            hook.prepareTrainingUpdate(),
          )
        : hook.refreshTraining(),
    );
    await observer.fetchNextPage();
    expect(
      observer.getCurrentResult().data?.pages.flatMap((page) => page.data),
    ).toEqual(["active", "high"]);
    expect(queryFn).toHaveBeenCalledTimes(3);
    expect(t.client.getQueryState(ordinaryKey)?.isInvalidated).toBe(false);
  },
);

it("keeps sector updates bound to the captured sector when selection changes", async () => {
  const t = setup(),
    snapshot = t.view.result.current.sector.prepareSectorUpdate();
  const otherKey = getQueryKey(api.travel.getSectorData, { sector: 2 }, "query");
  t.client.setQueryData(otherKey, { untouched: true });
  t.view.rerender({ sector: 2 });
  await act(async () => t.view.result.current.sector.updateSector(true, snapshot));
  expect(
    t.client.getQueryData<{ users: { longitude: number }[] }>(t.keys[4]!)?.users[0]
      ?.longitude,
  ).toBe(4);
  expect(t.client.getQueryData(otherKey)).toEqual({ untouched: true });
  expect(t.reads[4]).not.toHaveBeenCalled();
});

it("updates the caller with unbound quest landmarks without a sector read", async () => {
  const t = setup(),
    hook = t.view.result.current.sector;
  const userQuests = [
    {
      quest: {
        content: {
          objectives: [
            { task: "move_to_location", sector: 1, longitude: 8, latitude: 9 },
          ],
        },
      },
    },
  ];
  t.client.setQueryData(getQueryKey(api.profile.getUser, undefined, "query"), {
    userData: { ...t.user, userQuests },
  });
  await act(async () => hook.updateSector(true, hook.prepareSectorUpdate()));
  expect(
    t.client.getQueryData<{ users: { longitude: number }[] }>(t.keys[4]!),
  ).toMatchObject({ users: [{ longitude: 4 }], overworldAis: [], questPlacements: [] });
  expect(t.reads[4]).not.toHaveBeenCalled();
});

it("refreshes NPC positions and health from the server after caller movement", async () => {
  const t = setup(),
    hook = t.view.result.current.sector;
  t.client.setQueryData(t.keys[4]!, {
    ...t.sector,
    overworldAis: [
      {
        userId: "npc",
        longitude: 4,
        latitude: 5,
        npcPositionVersion: 0,
        curHealth: 100,
      },
    ],
  });
  const authoritative = {
    ...t.sector,
    users: [{ ...t.sector.users[0], longitude: 4 }],
    overworldAis: [
      {
        userId: "npc",
        longitude: 8,
        latitude: 9,
        npcPositionVersion: 1,
        curHealth: 55,
      },
    ],
  };
  t.values[4] = authoritative;
  await act(async () =>
    expect(await hook.updateSector(true, hook.prepareSectorUpdate())).toBe(false),
  );
  expect(t.reads[4]).toHaveBeenCalledTimes(1);
  expect(t.client.getQueryData(t.keys[4]!)).toEqual(authoritative);
});

it.each([
  "profile recovery",
  "missing identity",
  "visible quest placement",
  "concealed quest placement",
  "faction change",
  "revision",
])("retains authoritative sector recovery after %s", async (reason) => {
  const t = setup(),
    hook = t.view.result.current.sector;
  if (reason === "missing identity")
    t.client.setQueryData(t.keys[4]!, { ...t.sector, users: [] });
  if (reason === "visible quest placement")
    t.client.setQueryData(t.keys[4]!, {
      ...t.sector,
      questPlacements: [{ npcPlacementId: "npc" }],
    });
  if (reason === "concealed quest placement")
    t.client.setQueryData(getQueryKey(api.profile.getUser, undefined, "query"), {
      userData: {
        ...t.user,
        userQuests: [
          {
            quest: {
              content: {
                objectives: [{ overworldPlacementId: "npc", hideLocation: true }],
              },
            },
          },
        ],
      },
    });
  if (reason === "faction change")
    t.client.setQueryData(t.keys[4]!, {
      ...t.sector,
      users: [{ ...t.sector.users[0], villageId: "changed" }],
    });
  const snapshot = hook.prepareSectorUpdate();
  if (reason === "revision") t.client.setQueryData(t.keys[4]!, t.sector);
  await act(async () => hook.updateSector(reason !== "profile recovery", snapshot));
  expect(t.reads[4]).toHaveBeenCalledTimes(1);
});
