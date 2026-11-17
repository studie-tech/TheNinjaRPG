import { afterEach, beforeAll, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type { ReactNode } from "react";
import * as appClient from "@/app/_trpc/client";
import type { useClanCacheUpdate as ClanCacheHook } from "@/hooks/useClanCacheUpdate";
import { TrpcTestProviders, testApi } from "../setup/trpc";

let useClanCacheUpdate: typeof ClanCacheHook;
/** Bind the real typed procedures to this suite's provider without retaining other suites' mocks. */
const installApi = () =>
  Object.assign(vi.spyOn(appClient, "api" as never), {
    clan: testApi.clan,
    useUtils: testApi.useUtils,
  });
// Bun retains partial API mocks across suites; bind this provider before loading static keys.
beforeAll(async () => {
  installApi();
  ({ useClanCacheUpdate } = await import("@/hooks/useClanCacheUpdate"));
  vi.restoreAllMocks();
});
beforeEach(() => {
  installApi();
});
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.restoreAllMocks();
});

const clanKey = (clanId: string) => getQueryKey(testApi.clan.get, { clanId }, "query");

/** Seed two cached clans and reject unexpected network requests. */
const harness = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  const requests: string[] = [];
  const trpc = testApi.createClient({
    links: [
      () =>
        ({ op }) =>
          observable(() => {
            requests.push(op.path);
            throw new Error(`Unexpected request: ${op.path}`);
          }),
    ],
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TrpcTestProviders client={trpc} queryClient={client}>
      {children}
    </TrpcTestProviders>
  );
  for (const id of ["first", "second"])
    client.setQueryData(clanKey(id), { id, bank: 100, points: 10 } as never);
  const clan = (id: string) =>
    client.getQueryData<{ bank: number; points: number }>(clanKey(id));
  return { client, requests, wrapper, clan };
};

it("applies a confirmed clan delta to the clan captured when the mutation started", async () => {
  const { client, requests, wrapper, clan } = harness();
  const view = renderHook(({ clanId }) => useClanCacheUpdate(clanId), {
    wrapper,
    initialProps: { clanId: "first" },
  });
  const snapshot = view.result.current.prepareClanUpdate();
  view.rerender({ clanId: "second" });
  await act(async () => {
    await view.result.current.updateClan(
      { clanDelta: { id: "first", bank: 50, points: -2 } },
      snapshot,
    );
  });
  expect(clan("first")).toMatchObject({ bank: 150, points: 8 });
  expect(clan("second")).toMatchObject({ bank: 100, points: 10 });
  expect(client.getQueryState(clanKey("first"))?.isInvalidated).toBe(false);
  expect(requests).toEqual([]);
});

it("marks the captured clan for a fetch when the response carries no clan delta", async () => {
  const { client, wrapper, clan } = harness();
  const view = renderHook(() => useClanCacheUpdate("first"), { wrapper });
  const snapshot = view.result.current.prepareClanUpdate();
  await act(async () => {
    await view.result.current.updateClan({}, snapshot);
  });
  expect(clan("first")).toMatchObject({ bank: 100 });
  expect(client.getQueryState(clanKey("first"))?.isInvalidated).toBe(true);
  expect(client.getQueryState(clanKey("second"))?.isInvalidated).toBe(false);
});
