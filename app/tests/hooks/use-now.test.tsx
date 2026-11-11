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
import { useNow } from "@/hooks/useNow";

const START = Date.UTC(2026, 0, 1);

beforeEach(() => {
  vi.useFakeTimers();
  setSystemTime(START);
});
afterEach(() => {
  // Unmounting ends each consumer's subscription to the shared clock.
  cleanup();
  vi.useRealTimers();
  setSystemTime();
});

describe("useNow", () => {
  it("ticks on its interval", () => {
    const { result } = renderHook(() => useNow(1000));
    expect(result.current).toBe(START);
    act(() => vi.advanceTimersByTime(2500));
    expect(result.current).toBe(START + 2000);
  });

  it("stops while disabled and re-reads the clock when enabled again", () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useNow(1000, { enabled }),
      { initialProps: { enabled: false } },
    );
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(START);
    rerender({ enabled: true });
    expect(result.current).toBe(START + 5000);
  });

  it("shares one boundary-aligned ticker between consumers", () => {
    const first = renderHook(() => useNow(1000));
    act(() => vi.advanceTimersByTime(400));
    const second = renderHook(() => useNow(1000));
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(600));
    expect(first.result.current).toBe(START + 1000);
    expect(second.result.current).toBe(START + 1000);
    first.unmount();
    expect(vi.getTimerCount()).toBe(1);
    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its interval on unmount", () => {
    const { unmount } = renderHook(() => useNow(1000));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
