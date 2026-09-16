import { ensureDom } from "../setup-dom.mjs";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Countdown from "@/layout/Countdown";

ensureDom();

const BASE = new Date("2026-09-16T12:00:00.000Z").getTime();

describe("Countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not report done or call onFinish while a sub-second remainder is left", () => {
    const onFinish = vi.fn();
    render(<Countdown targetDate={new Date(BASE + 1_500)} onFinish={onFinish} />);

    // 1000 ms in: 500 ms remain. Every floored part reads 0, but the timer is not over.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(onFinish).not.toHaveBeenCalled();
    expect(screen.queryByText("Done")).toBeNull();
    expect(screen.getByText("0 seconds")).toBeTruthy();
  });

  it("reports done and calls onFinish exactly once when the target time is reached", () => {
    const onFinish = vi.fn();
    render(<Countdown targetDate={new Date(BASE + 1_500)} onFinish={onFinish} />);

    act(() => {
      vi.advanceTimersByTime(1_500);
    });

    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Done")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("treats a target already in the past as done on mount", () => {
    const onFinish = vi.fn();
    render(<Countdown targetDate={new Date(BASE - 1)} onFinish={onFinish} />);

    expect(screen.getByText("Done")).toBeTruthy();
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("applies timeDiff to a server-supplied target", () => {
    const onFinish = vi.fn();
    // Server clock is 2 s behind the client, so a server target 500 ms "ahead" is
    // 2.5 s ahead on the client clock.
    render(
      <Countdown targetDate={new Date(BASE + 500)} timeDiff={2_000} onFinish={onFinish} />,
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
