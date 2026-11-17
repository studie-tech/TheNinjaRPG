import { afterEach, expect, it, vi } from "bun:test";
import {
  QueryClient,
  QueryClientProvider,
  type UseMutationOptions,
  useMutation,
} from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import { useHomeStorageMove, useHomeStorageToggle } from "@/hooks/useHomeStorageMove";
import * as inventory from "@/hooks/useInventoryCacheUpdate";
import * as toast from "@/libs/toast";

type Result = client.RouterOutputs["home"]["moveUserItems"];
type Input = client.RouterInputs["home"]["moveUserItems"];
type ToggleResult = client.RouterOutputs["home"]["toggleStoreItem"];
type ToggleInput = client.RouterInputs["home"]["toggleStoreItem"];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const renderMove = (response: Result) => {
  const queryClient = new QueryClient();
  const invalidateInventory = vi.fn(async () => undefined);
  const updateInventory = vi.fn(async () => undefined);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(inventory, "useInventoryCacheUpdate").mockReturnValue({
    prepareInventoryUpdate: () => undefined,
    updateInventory,
    invalidateInventory,
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    home: {
      moveUserItems: {
        useMutation: (options: UseMutationOptions<Result, Error, Input, undefined>) =>
          useMutation({ ...options, mutationFn: async () => response }),
      },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useHomeStorageMove(), { wrapper });
  return { result, invalidateInventory, updateInventory, queryClient };
};

it("patches the confirmed stacks into home storage", async () => {
  const move = renderMove({
    success: true,
    message: "Stored 1 item in your home.",
    movedUserItemIds: ["ore"],
    refused: [],
  });
  act(() => move.result.current.moveItems(["ore"], true));
  await waitFor(() => expect(move.updateInventory).toHaveBeenCalledTimes(1));
  expect(move.invalidateInventory).not.toHaveBeenCalled();
  move.queryClient.clear();
});

it("reads the inventory again when the server refuses the move", async () => {
  // The server refused from a fresher read, so the cached rows may be stale.
  const move = renderMove({
    success: false,
    message: "Nothing was moved. 1 stayed: Ore is already in your home storage.",
    refused: [
      { userItemId: "ore", name: "Ore", reason: "is already in your home storage" },
    ],
  });
  act(() => move.result.current.moveItems(["ore"], true));
  await waitFor(() => expect(move.invalidateInventory).toHaveBeenCalledTimes(1));
  expect(move.updateInventory).not.toHaveBeenCalled();
  move.queryClient.clear();
});

it("reconciles refused stacks after a partially successful storage move", async () => {
  const move = renderMove({
    success: true,
    message:
      "Stored 1 item in your home. 1 stayed: Ore is already in your home storage.",
    movedUserItemIds: ["pill"],
    refused: [
      { userItemId: "ore", name: "Ore", reason: "is already in your home storage" },
    ],
  });
  act(() => move.result.current.moveItems(["ore", "pill"], true));
  await waitFor(() => expect(move.invalidateInventory).toHaveBeenCalledTimes(1));
  expect(move.updateInventory).not.toHaveBeenCalled();
  move.queryClient.clear();
});

it("applies the stacks the moved items joined after moving them", async () => {
  const move = renderMove({
    success: true,
    message: "Stored 1 item in your home.",
    movedUserItemIds: ["herb-carried"],
    inventoryChanges: [
      { id: "herb-carried", itemId: "herb", beforeQuantity: 4, quantity: 9 },
      { id: "herb-stored", itemId: "herb", beforeQuantity: 5, quantity: 0 },
    ],
    refused: [],
  });
  act(() => move.result.current.moveItems(["herb-carried"], true));
  await waitFor(() => expect(move.updateInventory).toHaveBeenCalledTimes(1));
  const [update] = move.updateInventory.mock.calls[0] as unknown as [
    (
      rows: { id: string; itemId: string; quantity: number; storedAtHome: boolean }[],
    ) => unknown,
  ];
  expect(
    update([
      { id: "herb-carried", itemId: "herb", quantity: 4, storedAtHome: false },
      { id: "herb-stored", itemId: "herb", quantity: 5, storedAtHome: true },
    ]),
  ).toEqual([{ id: "herb-carried", itemId: "herb", quantity: 9, storedAtHome: true }]);
  move.queryClient.clear();
});

it("reads the inventory again when the joined stacks are withheld", async () => {
  const move = renderMove({
    success: true,
    message: "Stored 1 item in your home.",
    movedUserItemIds: ["herb-carried"],
    refused: [],
  });
  act(() => move.result.current.moveItems(["herb-carried"], true));
  await waitFor(() => expect(move.updateInventory).toHaveBeenCalledTimes(1));
  const [update] = move.updateInventory.mock.calls[0] as unknown as [
    (
      rows: { id: string; itemId: string; quantity: number; storedAtHome: boolean }[],
    ) => unknown,
  ];
  expect(
    update([{ id: "herb-carried", itemId: "herb", quantity: 4, storedAtHome: false }]),
  ).toBeUndefined();
  move.queryClient.clear();
});

const renderToggle = (response: ToggleResult) => {
  const queryClient = new QueryClient();
  const invalidateInventory = vi.fn(async () => undefined);
  const updateInventory = vi.fn(async () => undefined);
  const onToggled = vi.fn();
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(inventory, "useInventoryCacheUpdate").mockReturnValue({
    prepareInventoryUpdate: () => undefined,
    updateInventory,
    invalidateInventory,
  } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    home: {
      toggleStoreItem: {
        useMutation: (
          options: UseMutationOptions<ToggleResult, Error, ToggleInput, undefined>,
        ) => useMutation({ ...options, mutationFn: async () => response }),
      },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useHomeStorageToggle({ onToggled }), { wrapper });
  return { result, invalidateInventory, updateInventory, onToggled, queryClient };
};

it("moves a toggled stack to its confirmed side without reading the inventory", async () => {
  const toggle = renderToggle({
    success: true,
    message: "Item retrieved from your home.",
    storedAtHome: false,
    movedUserItemIds: ["ore"],
    inventoryChanges: [],
  });
  act(() => toggle.result.current.toggleStoreItem("ore"));
  await waitFor(() => expect(toggle.updateInventory).toHaveBeenCalledTimes(1));
  const [update] = toggle.updateInventory.mock.calls[0] as unknown as [
    (
      rows: { id: string; itemId: string; quantity: number; storedAtHome: boolean }[],
    ) => unknown,
  ];
  expect(
    update([{ id: "ore", itemId: "ore", quantity: 2, storedAtHome: true }]),
  ).toEqual([{ id: "ore", itemId: "ore", quantity: 2, storedAtHome: false }]);
  expect(toggle.invalidateInventory).not.toHaveBeenCalled();
  expect(toggle.onToggled).toHaveBeenCalledTimes(1);
  toggle.queryClient.clear();
});

it("reads the inventory again when a toggled stack's merge is withheld", async () => {
  const toggle = renderToggle({
    success: true,
    message: "Item stored in your home.",
    storedAtHome: true,
  });
  act(() => toggle.result.current.toggleStoreItem("ore"));
  await waitFor(() => expect(toggle.invalidateInventory).toHaveBeenCalledTimes(1));
  expect(toggle.updateInventory).not.toHaveBeenCalled();
  toggle.queryClient.clear();
});

it("leaves the caches alone when a toggle is rejected", async () => {
  const toggle = renderToggle({ success: false, message: "You are banned" });
  act(() => toggle.result.current.toggleStoreItem("ore"));
  await waitFor(() => expect(toggle.onToggled).toHaveBeenCalledTimes(1));
  expect(toggle.updateInventory).not.toHaveBeenCalled();
  expect(toggle.invalidateInventory).not.toHaveBeenCalled();
  toggle.queryClient.clear();
});
