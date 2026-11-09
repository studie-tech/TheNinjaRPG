import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  vi,
} from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useLiveCountdown } from "@/hooks/useLiveCountdown";
import { getRemainingStealthCooldown } from "@/libs/stealth";

const BASE = Date.UTC(2026, 9, 21, 12);

beforeEach(() => {
  vi.useFakeTimers();
  setSystemTime(BASE);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useLiveCountdown", () => {
  it.each([undefined, null, 0])("starts short countdowns after %s", (initial) => {
    const { result, rerender } = renderHook(
      ({ seconds }) => useLiveCountdown(seconds),
      { initialProps: { seconds: initial as number | undefined | null } },
    );
    expect(result.current).toBe(0);

    for (const seconds of [1, 2]) {
      rerender({ seconds });
      expect(result.current).toBe(seconds);
      act(() => vi.advanceTimersByTime(1_000));
      expect(result.current).toBe(seconds - 1);
      act(() => vi.advanceTimersByTime(1_000));
      expect(result.current).toBe(0);
      rerender({ seconds: 0 });
    }
  });

  it.each([0, undefined, null])(
    "clears an active countdown when given %s",
    (stopped) => {
      const { result, rerender } = renderHook(
        ({ seconds }) => useLiveCountdown(seconds),
        { initialProps: { seconds: 2 as number | undefined | null } },
      );
      act(() => vi.advanceTimersByTime(1_000));
      expect(result.current).toBe(1);
      rerender({ seconds: stopped });
      expect(result.current).toBe(0);
      act(() => vi.advanceTimersByTime(5_000));
      expect(result.current).toBe(0);
    },
  );

  it("accepts small extensions and reductions from a fresh remaining-time snapshot", () => {
    const { result, rerender } = renderHook(
      ({ seconds }) => useLiveCountdown(seconds),
      { initialProps: { seconds: 10 } },
    );
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(9);

    rerender({ seconds: 11 });
    expect(result.current).toBe(11);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(10);

    rerender({ seconds: 9 });
    expect(result.current).toBe(9);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(8);
  });

  it("does not restart an unchanged snapshot on unrelated rerenders", () => {
    const { result, rerender } = renderHook(() => useLiveCountdown(2));
    act(() => vi.advanceTimersByTime(500));
    rerender();
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe(1);
    rerender();
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(0);
  });

  it("uses elapsed wall time when interval callbacks are delayed", () => {
    const { result } = renderHook(() => useLiveCountdown(30));
    act(() => {
      setSystemTime(Date.now() + 59_000);
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(0);
  });

  it("counts down render-derived remainders with the caller's server clock offset", () => {
    const deadline = new Date(BASE + 2_000);
    const { result, rerender } = renderHook(
      ({ timeDiff }) =>
        useLiveCountdown(getRemainingStealthCooldown(deadline, timeDiff)),
      { initialProps: { timeDiff: 3_000 } },
    );
    expect(result.current).toBe(5);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toBe(4);
    rerender({ timeDiff: 4_000 });
    expect(result.current).toBe(5);
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current).toBe(0);
  });

  it("cleans up the running interval on unmount", () => {
    const clearInterval = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useLiveCountdown(10));
    unmount();
    expect(clearInterval).toHaveBeenCalledTimes(1);
  });
});
