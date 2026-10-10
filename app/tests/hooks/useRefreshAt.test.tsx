import { ensureDom } from "../setup-dom.mjs";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { nextUtcDayAt } from "@/utils/time";

ensureDom();
let nowMs = 0;
const advanceTimers = (ms: number) => {
  nowMs += ms;
  vi.advanceTimersByTime(ms);
};
beforeEach(() => {
  nowMs = Date.UTC(2026, 9, 1, 12);
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => nowMs);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("boundary refresh", () => {
  it("refreshes at the earliest future server boundary and accounts for clock offset", () => {
    const refresh = vi.fn();
    const now = Date.now();
    const { unmount } = renderHook(() =>
      useRefreshAt([now - 1000, now + 5000, now + 10_000], refresh, 2000),
    );
    act(() => {
      advanceTimers(2000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("keeps refreshing daily even if the response is unchanged", () => {
    const refresh = vi.fn();
    const { unmount } = renderHook(() =>
      useRefreshAt([nextUtcDayAt(new Date(Date.now()))], refresh),
    );
    act(() => {
      advanceTimers(12 * 60 * 60 * 1000 + 1000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      advanceTimers(24 * 60 * 60 * 1000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("does not refresh disabled or unmounted surfaces", () => {
    const refresh = vi.fn();
    const now = Date.now();
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useRefreshAt([now + 5000], refresh, 0, enabled),
      { initialProps: { enabled: false } },
    );
    act(() => {
      advanceTimers(1000);
    });
    rerender({ enabled: true });
    unmount();
    act(() => {
      advanceTimers(10_000);
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
