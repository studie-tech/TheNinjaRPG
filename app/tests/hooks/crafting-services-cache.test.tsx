import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type { ReactNode } from "react";
import * as appClient from "@/app/_trpc/client";
import {
  getServiceRequesterPatch,
  getServiceSubmissionCacheUpdate,
  getServiceSubmittedInventory,
} from "@/deltas/craftingServices";
import type { UserCache } from "@/deltas/profile";
import type { CraftingServiceRequest, UserItem } from "@/drizzle/schema";
import { useCraftingServiceEvents } from "@/hooks/useCraftingServiceEvents";
import {
  useCraftingServiceCache,
  useServiceRequests,
} from "@/hooks/useCraftingServices";
import * as pusher from "@/layout/PusherHandler";
import * as userContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { deferred } from "../setup/deferred";
import { TrpcTestProviders, testApi } from "../setup/trpc";

const clients: QueryClient[] = [];
beforeEach(() => {
  Object.assign(vi.spyOn(appClient, "api" as never), {
    occupation: testApi.occupation,
    profile: testApi.profile,
    item: testApi.item,
    comments: testApi.comments,
    useUtils: testApi.useUtils,
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
});

const requestsKey = getQueryKey(
  testApi.occupation.getServiceRequests,
  undefined,
  "query",
);
const profileKey = getQueryKey(testApi.profile.getUser, undefined, "query");
const inventoryKeys = [
  getQueryKey(testApi.item.getUserItems, undefined, "query"),
  getQueryKey(testApi.item.getUserItemsWithVariants, undefined, "query"),
];
const queueKey = getQueryKey(testApi.occupation.getCraftingQueue, undefined, "query");
const timersKey = getQueryKey(testApi.profile.getSidebarTimers, undefined, "query");
const baseline = {
  requiresUserRefresh: false,
  requiresProgressionRefresh: false,
  craftingItemsChanged: false,
  startedQueuedJobs: 0,
};
const material = {
  id: "material",
  itemId: "iron",
  userId: "requester",
  quantity: 10,
  equipped: "NONE",
  updatedAt: new Date(10),
} as UserItem;
const equipment = { ...material, id: "equipment", itemId: "sword", quantity: 1 };
const receipt = {
  id: "service:new",
  requesterId: "requester",
  crafterId: "crafter",
  service: "IMBUE",
  status: "PENDING",
  fee: 50,
  createdAt: new Date(20),
} as CraftingServiceRequest;
const requester = {
  userId: "requester",
  username: "Requester",
  status: "AWAKE" as const,
  money: 1000,
};
const submission = () =>
  getServiceSubmissionCacheUpdate({
    requester,
    requesterResult: baseline,
    crafterResult: baseline,
    request: receipt,
    consumptions: [{ row: material, quantity: 2 }],
    equipment,
    crafterName: "Crafter",
  })!;

const harness = (
  read: (path: string) => Promise<unknown> = async () => [],
  { userProvider = false } = {},
) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  const calls: string[] = [];
  const trpc = testApi.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            calls.push(op.path);
            void read(op.path).then(
              (data) => {
                observer.next({ result: { data } });
                observer.complete();
              },
              (error) => observer.error(error),
            );
          }),
    ],
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TrpcTestProviders client={trpc} queryClient={client}>
      {userProvider ? (
        <userContext.UserContextProvider initialIsSignedIn>
          {children}
        </userContext.UserContextProvider>
      ) : (
        children
      )}
    </TrpcTestProviders>
  );
  const refreshUser = vi.fn(async () => true);
  if (userProvider) {
    vi.spyOn(clerk, "useUser").mockReturnValue({
      isSignedIn: true,
      isLoaded: true,
      user: { id: requester.userId },
    } as never);
    vi.spyOn(pusher, "usePusherHandler").mockReturnValue(undefined);
  } else
    vi.spyOn(userContext, "useUserData").mockReturnValue({
      refreshUser,
      data: requester,
      prepareUserUpdate: () => prepareUserUpdate(client, profileKey),
      updateUser: (
        ...[update, mutation]: Parameters<
          ReturnType<typeof userContext.useUserData>["updateUser"]
        >
      ) => updateUserCache(client, profileKey, update, mutation),
    } as unknown as ReturnType<typeof userContext.useUserData>);
  return { client, wrapper, refreshUser, calls };
};
const seedSubmissionViews = (client: QueryClient) => {
  client.setQueryData(profileKey, {
    userData: { ...requester, items: [] },
    notifications: [],
  });
  for (const key of inventoryKeys)
    client.setQueryData(key, [material, { ...equipment, variants: ["preserved"] }]);
  client.setQueryData(requestsKey, []);
  client.setQueryData(queueKey, { waiting: [] });
  client.setQueryData(timersKey, { crafting: null });
};

it("patches confirmed fee, material quantities and equipment escrow across views without a read", async () => {
  const { client, wrapper, calls } = harness();
  seedSubmissionViews(client);
  const hook = renderHook(useCraftingServiceCache, { wrapper });
  const snapshot = hook.result.current.prepareServiceUpdate();
  await act(async () =>
    hook.result.current.updateService(
      { success: true, message: "sent", serviceUpdate: submission() },
      snapshot,
    ),
  );
  expect(client.getQueryData<UserCache>(profileKey)?.userData?.money).toBe(950);
  for (const key of inventoryKeys) {
    expect(client.getQueryData(key)).toEqual([
      { ...material, quantity: 8, updatedAt: receipt.createdAt },
    ]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  }
  expect(client.getQueryData(requestsKey)).toEqual([submission().receipt]);
  for (const key of [profileKey, requestsKey, queueKey, timersKey])
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  expect(calls).toEqual([]);
});

it.each(["unknown", "rejected profile projection"])(
  "settles the profile before dependent reads after origin unmount: %s",
  async (outcome) => {
    const response = deferred();
    const profile = deferred();
    const finished = deferred();
    let settled = false;
    const output = { ...material, id: "queued-output", itemId: "sword", quantity: 1 };
    const inventory = [{ ...material, quantity: 8 }, output];
    const { client, wrapper, calls } = harness(
      async (path) => {
        if (path === "occupation.submitServiceRequest") {
          await response.promise;
          return {
            success: true,
            message: "sent",
            serviceUpdate: outcome === "unknown" ? undefined : submission(),
          };
        }
        if (path === "profile.getUser") {
          await profile.promise;
          // Profile settlement can start an overdue queued craft and create its output.
          settled = true;
          return {
            userData: { ...requester, money: 950, items: [] },
            notifications: [],
          };
        }
        if (path === "item.getUserItemsWithVariants") return settled ? inventory : [];
        if (path === "occupation.getServiceRequests") return [submission().receipt];
        if (path === "occupation.getCraftingQueue") return { waiting: [] };
        if (path === "profile.getSidebarTimers") return { crafting: null };
        if (path === "occupation.getCraftingQueue") return { waiting: [] };
        throw new Error(`Unexpected query ${path}`);
      },
      { userProvider: true },
    );
    seedSubmissionViews(client);
    client.setQueryData(profileKey, {
      userData: { ...requester, items: [] },
      notifications: [],
    });
    let submit!: () => void;
    const Origin = () => {
      const { prepareServiceUpdate, updateService } = useCraftingServiceCache();
      const mutation = testApi.occupation.submitServiceRequest.useMutation({
        onMutate: prepareServiceUpdate,
        onSuccess: async (result, _input, snapshot) => {
          await updateService(result, snapshot);
          finished.resolve();
        },
      });
      submit = () =>
        mutation.mutate({
          crafterId: "crafter",
          service: "IMBUE",
          expectedFee: 50,
        });
      return null;
    };
    const DependentViews = () => {
      testApi.item.getUserItemsWithVariants.useQuery();
      testApi.occupation.getServiceRequests.useQuery();
      testApi.occupation.getCraftingQueue.useQuery();
      testApi.profile.getSidebarTimers.useQuery();
      return null;
    };
    const view = render(<Origin />, { wrapper });
    await act(async () => submit());
    if (outcome === "rejected profile projection") {
      // Only the profile revision changes; dependent revisions still permit the known patches.
      client.setQueryData(profileKey, {
        userData: { ...requester, money: 999, items: [] },
        notifications: [],
      });
    }
    // The global profile provider stays mounted while the mutation's origin unmounts.
    view.rerender(<DependentViews />);
    await act(async () => response.resolve());
    await waitFor(() => expect(calls).toContain("profile.getUser"));
    expect(calls).toEqual(["occupation.submitServiceRequest", "profile.getUser"]);
    await act(async () => {
      profile.resolve();
      await finished.promise;
    });
    expect(client.getQueryData(inventoryKeys[1]!)).toEqual(inventory);
    expect(calls.slice(2).sort()).toEqual([
      "item.getUserItemsWithVariants",
      "occupation.getCraftingQueue",
      "occupation.getServiceRequests",
      "profile.getSidebarTimers",
    ]);
    expect(client.getQueryState(inventoryKeys[1]!)?.isInvalidated).toBe(false);
    expect(client.getQueryState(inventoryKeys[1]!)?.fetchStatus).toBe("idle");
    expect(client.getQueryState(inventoryKeys[0]!)?.isInvalidated).toBe(true);
  },
);

it.each(["unknown", "changed revision", "changed stack", "changed identity"])(
  "reconciles %s rather than applying a stale projection",
  async (reason) => {
    const { client, wrapper } = harness();
    seedSubmissionViews(client);
    const hook = renderHook(useCraftingServiceCache, { wrapper });
    const snapshot = hook.result.current.prepareServiceUpdate();
    if (reason === "changed revision")
      for (const key of inventoryKeys) client.setQueryData(key, [material, equipment]);
    if (reason === "changed stack")
      for (const key of inventoryKeys)
        client.setQueryData(key, [{ ...material, quantity: 5 }, equipment]);
    if (reason === "changed identity")
      client.setQueryData(profileKey, {
        userData: { ...requester, userId: "other", items: [] },
      });
    await act(async () =>
      hook.result.current.updateService(
        {
          success: true,
          message: "sent",
          serviceUpdate: reason === "unknown" ? undefined : submission(),
        },
        snapshot,
      ),
    );
    const keys = reason === "changed identity" ? [profileKey] : inventoryKeys;
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    if (reason === "unknown")
      for (const key of [profileKey, requestsKey, queueKey, timersKey])
        expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  },
);

it("checks stack identity, quantity, owner, equipment state and revision independently of the query revision", () => {
  const update = submission();
  for (const change of [
    { itemId: "other" },
    { quantity: 9 },
    { userId: "other" },
    { equipped: "HEAD" as const },
    { updatedAt: new Date(11) },
  ])
    expect(
      getServiceSubmittedInventory([{ ...material, ...change }, equipment], update),
    ).toBeUndefined();
  expect(
    getServiceRequesterPatch({ ...requester, money: 999, items: [] }, update),
  ).toBeUndefined();
  expect(
    getServiceRequesterPatch({ ...requester, items: [{ id: material.id }] }, update),
  ).toBeUndefined();
  expect(
    getServiceSubmittedInventory([material, equipment], undefined),
  ).toBeUndefined();
});

it.each(["requester", "crafter"] as const)(
  "withholds every uncertain %s hydration effect",
  (participant) => {
    for (const changed of [
      { requiresUserRefresh: true },
      { requiresProgressionRefresh: true },
      { craftingItemsChanged: true },
      { startedQueuedJobs: 1 },
    ])
      expect(
        getServiceSubmissionCacheUpdate({
          requester,
          request: receipt,
          consumptions: [],
          crafterName: "Crafter",
          requesterResult:
            participant === "requester" ? { ...baseline, ...changed } : baseline,
          crafterResult:
            participant === "crafter" ? { ...baseline, ...changed } : baseline,
        }),
      ).toBeUndefined();
  },
);

it.each(["ASLEEP", "REPAIR"])("withholds submission projections for %s", (kind) => {
  expect(
    getServiceSubmissionCacheUpdate({
      requester: { ...requester, status: kind === "ASLEEP" ? "ASLEEP" : "AWAKE" },
      requesterResult: baseline,
      crafterResult: baseline,
      request: { ...receipt, service: kind === "REPAIR" ? "REPAIR" : "IMBUE" },
      consumptions: [],
      crafterName: "Crafter",
    }),
  ).toBeUndefined();
});

it("reconciles cached terminal history once, suppresses successful remounts and observes later transitions", async () => {
  const { client, wrapper, calls } = harness(
    async (path) => {
      if (path === "profile.getUser")
        return { userData: { ...requester, items: [] }, notifications: [] };
      return [];
    },
    { userProvider: true },
  );
  seedSubmissionViews(client);
  client.setQueryData(profileKey, {
    userData: { ...requester, items: [] },
    notifications: [],
  });
  client.setQueryData(requestsKey, [{ id: "old", status: "COMPLETED" }]);
  const Observer = () => {
    useServiceRequests();
    return null;
  };
  const view = render(<Observer />, { wrapper });
  await waitFor(() => expect(calls).toEqual(["profile.getUser"]));
  await waitFor(() =>
    expect(client.getQueryState(inventoryKeys[0]!)?.isInvalidated).toBe(true),
  );
  view.rerender(<div />);
  view.rerender(<Observer />);
  await act(async () => {});
  expect(calls).toEqual(["profile.getUser"]);
  await act(async () => {
    client.setQueryData(requestsKey, [
      { id: "old", status: "COMPLETED" },
      { id: "new", status: "REFUNDED" },
    ]);
  });
  await waitFor(() => expect(calls).toEqual(["profile.getUser", "profile.getUser"]));
});

it("retries failed profile reconciliation on identical receipt polls and observer remount without a render loop", async () => {
  let profileReads = 0;
  const terminal = [{ ...receipt, status: "REFUNDED" }];
  const { client, wrapper, calls } = harness(
    async (path) => {
      if (path === "profile.getUser") {
        profileReads++;
        if (profileReads < 4) throw new Error("profile temporarily unavailable");
        return {
          userData: { ...requester, money: 1050, items: [] },
          notifications: [],
        };
      }
      if (path === "occupation.getServiceRequests") return terminal;
      return [];
    },
    { userProvider: true },
  );
  seedSubmissionViews(client);
  client.setQueryData(profileKey, {
    userData: { ...requester, items: [] },
    notifications: [],
  });
  const Observer = () => {
    useServiceRequests();
    return null;
  };
  const view = render(<Observer />, { wrapper });
  await act(async () => client.setQueryData(requestsKey, terminal));
  const failedAttempt = async (count: number) => {
    await waitFor(() => {
      expect(profileReads).toBe(count);
      expect(client.getQueryState(profileKey)?.status).toBe("error");
      expect(client.getQueryState(profileKey)?.fetchStatus).toBe("idle");
    });
    // Inventory callbacks are recreated on renders; they must not trigger another attempt.
    for (let i = 0; i < 3; i++) view.rerender(<Observer />);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 25)));
    expect(profileReads).toBe(count);
    expect(client.getQueryData<UserCache>(profileKey)?.userData?.money).toBe(1000);
  };
  await failedAttempt(1);
  const cachedTerminal = client.getQueryData(requestsKey);
  await act(async () => client.refetchQueries({ queryKey: requestsKey }));
  await failedAttempt(2);
  expect(client.getQueryData(requestsKey)).toBe(cachedTerminal);
  view.rerender(<div />);
  view.rerender(<Observer />);
  await failedAttempt(3);
  await act(async () => client.refetchQueries({ queryKey: requestsKey }));
  await waitFor(() =>
    expect(client.getQueryData<UserCache>(profileKey)?.userData?.money).toBe(1050),
  );
  expect(profileReads).toBe(4);
  view.rerender(<div />);
  view.rerender(<Observer />);
  await act(async () => client.refetchQueries({ queryKey: requestsKey }));
  expect(profileReads).toBe(4);
  expect(calls.filter((path) => path === "occupation.getServiceRequests")).toHaveLength(
    3,
  );
});

it("shares an in-flight terminal reconciliation between observers", async () => {
  const profile = deferred();
  const { client, wrapper, calls } = harness(
    async (path) => {
      if (path === "profile.getUser") {
        await profile.promise;
        return { userData: { ...requester, items: [] }, notifications: [] };
      }
      return [];
    },
    { userProvider: true },
  );
  seedSubmissionViews(client);
  client.setQueryData(profileKey, {
    userData: { ...requester, items: [] },
    notifications: [],
  });
  client.setQueryData(requestsKey, [{ ...receipt, status: "COMPLETED" }]);
  const Observer = () => {
    useServiceRequests();
    return null;
  };
  const view = render(
    <>
      <Observer />
      <Observer />
    </>,
    { wrapper },
  );
  await waitFor(() => expect(calls).toEqual(["profile.getUser"]));
  view.rerender(<Observer />);
  expect(calls).toEqual(["profile.getUser"]);
  await act(async () => profile.resolve());
  await waitFor(() =>
    expect(client.getQueryState(inventoryKeys[0]!)?.isInvalidated).toBe(true),
  );
  expect(calls).toEqual(["profile.getUser"]);
});

it("reconciles a terminal delivery on a cold query's first response", async () => {
  const response = deferred<unknown>();
  const { wrapper, refreshUser } = harness(() => response.promise);
  renderHook(useServiceRequests, { wrapper });
  expect(refreshUser).not.toHaveBeenCalled();
  await act(async () => {
    response.resolve([{ id: "delivered", status: "COMPLETED" }]);
  });
  await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(1));
});

it.each(["event", "polling"])(
  "settles the profile before dependent receipt recovery through %s",
  async (kind) => {
    const profile = deferred();
    let settled = false;
    const output = { ...material, id: "queued-output", itemId: "sword", quantity: 1 };
    const { client, wrapper, calls } = harness(
      async (path) => {
        if (path === "profile.getUser") {
          await profile.promise;
          // Profile settlement can start an overdue queued craft and create its output.
          settled = true;
          return { userData: { ...requester, items: [] }, notifications: [] };
        }
        if (path === "item.getUserItemsWithVariants") return settled ? [output] : [];
        if (path === "occupation.getServiceRequests") return [];
        if (path === "profile.getSidebarTimers") return { crafting: null };
        if (path === "occupation.getCraftingQueue") return { waiting: [] };
        throw new Error(`Unexpected query ${path}`);
      },
      { userProvider: true },
    );
    seedSubmissionViews(client);
    client.setQueryData(profileKey, {
      userData: { ...requester, items: [] },
      notifications: [],
    });
    client.setQueryData(queueKey, { waiting: [{ id: "queued-job" }] });
    let refresh!: () => Promise<unknown>;
    const Views = () => {
      const { refreshUser } = userContext.useUserData();
      refresh = useCraftingServiceEvents(refreshUser).refreshServiceViews;
      useServiceRequests();
      testApi.item.getUserItemsWithVariants.useQuery();
      testApi.profile.getSidebarTimers.useQuery();
      testApi.occupation.getCraftingQueue.useQuery();
      return null;
    };
    render(<Views />, { wrapper });
    let pending: Promise<unknown> | undefined;
    await act(async () => {
      if (kind === "event") pending = refresh();
      else client.setQueryData(requestsKey, [{ ...receipt, status: "REFUNDED" }]);
    });
    await waitFor(() => expect(calls).toContain("profile.getUser"));
    expect(calls).toEqual(["profile.getUser"]);
    await act(async () => {
      profile.resolve();
      await pending;
    });
    await waitFor(() =>
      expect(client.getQueryData(inventoryKeys[1]!)).toEqual([output]),
    );
    expect(settled).toBe(true);
    expect(
      calls.filter((path) => path === "item.getUserItemsWithVariants"),
    ).toHaveLength(1);
    expect(client.getQueryData(queueKey)).toEqual({ waiting: [] });
    for (const key of [inventoryKeys[1]!, timersKey, queueKey]) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(false);
      expect(client.getQueryState(key)?.fetchStatus).toBe("idle");
    }
  },
);

it("recovers a settled open receipt omitted by the 100-row history without repeating unchanged polls", async () => {
  const { client, wrapper, refreshUser } = harness();
  seedSubmissionViews(client);
  const history = Array.from({ length: 100 }, (_, index) => ({
    ...receipt,
    id: `service:history-${index}`,
    status: "COMPLETED",
  }));
  client.setQueryData(requestsKey, [
    { ...receipt, id: "service:old-open", status: "ACTIVE" },
    ...history,
  ]);
  renderHook(useServiceRequests, { wrapper });
  await waitFor(() =>
    expect(client.getQueryState(inventoryKeys[0]!)?.isInvalidated).toBe(true),
  );
  expect(refreshUser).toHaveBeenCalledTimes(1);
  client.setQueryData(inventoryKeys[0]!, []);
  await act(async () => {
    client.setQueryData(requestsKey, history);
  });
  await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(client.getQueryState(inventoryKeys[0]!)?.isInvalidated).toBe(true),
  );
  await act(async () => {
    client.setQueryData(requestsKey, [...history]);
  });
  expect(refreshUser).toHaveBeenCalledTimes(2);
});

it("does not reconcile profile or inventory for new or unchanged open-only requests", async () => {
  const { client, wrapper, refreshUser } = harness();
  seedSubmissionViews(client);
  client.setQueryData(requestsKey, [receipt]);
  renderHook(useServiceRequests, { wrapper });
  await act(async () => {
    client.setQueryData(requestsKey, [
      { ...receipt, status: "ACTIVE" },
      { ...receipt, id: "another-open" },
    ]);
  });
  expect(refreshUser).not.toHaveBeenCalled();
  expect(client.getQueryState(inventoryKeys[0]!)?.isInvalidated).toBe(false);
});

it("retries failed active inventory reads on later receipt polls while retaining successful profile and queue phases", async () => {
  let inventoryReads = 0;
  const terminal = [{ ...receipt, status: "COMPLETED" }];
  const output = [{ ...equipment, id: "delivered" }];
  const { client, wrapper, refreshUser, calls } = harness(async (path) => {
    if (path === "item.getUserItems") {
      inventoryReads++;
      if (inventoryReads < 3) throw new Error("Transient inventory outage");
      return output;
    }
    if (path === "occupation.getServiceRequests") return terminal;
    if (path === "occupation.getCraftingQueue") return { waiting: [] };
    return [];
  });
  seedSubmissionViews(client);
  client.setQueryData(requestsKey, terminal);
  const Observer = () => {
    useServiceRequests();
    return null;
  };
  const Views = ({ observe = true }: { observe?: boolean }) => {
    testApi.item.getUserItems.useQuery();
    testApi.occupation.getCraftingQueue.useQuery();
    return observe ? <Observer /> : null;
  };
  const view = render(<Views />, { wrapper });
  await waitFor(() =>
    expect(client.getQueryState(inventoryKeys[0]!)?.status).toBe("error"),
  );
  expect(refreshUser).toHaveBeenCalledTimes(1);
  expect(inventoryReads).toBe(1);
  await act(async () => client.refetchQueries({ queryKey: requestsKey }));
  await waitFor(() => expect(inventoryReads).toBe(2));
  await waitFor(() =>
    expect(client.getQueryState(inventoryKeys[0]!)?.fetchStatus).toBe("idle"),
  );
  view.rerender(<Views observe={false} />);
  view.rerender(<Views />);
  await waitFor(() => expect(client.getQueryData(inventoryKeys[0]!)).toEqual(output));
  expect(refreshUser).toHaveBeenCalledTimes(1);
  expect(inventoryReads).toBe(3);
  expect(calls.filter((path) => path === "occupation.getCraftingQueue")).toHaveLength(
    1,
  );
  await act(async () => client.refetchQueries({ queryKey: requestsKey }));
  expect(inventoryReads).toBe(3);
  expect(refreshUser).toHaveBeenCalledTimes(1);
});

it("reconciles crafter progression on other-tab acceptance once", async () => {
  const active = { ...receipt, crafterId: requester.userId, status: "ACTIVE" };
  const { client, wrapper, calls } = harness(
    async (path) => {
      if (path === "profile.getUser")
        return {
          userData: { ...requester, craftingExperience: 120, items: [] },
          notifications: [],
        };
      if (path === "occupation.getServiceRequests") return [active];
      return [];
    },
    { userProvider: true },
  );
  seedSubmissionViews(client);
  client.setQueryData(profileKey, {
    userData: { ...requester, craftingExperience: 100, items: [] },
    notifications: [],
  });
  client.setQueryData(requestsKey, [{ ...active, status: "PENDING" }]);
  const view = renderHook(useServiceRequests, { wrapper });
  expect(calls).toEqual([]);
  await act(async () => client.setQueryData(requestsKey, [active]));
  await waitFor(() =>
    expect(
      client.getQueryData<UserCache>(profileKey)?.userData?.craftingExperience,
    ).toBe(120),
  );
  await waitFor(() =>
    expect(client.getQueryState(inventoryKeys[0]!)?.isInvalidated).toBe(true),
  );
  await act(async () => client.refetchQueries({ queryKey: requestsKey }));
  view.unmount();
  renderHook(useServiceRequests, { wrapper });
  expect(calls.filter((path) => path === "profile.getUser")).toHaveLength(1);
});

it.each(["event", "polling"])(
  "reads both inventories after a queue crosses its due time through %s",
  async (kind) => {
    let serverTime = 9;
    const dueAt = 10;
    let started = false;
    let profileRead = false;
    const releaseQueue = deferred();
    const output = { ...equipment, id: "started-output" };
    const h = harness(
      async (path) => {
        if (path === "profile.getUser") {
          const capturedNow = serverTime;
          profileRead = true;
          expect(capturedNow < dueAt).toBe(true);
          serverTime = 10;
          return {
            serverTime: capturedNow,
            userData: { ...requester, items: [] },
            notifications: [],
          };
        }
        if (path === "occupation.getCraftingQueue") {
          expect(profileRead).toBe(true);
          await releaseQueue.promise;
          if (serverTime >= dueAt) started = true;
          return { waiting: started ? [] : [{ id: "queued" }] };
        }
        if (path === "item.getUserItems" || path === "item.getUserItemsWithVariants")
          return started ? [output] : [];
        if (path === "occupation.getServiceRequests") return [];
        return [];
      },
      { userProvider: true },
    );
    seedSubmissionViews(h.client);
    h.client.setQueryData(queueKey, { waiting: [{ id: "queued" }] });
    let refresh!: () => Promise<unknown>;
    const Views = () => {
      refresh = useCraftingServiceEvents(
        userContext.useUserData().refreshUser,
      ).refreshServiceViews;
      useServiceRequests();
      testApi.item.getUserItems.useQuery();
      testApi.item.getUserItemsWithVariants.useQuery();
      testApi.occupation.getCraftingQueue.useQuery();
      return null;
    };
    render(<Views />, { wrapper: h.wrapper });
    let event: Promise<unknown> | undefined;
    await act(async () => {
      if (kind === "event") event = refresh();
      else h.client.setQueryData(requestsKey, [{ ...receipt, status: "REFUNDED" }]);
    });
    await waitFor(() => expect(h.calls).toContain("occupation.getCraftingQueue"));
    expect(h.calls.some((path) => path.startsWith("item."))).toBe(false);
    await act(async () => {
      releaseQueue.resolve();
      await event;
    });
    await waitFor(() =>
      expect(h.client.getQueryData(queueKey)).toEqual({ waiting: [] }),
    );
    expect(started).toBe(true);
    for (const key of inventoryKeys)
      await waitFor(() => expect(h.client.getQueryData(key)).toEqual([output]));
  },
);

it("retries receipt recovery after a cancelled provider refresh and failed replacement", async () => {
  const replacement = deferred();
  let profiles = 0;
  const h = harness(
    async (path) => {
      if (path === "profile.getUser") {
        profiles++;
        if (profiles === 1) return new Promise(() => {});
        if (profiles === 2) {
          await replacement.promise;
          throw new Error("replacement failed");
        }
        return {
          userData: { ...requester, money: 1050, items: [] },
          notifications: [],
        };
      }
      if (path === "occupation.getServiceRequests")
        return [{ ...receipt, status: "COMPLETED" }];
      return [];
    },
    { userProvider: true },
  );
  seedSubmissionViews(h.client);
  h.client.setQueryData(requestsKey, [{ ...receipt, status: "COMPLETED" }]);
  let refresh!: () => Promise<boolean>;
  const Views = () => {
    refresh = userContext.useUserData().refreshUser;
    useServiceRequests();
    return null;
  };
  render(<Views />, { wrapper: h.wrapper });
  await waitFor(() => expect(profiles).toBe(1));
  let next!: Promise<boolean>;
  await act(async () => {
    next = refresh();
  });
  await waitFor(() => expect(profiles).toBe(2));
  await act(async () => {
    replacement.resolve();
    await next;
  });
  expect(await next).toBe(false);
  expect(h.client.getQueryState(inventoryKeys[0]!)?.isInvalidated).toBe(false);
  await act(async () => {
    await h.client.refetchQueries({ queryKey: requestsKey });
  });
  await waitFor(() => expect(profiles).toBe(3));
  await waitFor(() =>
    expect(h.client.getQueryState(inventoryKeys[0]!)?.isInvalidated).toBe(true),
  );
  expect(h.client.getQueryData<UserCache>(profileKey)?.userData?.money).toBe(1050);
  await act(async () => h.client.refetchQueries({ queryKey: requestsKey }));
  expect(profiles).toBe(3);
});

it("retries a failed queue before inventory while retaining successful profile and independent reads", async () => {
  let queueReads = 0;
  const terminal = [{ ...receipt, status: "COMPLETED" }];
  const { client, wrapper, refreshUser, calls } = harness(async (path) => {
    if (path === "occupation.getCraftingQueue") {
      if (++queueReads === 1) throw new Error("Queue unavailable");
      return { waiting: [] };
    }
    if (path === "occupation.getServiceRequests") return terminal;
    return [];
  });
  seedSubmissionViews(client);
  client.setQueryData(requestsKey, terminal);
  const Views = () => {
    useServiceRequests();
    testApi.item.getUserItems.useQuery();
    testApi.item.getUserItemsWithVariants.useQuery();
    testApi.occupation.getCraftingQueue.useQuery();
    testApi.profile.getSidebarTimers.useQuery();
    return null;
  };
  render(<Views />, { wrapper });
  await waitFor(() => expect(client.getQueryState(queueKey)?.status).toBe("error"));
  expect(calls.some((path) => path.startsWith("item."))).toBe(false);
  await waitFor(() =>
    expect(calls.filter((path) => path === "profile.getSidebarTimers")).toHaveLength(1),
  );
  await act(async () => client.refetchQueries({ queryKey: requestsKey }));
  for (const key of inventoryKeys)
    await waitFor(() => expect(client.getQueryData(key)).toEqual([]));
  expect(queueReads).toBe(2);
  expect(refreshUser).toHaveBeenCalledTimes(1);
  expect(calls.filter((path) => path === "profile.getSidebarTimers")).toHaveLength(1);
});
