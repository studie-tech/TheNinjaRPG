import { afterEach, expect, it, vi } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { useFortify } from "@/hooks/useFortify";
import * as inventory from "@/hooks/useInventoryCacheUpdate";
import { deferred } from "../setup/deferred";
import { mockUserContextValue } from "../setup/userContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([true, false])(
  "keeps Fortify recovery blocked until the profile refresh is confirmed (%s)",
  async (confirmed) => {
    const response = deferred<boolean>();
    const refreshUser = vi.fn(() => response.promise);
    const updateUser = vi.fn();
    mockUserContextValue({ prepareUserUpdate: () => 0, updateUser, refreshUser });
    const invalidateInventory = vi.fn(async () => undefined);
    vi.spyOn(inventory, "useInventoryCacheUpdate").mockReturnValue({
      prepareInventoryUpdate: vi.fn(),
      updateInventory: vi.fn(),
      invalidateInventory,
    } as never);
    const invalidateEligibility = vi.fn(async () => undefined);
    let rejectAttempt: (error: Error) => void = () => {};
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({
        item: { getFortifyEligibility: { invalidate: invalidateEligibility } },
      }),
      item: {
        fortify: {
          useMutation: (options: { onError: typeof rejectAttempt }) => {
            rejectAttempt = options.onError;
            return {};
          },
        },
      },
    });
    const message = vi.fn();
    const { result } = renderHook(() => useFortify(message));
    act(() => rejectAttempt(new Error("Attempt could not be confirmed")));
    expect(result.current.needsRefresh).toBe(true);
    let refreshing: Promise<void>;
    act(() => {
      refreshing = result.current.refresh();
    });
    expect(result.current.isRefreshing).toBe(true);
    expect(result.current.needsRefresh).toBe(true);
    await act(async () => {
      response.resolve(confirmed);
      await refreshing;
    });
    expect(refreshUser).toHaveBeenCalledTimes(1);
    expect(updateUser).not.toHaveBeenCalled();
    expect(invalidateInventory).toHaveBeenCalledWith({ throwOnError: true });
    expect(invalidateEligibility).toHaveBeenCalledTimes(1);
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.needsRefresh).toBe(!confirmed);
    expect(message.mock.lastCall?.[0]).toContain(
      confirmed ? "Item and balance refreshed" : "Could not confirm your balance",
    );
  },
);
