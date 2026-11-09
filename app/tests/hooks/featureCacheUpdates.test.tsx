import { afterEach, beforeAll, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import type { ReactNode } from "react";
import * as appClient from "@/app/_trpc/client";
import { getEquippedInventory } from "@/deltas/item";
import type { UserItem } from "@/drizzle/schema";
import type { useInventoryCacheUpdate as InventoryCacheHook } from "@/hooks/useInventoryCacheUpdate";
import { useJutsuCacheUpdate } from "@/hooks/useJutsuCacheUpdate";
import { TrpcTestProviders, testApi } from "../setup/trpc";

let useInventoryCacheUpdate: typeof InventoryCacheHook;
/** Bind the real typed procedures to this suite's provider without retaining other suites' mocks. */
const installApi = () =>
  Object.assign(vi.spyOn(appClient, "api" as never), {
    item: testApi.item,
    jutsu: testApi.jutsu,
    useUtils: testApi.useUtils,
  });
// Bun retains partial API mocks across suites; bind this provider before loading static keys.
beforeAll(async () => {
  installApi();
  ({ useInventoryCacheUpdate } = await import("@/hooks/useInventoryCacheUpdate"));
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

/** Exercise feature hooks against a shared cache and reject unexpected network requests. */
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
  return { client, requests, wrapper };
};

it("shares inventory snapshots across consumers and updates both views without losing variant data", async () => {
  const { client, requests, wrapper } = harness();
  const itemsKey = getQueryKey(testApi.item.getUserItems, undefined, "query");
  const variantsKey = getQueryKey(
    testApi.item.getUserItemsWithVariants,
    undefined,
    "query",
  );
  const rows: Pick<UserItem, "id" | "equipped">[] = [{ id: "owned", equipped: "NONE" }];
  const variants = [{ ...rows[0]!, variants: ["saved-variant"] }];
  client.setQueryData(itemsKey, rows);
  client.setQueryData(variantsKey, variants);
  const view = renderHook(
    () => ({ first: useInventoryCacheUpdate(), second: useInventoryCacheUpdate() }),
    { wrapper },
  );
  const snapshot = view.result.current.first.prepareInventoryUpdate();
  await act(async () =>
    view.result.current.second.updateInventory(
      (current) =>
        getEquippedInventory(current, [
          { id: "owned", equipped: "HEAD", beforeEquipped: "NONE" },
        ]),
      snapshot,
    ),
  );
  expect(client.getQueryData(itemsKey)).toEqual([{ id: "owned", equipped: "HEAD" }]);
  expect(client.getQueryData<typeof variants>(variantsKey)?.[0]?.variants).toBe(
    variants[0]!.variants,
  );
  expect(client.getQueryData<typeof rows>(variantsKey)?.[0]?.equipped).toBe("HEAD");
  expect(requests).toEqual([]);
});

it("keeps missing-projection recovery for both inventory views", async () => {
  const { client, wrapper } = harness();
  const keys = [
    getQueryKey(testApi.item.getUserItems, undefined, "query"),
    getQueryKey(testApi.item.getUserItemsWithVariants, undefined, "query"),
  ];
  for (const key of keys) client.setQueryData(key, [{ id: "owned", equipped: "NONE" }]);
  const view = renderHook(useInventoryCacheUpdate, { wrapper });
  const snapshot = view.result.current.prepareInventoryUpdate();
  await act(async () => view.result.current.updateInventory(undefined, snapshot));
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
});

it("reconciles the initiating jutsu filter after selection changes and marks other filters stale", async () => {
  const { client, requests, wrapper } = harness();
  const first = { includeEquipped: true, name: "first" };
  const second = { includeEquipped: true, name: "second" };
  const firstKey = getQueryKey(testApi.jutsu.getUserJutsus, first, "query");
  const secondKey = getQueryKey(testApi.jutsu.getUserJutsus, second, "query");
  client.setQueryData(firstKey, [{ id: "owned", jutsuId: "jutsu", equipped: false }]);
  const other = [{ id: "other", jutsuId: "another", equipped: false }];
  client.setQueryData(secondKey, other);
  const view = renderHook(({ input }) => useJutsuCacheUpdate(input), {
    initialProps: { input: first },
    wrapper,
  });
  const snapshot = view.result.current.prepareJutsuUpdate();
  view.rerender({ input: second });
  await act(async () =>
    view.result.current.updateJutsus(
      "owned",
      { jutsuId: "jutsu", equipped: true },
      snapshot,
    ),
  );
  expect(client.getQueryData(firstKey)).toEqual([
    { id: "owned", jutsuId: "jutsu", equipped: true },
  ]);
  expect(client.getQueryData(secondKey)).toBe(other);
  expect(client.getQueryState(secondKey)?.isInvalidated).toBe(true);
  expect(client.getQueryState(firstKey)?.isInvalidated).toBe(false);
  expect(requests).toEqual([]);
});
