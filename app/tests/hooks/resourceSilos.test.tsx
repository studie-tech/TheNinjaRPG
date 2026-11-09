import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { ReactNode } from "react";
import * as appClient from "@/app/_trpc/client";
import { useResourceSilo } from "@/hooks/useResourceSilos";
import * as userContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { fakeTrpcClient, testApi, TrpcTestProviders } from "../setup/trpc";

const clients: QueryClient[] = [];
beforeEach(() => Object.assign(vi.spyOn(appClient, "api" as never), {
  resourceSilos: testApi.resourceSilos, item: testApi.item, jutsu: testApi.jutsu, useUtils: testApi.useUtils,
}));
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); });

it.each(["success", "uncertain response", "rejected"])("reconciles jutsu ownership and owned-first catalogue pages: %s", async outcome => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const ownedKey = getQueryKey(testApi.jutsu.getUserJutsus, {}, "query");
  const filteredKey = getQueryKey(testApi.jutsu.getUserJutsus, { name: "Reward" }, "query");
  const catalogueKey = getQueryKey(testApi.jutsu.getAll, { limit: 1, ownedFirst: true }, "infinite");
  const ordinaryKey = getQueryKey(testApi.jutsu.getAll, { limit: 1 }, "infinite");
  const profileKey = getQueryKey(testApi.profile.getUser, undefined, "query");
  const before = [{ id: "existing", jutsuId: "existing" }];
  const after = [...before, { id: "granted", jutsuId: "reward" }];
  client.setQueryData(ownedKey, before);
  client.setQueryData(filteredKey, []);
  client.setQueryData(catalogueKey, { pages: [{ data: [{ id: "existing" }], nextCursor: 1 }], pageParams: [0] });
  client.setQueryData(ordinaryKey, { pages: [{ data: [{ id: "existing" }], nextCursor: 1 }], pageParams: [0] });
  client.setQueryData(profileKey, { userData: { userId: "viewer", status: "AWAKE" } });
  client.setQueryData(getQueryKey(testApi.resourceSilos.getStatus, undefined, "query"), { window: { id: "spawn", active: true }, points: 60, claimed: false });
  vi.spyOn(userContext, "useRequiredUserData").mockImplementation(() => ({
    prepareUserUpdate: () => prepareUserUpdate(client, profileKey),
    updateUser: (patch, options) => updateUserCache(client, profileKey, patch, options),
  }) as ReturnType<typeof userContext.useRequiredUserData>);
  const requests: string[] = [];
  const trpc = fakeTrpcClient(path => {
    requests.push(path);
    if (path === "resourceSilos.claim") {
      if (outcome === "uncertain response") throw new Error("Response lost after delivery");
      return { success: outcome === "success", windowId: "spawn", message: "Claim settled" };
    }
    if (path === "resourceSilos.getStatus") return { window: { id: "spawn", active: true }, points: 60, claimed: outcome !== "rejected" };
    if (path === "jutsu.getUserJutsus") return after;
    if (path === "jutsu.getAll") return { data: [{ id: "reward" }], nextCursor: undefined };
    throw new Error(`Unexpected read: ${path}`);
  });
  const wrapper = ({ children }: { children: ReactNode }) => <TrpcTestProviders client={trpc} queryClient={client}>{children}</TrpcTestProviders>;
  const claim = renderHook(useResourceSilo, { wrapper });
  await act(async () => { await claim.result.current.claim.mutateAsync().catch(() => undefined); });
  const shouldReconcile = outcome !== "rejected";
  for (const key of [ownedKey, filteredKey, catalogueKey]) expect(client.getQueryState(key)?.isInvalidated).toBe(shouldReconcile);
  expect(client.getQueryState(ordinaryKey)?.isInvalidated).toBe(false);
  // Returning to Jutsus and the training catalogue must recover even with an infinite stale time.
  const owned = renderHook(() => testApi.jutsu.getUserJutsus.useQuery({}), { wrapper });
  const catalogue = renderHook(() => testApi.jutsu.getAll.useInfiniteQuery({ limit: 1, ownedFirst: true }, { getNextPageParam: page => page.nextCursor }), { wrapper });
  if (shouldReconcile) {
    await waitFor(() => expect(owned.result.current.data?.map(({ id, jutsuId }) => ({ id, jutsuId }))).toEqual(after));
    await waitFor(() => expect(catalogue.result.current.data?.pages[0]?.data.map(row => row.id)).toEqual(["reward"]));
  } else {
    expect(owned.result.current.data?.map(({ id, jutsuId }) => ({ id, jutsuId }))).toEqual(before);
    expect(requests).toEqual(["resourceSilos.claim", "resourceSilos.getStatus"]);
  }
});
