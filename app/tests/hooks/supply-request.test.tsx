import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import * as appClient from "@/app/_trpc/client";
import * as inventoryCache from "@/hooks/useInventoryCacheUpdate";
import { useSupplyRequest } from "@/hooks/useSupplyRequest";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";
import { mockUserContextValue } from "../setup/userContext";

const clients: QueryClient[] = [];
beforeEach(() => {
  Object.assign(vi.spyOn(appClient, "api" as never), {
    occupation: testApi.occupation,
    quests: testApi.quests,
    useUtils: testApi.useUtils,
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

const setup = (outcome: "confirmed" | "lost response" | "rejected") => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  let quantity = 100;
  const updateUser = vi.fn(async () => true);
  const updateInventory = vi.fn(async () => {});
  const invalidateInventory = vi.fn(async () => {});
  mockUserContextValue({ prepareUserUpdate: () => 42, updateUser } as never);
  vi.spyOn(inventoryCache, "useInventoryCacheUpdate").mockReturnValue({
    prepareInventoryUpdate: () => ({ inventory: 1, variants: 1 }),
    updateInventory,
    invalidateInventory,
  } as never);
  const trpc = fakeTrpcClient((path) => {
    if (path === "occupation.getSupplyRequest")
      return { stacks: [{ id: "stock", quantity }] };
    if (path === "quests.allianceBuilding")
      return [
        { id: "event", entryRequirements: [{ itemId: "herb", owned: quantity }] },
      ];
    if (path === "occupation.submitSupplyRequest") {
      if (outcome === "rejected")
        return { success: false, message: "Your supplies changed." };
      quantity = 0;
      if (outcome === "lost response") throw new Error("Connection lost");
      return { success: true, message: "Submitted", inventoryChanges: [] };
    }
    throw new Error(`Unexpected procedure ${path}`);
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TrpcTestProviders client={trpc} queryClient={client}>
      {children}
    </TrpcTestProviders>
  );
  const view = renderHook(
    () => ({
      supply: useSupplyRequest(),
      events: appClient.api.quests.allianceBuilding.useQuery({ villageId: "home" }),
    }),
    { wrapper },
  );
  const submit = () =>
    act(() =>
      view.result.current.supply.submit({
        userItemId: "stock",
        quantity: 100,
        expectedQuantity: 100,
        expectedUpdatedAt: new Date(),
        occupation: "GATHERING",
        auctionMaxPrice: 11,
      }),
    );
  return { view, submit, updateUser, updateInventory, invalidateInventory };
};

it.each(["confirmed", "lost response"] as const)(
  "reconciles mounted event entry counts and supply stock after a %s submission",
  async (outcome) => {
    const t = setup(outcome);
    await waitFor(() =>
      expect(t.view.result.current.events.data?.[0]?.entryRequirements[0]?.owned).toBe(
        100,
      ),
    );
    t.submit();
    await waitFor(() => {
      expect(t.view.result.current.supply.result).toBeDefined();
      expect(t.view.result.current.supply.isSubmitting).toBe(false);
    });
    expect(t.view.result.current.supply.request.data?.stacks[0]?.quantity).toBe(0);
    expect(t.view.result.current.events.data?.[0]?.entryRequirements[0]?.owned).toBe(0);
    if (outcome === "confirmed") {
      expect(t.updateInventory).toHaveBeenCalledTimes(1);
      expect(t.invalidateInventory).not.toHaveBeenCalled();
      expect(t.updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ success: true }),
        { revision: 42 },
      );
    } else {
      expect(t.updateInventory).not.toHaveBeenCalled();
      expect(t.invalidateInventory).toHaveBeenCalledTimes(1);
      expect(t.updateUser).toHaveBeenCalledWith(undefined);
      expect(t.view.result.current.supply.result?.message).toBe("Connection lost");
    }
  },
);

it("preserves stock and rewards after a rejected submission", async () => {
  const t = setup("rejected");
  await waitFor(() => expect(t.view.result.current.events.data).toBeDefined());
  t.submit();
  await waitFor(() => expect(t.view.result.current.supply.result?.success).toBe(false));
  expect(t.view.result.current.events.data?.[0]?.entryRequirements[0]?.owned).toBe(100);
  expect(t.updateUser).not.toHaveBeenCalled();
  expect(t.updateInventory).not.toHaveBeenCalled();
  expect(t.invalidateInventory).not.toHaveBeenCalled();
});
