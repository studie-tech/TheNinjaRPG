import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { Profiler, StrictMode } from "react";
import Countdown from "@/layout/Countdown";

const BASE = Date.UTC(2026, 9, 26, 12);
let now = BASE;

const advance = (milliseconds: number) => {
  now += milliseconds;
  act(() => vi.advanceTimersByTime(milliseconds));
};

beforeEach(() => {
  now = BASE;
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Countdown completion", () => {
  it("updates clock text without React renders and reconciles the completion UI once", () => {
    const rendered = vi.fn(),
      finished = vi.fn();
    const view = render(
      <Profiler id="countdown" onRender={rendered}>
        <Countdown
          targetDate={new Date(BASE + 3000)}
          onFinish={finished}
          onEndShow="Ready"
        />
      </Profiler>,
    );
    const label = view.container.querySelector("span")!;
    const initial = label.textContent;
    rendered.mockClear();
    advance(1000);
    expect(label.textContent).not.toBe(initial);
    expect(rendered).not.toHaveBeenCalled();
    expect(finished).not.toHaveBeenCalled();
    advance(2000);
    expect(view.getByText("Ready")).toBeTruthy();
    expect(rendered).toHaveBeenCalledTimes(1);
    expect(finished).toHaveBeenCalledTimes(1);
  });
  it("renders the time left through a custom format until the deadline", () => {
    const view = render(
      <Countdown targetDate={new Date(BASE + 3000)} format={(ms) => `[${ms}]`} />,
    );
    const label = view.container.querySelector("span")!;
    expect(label.textContent).toBe("[3000]");
    advance(1000);
    expect(label.textContent).toBe("[2000]");
    advance(2000);
    expect(view.container.textContent).toBe("Done");
  });

  it("waits for the actual deadline and calls the latest callback once", () => {
    const previous = vi.fn();
    const latest = vi.fn();
    const targetDate = new Date(BASE + 999);
    const view = render(<Countdown targetDate={targetDate} onFinish={previous} />);
    advance(500);
    expect(previous).not.toHaveBeenCalled();
    view.rerender(
      <Countdown targetDate={targetDate} onFinish={latest} onEndShow="Ready" />,
    );
    advance(500);
    expect(view.getByText("Ready")).toBeTruthy();
    expect(previous).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    advance(2_000);
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("does not finish the same deadline twice after clock recalibration or Strict Mode effects", () => {
    const onFinish = vi.fn();
    const targetDate = new Date(BASE - 1_000);
    const view = render(
      <StrictMode>
        <Countdown targetDate={targetDate} onFinish={onFinish} />
      </StrictMode>,
    );
    expect(onFinish).toHaveBeenCalledTimes(1);
    view.rerender(
      <StrictMode>
        <Countdown targetDate={targetDate} timeDiff={2_000} onFinish={onFinish} />
      </StrictMode>,
    );
    advance(1_000);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("recognizes a new raw deadline even if its adjusted time is unchanged", () => {
    const onFinish = vi.fn();
    const view = render(
      <Countdown targetDate={new Date(BASE - 1_000)} onFinish={onFinish} />,
    );
    expect(onFinish).toHaveBeenCalledTimes(1);
    view.rerender(
      <Countdown
        targetDate={new Date(BASE - 2_000)}
        timeDiff={1_000}
        onFinish={onFinish}
      />,
    );
    expect(onFinish).toHaveBeenCalledTimes(2);
  });

  it("starts a replacement countdown and clears its interval on unmount", () => {
    const onFinish = vi.fn();
    const view = render(
      <Countdown targetDate={new Date(BASE - 1_000)} onFinish={onFinish} />,
    );
    view.rerender(
      <Countdown targetDate={new Date(BASE + 2_000)} onFinish={onFinish} />,
    );
    expect(view.queryByText("Done")).toBeNull();
    advance(1_000);
    expect(onFinish).toHaveBeenCalledTimes(1);
    const clear = vi.spyOn(globalThis, "clearInterval");
    view.unmount();
    expect(clear).toHaveBeenCalled();
    advance(3_000);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
