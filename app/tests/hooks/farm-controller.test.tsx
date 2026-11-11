import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type { ReactNode } from "react";
import * as appClient from "@/app/_trpc/client";
import type { UserCache } from "@/deltas/profile";
import { useFarmController } from "@/hooks/farm-controller";
import * as userContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import type {
  FarmMutationResponse,
  FarmPlotState,
  FarmStateResponse,
} from "@/validators/farming";
import { QuestTracker } from "@/validators/objectives";
import { deferred as createDeferred } from "../setup/deferred";
import { TrpcTestProviders, testApi } from "../setup/trpc";

const clients: QueryClient[] = [];
const cleanups: (() => void)[] = [];
const plot = {
  id: "plot",
  slotIndex: 0,
  seedItemId: "seed",
  seedName: "Seed",
  cropName: "Crop",
  cropImage: "crop.webp",
  plantedAt: new Date(0),
  finishAt: new Date("2030-01-01"),
  lastWateredAt: null,
  fertilizerApplied: false,
  isReady: false,
  canWater: true,
  nextWateringAt: null,
  growthProgress: 0,
  growthStage: 1,
} satisfies FarmPlotState;
const farm = {
  farmingExperience: 0,
  farmingLevel: 1,
  farmCurrency: 100,
  farmPlotsPurchased: 0,
  farmExtractorsOwned: 0,
  totalPlots: 5,
  plots: [plot],
  shopEntries: [],
  availableSeeds: [],
  availableFertilizers: [],
  extractableCrops: [],
  sellableCrops: [],
} as unknown as FarmStateResponse;
const initial = {
  userData: {
    userId: "farmer",
    status: "ASLEEP",
    curEnergy: 10,
    farmingExperience: 0,
    farmCurrency: 100,
    farmPlotsPurchased: 0,
    farmExtractorsOwned: 0,
    questData: [],
  },
} as unknown as UserCache;
const progress = QuestTracker.parse({
  id: "farm-quest",
  goals: [{ id: "water", value: 1 }],
});
const recovered = {
  userId: "farmer",
  activity: { status: "AWAKE" as const },
  userPatch: { status: "AWAKE" as const, curEnergy: 70 },
};

beforeEach(() => {
  Object.assign(vi.spyOn(appClient, "api" as never), {
    farming: testApi.farming,
    useUtils: testApi.useUtils,
  });
});
afterEach(() => {
  cleanup();
  for (const close of cleanups.splice(0)) close();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
});

/** Run the real controller/cache pipeline; only server transport and the profile context binding are supplied. */
const harness = (response: FarmMutationResponse, deferred = false) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  const profileKey = getQueryKey(testApi.profile.getUser, undefined, "query");
  const farmKey = getQueryKey(testApi.farming.getFarmState, undefined, "query");
  client.setQueryData(
    profileKey,
    response.userRecovery
      ? initial
      : { ...initial, userData: { ...initial.userData!, status: "AWAKE" } },
  );
  client.setQueryData(farmKey, farm);
  let profileReads = 0;
  const canonical = {
    userData: {
      ...initial.userData!,
      status: "AWAKE",
      farmingExperience: 20,
      farmCurrency: 300,
    },
  };
  const observer = new QueryObserver(client, {
    queryKey: profileKey,
    staleTime: Infinity,
    queryFn: async () => {
      profileReads++;
      return canonical;
    },
  });
  cleanups.push(observer.subscribe(() => {}));
  vi.spyOn(userContext, "useRequiredUserData").mockImplementation(
    () =>
      ({
        timeDiff: 0,
        notifications: notifications(),
        updateNotifications: async (next) => {
          client.setQueryData<UserCache>(profileKey, (old) =>
            old ? { ...old, notifications: next } : old,
          );
        },
        prepareUserUpdate: () => prepareUserUpdate(client, profileKey),
        updateUser: (result, options) =>
          updateUserCache(client, profileKey, result, options),
      }) as ReturnType<typeof userContext.useRequiredUserData>,
  );
  const notifications = () => client.getQueryData<UserCache>(profileKey)?.notifications;
  let requested = false;
  const { promise: waiting, resolve: release } = createDeferred<void>();
  const requests: string[] = [];
  const trpc = testApi.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((sink) => {
            requests.push(op.path);
            if (op.type === "query") {
              sink.next({ result: { data: farm } });
              sink.complete();
              return;
            }
            requested = true;
            void (deferred ? waiting : Promise.resolve()).then(() => {
              sink.next({ result: { data: response } });
              sink.complete();
            });
          }),
    ],
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TrpcTestProviders client={trpc} queryClient={client}>
      {children}
    </TrpcTestProviders>
  );
  const view = renderHook(useFarmController, { wrapper });
  return {
    client,
    view,
    requests,
    release,
    requested: () => requested,
    profileReads: () => profileReads,
    profile: () => client.getQueryData<UserCache>(profileKey)?.userData,
    notifications,
    profileKey,
  };
};

it.each([false, true])(
  "applies farm XP and trackers once without fetching the profile (recovery=%p)",
  async (recovers) => {
    const test = harness({
      success: true,
      message: "Watered",
      actionNotice: recovers ? "Woke up" : undefined,
      userRecovery: recovers ? recovered : undefined,
      userPatch: { questData: [progress] },
      userDelta: { farmingExperience: 1 },
      farmingExperienceDelta: 1,
      updatedPlot: { ...plot, canWater: false, lastWateredAt: new Date() },
    });
    await act(async () => {
      test.view.result.current.water(plot);
    });
    await waitFor(() => expect(test.view.result.current.pendingPlotSlots.size).toBe(0));
    expect(test.profile()).toMatchObject({
      status: "AWAKE",
      curEnergy: recovers ? 70 : 10,
      farmingExperience: 1,
      questData: [progress],
    });
    expect(test.profileReads()).toBe(0);
    expect(test.requests).toEqual(["farming.waterPlot"]);
  },
);

it("applies a confirmed coin debit exactly once with recovery metadata", async () => {
  const test = harness({
    success: true,
    message: "Bought",
    userRecovery: recovered,
    userPatch: {},
    userDelta: { farmCurrency: -20, farmPlotsPurchased: 1 },
    farmCurrencyDelta: -20,
    farmPlotsPurchasedDelta: 1,
  });
  await act(async () => {
    await test.view.result.current.buy(
      { type: "PLOT", cost: 20, label: "Plot" } as never,
      1,
    );
  });
  expect(test.profile()).toMatchObject({
    status: "AWAKE",
    farmCurrency: 80,
    farmPlotsPurchased: 1,
  });
  expect(test.profileReads()).toBe(0);
});

it("retains confirmed recovery when a later plot step rejects", async () => {
  const test = harness({
    success: false,
    message: "Plot changed",
    userRecovery: recovered,
    userPatch: {},
    userDelta: {},
  });
  await act(async () => {
    test.view.result.current.water(plot);
  });
  await waitFor(() => expect(test.view.result.current.pendingPlotSlots.size).toBe(0));
  expect(test.profile()).toMatchObject({
    status: "AWAKE",
    curEnergy: 70,
    farmingExperience: 0,
  });
  expect(test.profileReads()).toBe(0);
});

it("preserves a newer profile revision without reading or replaying recovery and XP", async () => {
  const test = harness(
    {
      success: true,
      message: "Watered",
      userRecovery: recovered,
      userPatch: { questData: [progress] },
      userDelta: { farmingExperience: 1 },
      farmingExperienceDelta: 1,
      updatedPlot: plot,
    },
    true,
  );
  await act(async () => {
    test.view.result.current.water(plot);
  });
  await waitFor(() => expect(test.requested()).toBe(true));
  test.client.setQueryData(test.profileKey, {
    ...initial,
    userData: { ...initial.userData!, farmCurrency: 200 },
  });
  await act(async () => {
    test.release();
  });
  await waitFor(() => expect(test.view.result.current.pendingPlotSlots.size).toBe(0));
  expect(test.profileReads()).toBe(0);
  expect(test.profile()).toMatchObject({
    status: "ASLEEP",
    farmingExperience: 0,
    farmCurrency: 200,
  });
});

it("applies confirmed activity on a base-only success without requesting the profile", async () => {
  const test = harness({ success: true, message: "Watered", userRecovery: recovered });
  await act(async () => {
    test.view.result.current.water(plot);
  });
  await waitFor(() => expect(test.view.result.current.pendingPlotSlots.size).toBe(0));
  expect(test.profileReads()).toBe(0);
  expect(test.profile()).toMatchObject({
    status: "AWAKE",
    curEnergy: 10,
    farmingExperience: 0,
    farmCurrency: 100,
  });
});

it("applies confirmed activity while preserving explicitly unknown progress without requesting the profile", async () => {
  const test = harness({
    success: false,
    message: "Progress changed",
    userRecovery: recovered,
    userPatch: undefined,
    userDelta: undefined,
  });
  await act(async () => {
    test.view.result.current.water(plot);
  });
  await waitFor(() => expect(test.view.result.current.pendingPlotSlots.size).toBe(0));
  expect(test.profileReads()).toBe(0);
  expect(test.profile()).toMatchObject({
    status: "AWAKE",
    curEnergy: 10,
    farmingExperience: 0,
    farmCurrency: 100,
  });
});

it("keeps confirmed recovery after a partial bulk failure with withheld profile effects", async () => {
  const test = harness({
    success: false,
    message: "Some plots changed",
    userRecovery: recovered,
    userPatch: undefined,
    userDelta: undefined,
    updatedPlots: [{ before: plot, after: { ...plot, canWater: false } }],
  });
  await act(async () => {
    await test.view.result.current.waterAll();
  });
  expect(test.profileReads()).toBe(0);
  expect(test.profile()).toMatchObject({
    status: "AWAKE",
    curEnergy: 10,
    farmingExperience: 0,
    farmCurrency: 100,
  });
  expect(test.view.result.current.pendingBulkAction).toBeNull();
});

it("clears the watering notice once the last thirsty plant is watered", async () => {
  const test = harness({
    success: true,
    message: "Watered",
    userPatch: {},
    userDelta: { farmingExperience: 1 },
    farmingExperienceDelta: 1,
    updatedPlot: { ...plot, canWater: false, lastWateredAt: new Date() },
  });
  const poll = { href: "/manual/polls", name: "Unvoted Polls", color: "blue" } as const;
  test.client.setQueryData<UserCache>(test.profileKey, (old) =>
    old
      ? {
          ...old,
          notifications: [
            { href: "/farm", name: "1 farm plant is ready to water", color: "blue" },
            poll,
          ],
        }
      : old,
  );
  await act(async () => {
    test.view.result.current.water(plot);
  });
  await waitFor(() => expect(test.view.result.current.pendingPlotSlots.size).toBe(0));
  expect(test.notifications()).toEqual([poll]);
  expect(test.profileReads()).toBe(0);
});
