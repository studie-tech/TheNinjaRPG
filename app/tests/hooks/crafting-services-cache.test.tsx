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
            void read(op.path).then((data) => {
              observer.next({ result: { data } });
              observer.complete();
            });
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
  const refreshUser = vi.fn(async () => {});
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
  client.setQueryData(profileKey, { userData: { ...requester, items: [] } });
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

it("does not reconcile cached terminal history again on remount but observes later transitions", async () => {
  const { client, wrapper, refreshUser } = harness();
  client.setQueryData(requestsKey, [{ id: "old", status: "COMPLETED" }]);
  const first = renderHook(useServiceRequests, { wrapper });
  first.unmount();
  const second = renderHook(useServiceRequests, { wrapper });
  expect(refreshUser).not.toHaveBeenCalled();
  await act(async () => {
    client.setQueryData(requestsKey, [
      { id: "old", status: "COMPLETED" },
      { id: "new", status: "REFUNDED" },
    ]);
  });
  await waitFor(() => expect(refreshUser).toHaveBeenCalledTimes(1));
  second.unmount();
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
