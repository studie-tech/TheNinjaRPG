import { act, cleanup, renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  vi,
} from "bun:test";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { nextUtcDayAt } from "@/utils/time";

beforeEach(() => {
  vi.useFakeTimers();
  setSystemTime(Date.UTC(2026, 9, 1, 12));
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
      vi.advanceTimersByTime(2000);
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
      vi.advanceTimersByTime(12 * 60 * 60 * 1000 + 1000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("keeps a pending refresh when a fresh array with the same boundary renders in the grace window", () => {
    const refresh = vi.fn();
    const boundary = Date.now() + 5000;
    const { rerender, unmount } = renderHook(
      ({ dates }) => useRefreshAt(dates, refresh),
      { initialProps: { dates: [boundary] } },
    );
    act(() => {
      vi.advanceTimersByTime(5500);
    });
    rerender({ dates: [boundary] });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
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
      vi.advanceTimersByTime(1000);
    });
    rerender({ enabled: true });
    unmount();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
