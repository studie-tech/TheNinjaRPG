import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  vi,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import Countdown from "@/layout/Countdown";

const BASE = Date.UTC(2026, 8, 16, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  setSystemTime(BASE);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Countdown", () => {
  it("does not report done or call onFinish while a sub-second remainder is left", () => {
    const onFinish = vi.fn();
    const view = render(
      <Countdown targetDate={new Date(BASE + 1_500)} onFinish={onFinish} />,
    );

    // 1000 ms in: 500 ms remain. Every floored part reads 0, but the timer is not over.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(onFinish).not.toHaveBeenCalled();
    expect(view.queryByText("Done")).toBeNull();
    expect(view.getByText("0 seconds")).toBeTruthy();
  });

  it("reports done and calls onFinish exactly once when the target time is reached", () => {
    const onFinish = vi.fn();
    const view = render(
      <Countdown targetDate={new Date(BASE + 1_500)} onFinish={onFinish} />,
    );

    act(() => {
      vi.advanceTimersByTime(1_500);
    });

    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(view.getByText("Done")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("treats a target already in the past as done on mount", () => {
    const onFinish = vi.fn();
    const view = render(
      <Countdown targetDate={new Date(BASE - 1)} onFinish={onFinish} />,
    );

    expect(view.getByText("Done")).toBeTruthy();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("applies timeDiff to a server-supplied target", () => {
    const onFinish = vi.fn();
    // Server clock is 2 s behind the client, so a server target 500 ms "ahead" is
    // 2.5 s ahead on the client clock.
    render(
      <Countdown
        targetDate={new Date(BASE + 500)}
        timeDiff={2_000}
        onFinish={onFinish}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onFinish).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
