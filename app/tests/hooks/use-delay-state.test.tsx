import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useDelayState } from "@/hooks/useDelayState";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useDelayState", () => {
  it("updates the immediate value at once and the debounced value after the delay", () => {
    const { result } = renderHook(() => useDelayState("a", 400));
    act(() => result.current[2]("b"));
    expect(result.current[0]).toBe("b");
    expect(result.current[1]).toBe("a");
    act(() => vi.advanceTimersByTime(399));
    expect(result.current[1]).toBe("a");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current[1]).toBe("b");
  });

  it("applies updater functions against the latest value", () => {
    const { result } = renderHook(() => useDelayState(1));
    act(() => {
      result.current[2]((previous) => previous + 1);
      result.current[2]((previous) => previous * 10);
    });
    expect(result.current[0]).toBe(20);
    act(() => vi.advanceTimersByTime(500));
    expect(result.current[1]).toBe(20);
  });

  it("keeps a stable setter across renders", () => {
    const { result } = renderHook(() => useDelayState<string[]>([]));
    const setter = result.current[2];
    act(() => setter(["x"]));
    expect(result.current[2]).toBe(setter);
    expect(result.current[0]).toEqual(["x"]);
  });
});
