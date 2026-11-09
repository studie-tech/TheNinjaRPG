import { afterEach, describe, expect, it, vi } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useGameScene } from "@/hooks/game-scene";
import * as telemetry from "@/libs/rendering/telemetry";

const mount = { current: document.createElement("div") };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("game scene failure reporting", () => {
  it("reports an initialization failure once and exposes the error state", async () => {
    const report = vi
      .spyOn(telemetry, "reportRendererFailure")
      .mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("This browser does not support WebGL");
    const { result } = renderHook(() =>
      useGameScene("travel", mount, () => Promise.reject(cause)),
    );
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(report.mock.calls).toEqual([[cause, { surface: "travel", phase: "init" }]]);
  });

  it("reports a frame failure and disposes the live scene", async () => {
    const report = vi
      .spyOn(telemetry, "reportRendererFailure")
      .mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dispose = vi.fn();
    let fail = (_: unknown) => {};
    const { result } = renderHook(() =>
      useGameScene("combat", mount, async (_, __, onError) => {
        fail = onError;
        return { dispose };
      }),
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    const cause = new Error("render failed");
    fail(cause);
    await waitFor(() => expect(result.current.error).toBe(true));
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(report.mock.calls).toEqual([[cause, { surface: "combat", phase: "frame" }]]);
  });

  it("does not report work cancelled by unmounting", async () => {
    const report = vi
      .spyOn(telemetry, "reportRendererFailure")
      .mockImplementation(() => {});
    let reject = (_: unknown) => {};
    const { unmount } = renderHook(() =>
      useGameScene(
        "farm",
        mount,
        () =>
          new Promise<{ dispose: () => void }>((_, rejected) => {
            reject = rejected;
          }),
      ),
    );
    unmount();
    reject(new DOMException("Scene initialization cancelled", "AbortError"));
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();
  });
});
