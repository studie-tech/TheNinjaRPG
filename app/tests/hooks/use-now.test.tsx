import { act, renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  vi,
} from "bun:test";
import { useNow } from "@/hooks/useNow";

const START = Date.UTC(2026, 0, 1);

beforeEach(() => {
  vi.useFakeTimers();
  setSystemTime(START);
});
afterEach(() => {
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

  it("clears its interval on unmount", () => {
    const { unmount } = renderHook(() => useNow(1000));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
