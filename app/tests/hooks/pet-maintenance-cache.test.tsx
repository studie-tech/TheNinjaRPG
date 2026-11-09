import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import type { ReactNode } from "react";
import type { AppRouter } from "@/api/root";
import * as appClient from "@/app/_trpc/client";
import { getStructureMaintenanceUserUpdate } from "@/deltas/kage";
import { getSavedPetSettingsUpdate } from "@/deltas/pets";
import type { UserCache } from "@/deltas/profile";
import { usePetCacheUpdate } from "@/hooks/usePetCacheUpdate";
import { useVillageMaintenanceCacheUpdate } from "@/hooks/useVillageMaintenanceCacheUpdate";
import * as UserContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";

const api = createTRPCReact<AppRouter>();
const clients: QueryClient[] = [];
const stops: (() => void)[] = [];
beforeEach(() =>
  Object.assign(vi.spyOn(appClient, "api" as never), {
    pets: api.pets,
    village: api.village,
    useUtils: api.useUtils,
  }),
);
afterEach(() => {
  cleanup();
  stops.splice(0).forEach((stop) => stop());
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

/** Observe actual cache keys with idle snapshots and count only requested reconciliation. */
const setup = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  clients.push(client);
  const updatedAt = new Date("2026-11-01T10:00:00Z");
  const village = {
    id: "home",
    kageId: "owner",
    tokens: 500,
    structureMaintenanceDue: 200,
    structures: [],
  };
  const user = {
    userId: "owner",
    updatedAt,
    villageId: village.id,
    village,
    rank: "JONIN",
    level: 50,
    status: "AWAKE",
    experience: 100,
    earnedExperience: 100,
    isOutlaw: false,
  };
  const pet = {
    id: "pet",
    name: "Miso",
    gender: "FEMALE",
    battleEnabled: false,
    spawnPosition: "BEHIND",
    aiRules: [],
    includeDefaultRules: false,
    updatedAt,
    revision: 0,
  };
  const petData = { pet, pets: [pet], canFeed: true, unusedExperience: 80 };
  const villageData = {
    villageData: village,
    sectorCount: 9,
    defendedChallenges: [{ id: "challenge" }],
  };
  const keys = [
    getQueryKey(api.profile.getUser, undefined, "query"),
    getQueryKey(api.pets.getPet, { petId: "pet" }, "query"),
    getQueryKey(api.pets.getCollection, undefined, "query"),
    getQueryKey(api.village.get, { id: "home" }, "query"),
  ];
  const values: unknown[] = [
    { userData: user, notifications: [] },
    petData,
    { pets: [pet] },
    villageData,
  ];
  const reads = keys.map((queryKey, i) => {
    client.setQueryData(queryKey, values[i]);
    const queryFn = vi.fn(async () => values[i]);
    stops.push(new QueryObserver(client, { queryKey, queryFn }).subscribe(() => {}));
    return queryFn;
  });
  const userCache = {
    prepareUserUpdate: () => prepareUserUpdate(client, keys[0]!),
    updateUser: ((patch, options) =>
      updateUserCache(client, keys[0]!, patch, options)) as ReturnType<
      typeof UserContext.useUserInfo
    >["updateUser"],
  };
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(
    () =>
      ({
        ...userCache,
        data: client.getQueryData<UserCache>(keys[0]!)?.userData,
      }) as never,
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <api.Provider client={api.createClient({ links: [] })} queryClient={client}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </api.Provider>
  );
  const view = renderHook(
    ({ petId, villageId }) => ({
      pet: usePetCacheUpdate({ petId }, userCache),
      maintenance: useVillageMaintenanceCacheUpdate(villageId),
    }),
    { initialProps: { petId: "pet", villageId: "home" }, wrapper },
  );
  const settings = {
    success: true,
    message: "Saved",
    ...getSavedPetSettingsUpdate(
      user as never,
      pet as never,
      { name: "Kumo" },
      new Date(updatedAt.getTime() + 1000),
      false,
    ),
  };
  const payment = {
    success: true,
    message: "Paid",
    ...getStructureMaintenanceUserUpdate("home", 200),
  };
  return { client, keys, reads, view, values, user, pet, settings, payment };
};

it("publishes known pet settings into both projections and the collection with zero reads", async () => {
  const t = setup(),
    hook = t.view.result.current.pet;
  await act(async () => hook.updateSettings(t.settings, hook.prepareSettingsUpdate()));
  expect(t.client.getQueryData(t.keys[1]!)).toMatchObject({
    pet: { name: "Kumo", revision: 1 },
    pets: [{ name: "Kumo", revision: 1 }],
    canFeed: true,
    unusedExperience: 80,
  });
  expect(t.client.getQueryData(t.keys[2]!)).toMatchObject({
    pets: [{ name: "Kumo", revision: 1 }],
  });
  t.reads.forEach((read) => expect(read).not.toHaveBeenCalled());
});

it.each([
  "query revision",
  "selected revision",
  "list revision",
  "collection revision",
  "missing projection",
  "owner revision",
  "owner timestamp",
  "account",
])("recovers pet settings after %s", async (reason) => {
  const t = setup(),
    hook = t.view.result.current.pet;
  let snapshot = hook.prepareSettingsUpdate();
  if (reason === "query revision") t.client.setQueryData(t.keys[1]!, t.values[1]);
  if (reason === "selected revision" || reason === "list revision")
    t.client.setQueryData(t.keys[1]!, {
      ...(t.values[1] as object),
      pet: { ...t.pet, revision: reason === "selected revision" ? 5 : 0 },
      pets: [{ ...t.pet, revision: reason === "list revision" ? 5 : 0 }],
    });
  if (reason === "collection revision")
    t.client.setQueryData(t.keys[2]!, { pets: [{ ...t.pet, revision: 5 }] });
  if (["owner revision", "owner timestamp", "account"].includes(reason)) {
    const user = {
      ...t.user,
      ...(reason === "account"
        ? { userId: "other" }
        : reason === "owner timestamp"
          ? { updatedAt: new Date(0) }
          : {}),
    };
    t.client.setQueryData(t.keys[0]!, { userData: user });
  }
  // Domain mismatches must be rejected even with a settled, matching query revision.
  if (
    [
      "selected revision",
      "list revision",
      "collection revision",
      "owner timestamp",
      "account",
    ].includes(reason)
  )
    snapshot = hook.prepareSettingsUpdate();
  const result =
    reason === "missing projection" ? { success: true, message: "Saved" } : t.settings;
  await act(async () => hook.updateSettings(result, snapshot));
  expect(t.reads[reason === "collection revision" ? 2 : 1]).toHaveBeenCalledTimes(1);
  if (
    ["owner revision", "owner timestamp", "account", "missing projection"].includes(
      reason,
    )
  )
    expect(t.reads[0]).toHaveBeenCalledTimes(1);
});

it("settles the initiating pet query when selection changes", async () => {
  const t = setup(),
    snapshot = t.view.result.current.pet.prepareSettingsUpdate();
  const otherKey = getQueryKey(api.pets.getPet, { petId: "other" }, "query");
  t.client.setQueryData(otherKey, { marker: "other" });
  t.view.rerender({ petId: "other", villageId: "home" });
  await act(async () => t.view.result.current.pet.updateSettings(t.settings, snapshot));
  expect(t.client.getQueryData(t.keys[1]!)).toMatchObject({ pet: { name: "Kumo" } });
  expect(t.client.getQueryData(otherKey)).toEqual({ marker: "other" });
  expect(t.reads[1]).not.toHaveBeenCalled();
});

it("reconciles a paid bill in village and profile caches with zero reads and preserves relations", async () => {
  const t = setup(),
    hook = t.view.result.current.maintenance;
  await act(async () =>
    hook.updateMaintenance(t.payment, 200, hook.prepareMaintenanceUpdate()),
  );
  expect(t.client.getQueryData(t.keys[3]!)).toEqual({
    ...(t.values[3] as object),
    villageData: { ...t.user.village, tokens: 300, structureMaintenanceDue: 0 },
  });
  expect(t.client.getQueryData(t.keys[0]!)).toMatchObject({
    userData: { village: { tokens: 300, structureMaintenanceDue: 0 } },
  });
  t.reads.forEach((read) => expect(read).not.toHaveBeenCalled());
});

it.each([
  "rejected",
  "uncertain transport",
  "missing projection",
  "bill",
  "village revision",
  "profile revision",
  "account",
])("recovers the captured maintenance bill after %s", async (reason) => {
  const t = setup(),
    hook = t.view.result.current.maintenance,
    snapshot = hook.prepareMaintenanceUpdate();
  if (reason === "bill" || reason === "village revision")
    t.client.setQueryData(
      t.keys[3]!,
      reason === "bill"
        ? {
            ...(t.values[3] as object),
            villageData: { ...t.user.village, structureMaintenanceDue: 300 },
          }
        : t.values[3],
    );
  if (reason === "profile revision" || reason === "account")
    t.client.setQueryData(t.keys[0]!, {
      userData: { ...t.user, userId: reason === "account" ? "other" : "owner" },
    });
  if (reason === "account") t.view.rerender({ petId: "pet", villageId: "home" });
  const result =
    reason === "uncertain transport"
      ? undefined
      : ["rejected", "missing projection"].includes(reason)
        ? { success: reason !== "rejected", message: "Changed" }
        : t.payment;
  await act(async () =>
    t.view.result.current.maintenance.updateMaintenance(result, 200, snapshot),
  );
  expect(t.reads[reason === "profile revision" ? 0 : 3]).toHaveBeenCalledTimes(1);
  if (
    ["rejected", "uncertain transport", "missing projection", "account"].includes(
      reason,
    )
  )
    expect(t.reads[0]).toHaveBeenCalledTimes(1);
});

it("keeps maintenance reconciliation on its initiating village after selection changes", async () => {
  const t = setup(),
    snapshot = t.view.result.current.maintenance.prepareMaintenanceUpdate();
  const otherKey = getQueryKey(api.village.get, { id: "other" }, "query");
  t.client.setQueryData(otherKey, { marker: "other" });
  t.view.rerender({ petId: "pet", villageId: "other" });
  await act(async () =>
    t.view.result.current.maintenance.updateMaintenance(t.payment, 200, snapshot),
  );
  expect(t.client.getQueryData(t.keys[3]!)).toMatchObject({
    villageData: { tokens: 300, structureMaintenanceDue: 0 },
  });
  expect(t.client.getQueryData(otherKey)).toEqual({ marker: "other" });
  expect(t.reads[3]).not.toHaveBeenCalled();
});
