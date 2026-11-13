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
import { useBulkSellItems } from "@/hooks/useBulkSellItems";
import * as inventory from "@/hooks/useInventoryCacheUpdate";
import * as toast from "@/libs/toast";
import * as userContext from "@/utils/UserContext";
import { deferred } from "../setup/deferred";
import { mockUserContextValue } from "../setup/userContext";

type Result = client.RouterOutputs["item"]["sellUserItems"];
type Input = client.RouterInputs["item"]["sellUserItems"];
type Context = { inventory: undefined; userRevision: number };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([false, true])(
  "reconciles inventory and profile for an unconfirmed sale (other confirmed sale=%s)",
  async (includeConfirmed) => {
    const response: Result = {
      success: includeConfirmed,
      message: "Could not confirm Blade. Your inventory and ryo will be refreshed.",
      soldUserItemIds: includeConfirmed ? ["potion-row"] : [],
      ryo: includeConfirmed ? 60 : 0,
      refused: [
        {
          userItemId: "blade-row",
          name: "Blade",
          reason: "sale could not be confirmed",
        },
      ],
    };
    const queryClient = new QueryClient();
    const { promise: recovery, resolve: finishRecovery } = deferred<void>();
    const updateUser = vi.fn(() => recovery);
    const invalidateInventory = vi.fn(() => recovery);
    const updateInventory = vi.fn();
    const onSettled = vi.fn();
    const onSold = vi.fn();
    const showMutationToast = vi
      .spyOn(toast, "showMutationToast")
      .mockImplementation(() => undefined);
    mockUserContextValue({
      prepareUserUpdate: () => 42,
      updateUser,
    } as never);
    vi.spyOn(inventory, "useInventoryCacheUpdate").mockReturnValue({
      prepareInventoryUpdate: () => undefined,
      updateInventory,
      invalidateInventory,
    } as never);
    Object.assign(vi.spyOn(client, "api" as never), {
      item: {
        sellUserItems: {
          useMutation: (options: UseMutationOptions<Result, Error, Input, Context>) =>
            useMutation({ ...options, mutationFn: async () => response }),
        },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useBulkSellItems({ onSold, onSettled }), {
      wrapper,
    });
    try {
      act(() =>
        result.current.sellMany([
          "blade-row",
          ...(includeConfirmed ? ["potion-row"] : []),
        ]),
      );
      await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
      expect(updateUser).toHaveBeenCalledWith(undefined);
      expect(invalidateInventory).toHaveBeenCalledTimes(1);
      expect(updateInventory).not.toHaveBeenCalled();
      expect(onSold).toHaveBeenCalledWith(response);
      expect(showMutationToast).toHaveBeenCalledWith(response);
      expect(result.current.isSelling).toBe(true);
      expect(onSettled).not.toHaveBeenCalled();
      await act(async () => {
        finishRecovery();
      });
      await waitFor(() => expect(result.current.isSelling).toBe(false));
      expect(onSettled).toHaveBeenCalledTimes(1);
    } finally {
      finishRecovery();
      queryClient.clear();
    }
  },
);
