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
import { useHomeStorageMove } from "@/hooks/useHomeStorageMove";
import * as inventory from "@/hooks/useInventoryCacheUpdate";
import * as toast from "@/libs/toast";

type Result = client.RouterOutputs["home"]["moveUserItems"];
type Input = client.RouterInputs["home"]["moveUserItems"];

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
