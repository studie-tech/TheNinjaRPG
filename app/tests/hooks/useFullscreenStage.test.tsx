import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useFullscreenStage } from "@/hooks/useFullscreenStage";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "fullscreenElement");
  Reflect.deleteProperty(document, "exitFullscreen");
  restoreBrowserGlobals();
  vi.restoreAllMocks();
});

const Stage = () => {
  const stage = useFullscreenStage();
  return (
    <div data-testid="frame" style={{ position: "relative", zIndex: 10 }}>
      <div
        ref={stage.setStageElement}
        data-testid="stage"
        data-full={stage.isFullscreen}
      >
        <button type="button" onClick={stage.toggle}>
          toggle
        </button>
      </div>
    </div>
  );
};

describe("useFullscreenStage", () => {
  it("fills the screen above a confining ancestor and hands everything back on exit", () => {
    const view = render(<Stage />);
    const stage = view.getByTestId("stage");
    const frame = view.getByTestId("frame");
    const request = vi.fn(() => Promise.reject(new Error("not allowed")));
    Object.assign(stage, { requestFullscreen: request });

    fireEvent.click(view.getByText("toggle"));
    expect(stage.dataset.full).toBe("true");
    expect(request).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe("hidden");
    // The z-indexed ancestor stands down so the stage can cover the site's header.
    expect(frame.style.zIndex).toBe("auto");

    fireEvent.click(view.getByText("toggle"));
    expect(stage.dataset.full).toBe("false");
    expect(document.body.style.overflow).toBe("");
    expect(frame.style.zIndex).toBe("10");
  });

  it("leaves on Escape when the browser did not enter fullscreen", () => {
    const view = render(<Stage />);
    fireEvent.click(view.getByText("toggle"));
    act(() => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(view.getByTestId("stage").dataset.full).toBe("false");
  });

  it("hands back a fullscreen request that lands after the player left", async () => {
    const view = render(<Stage />);
    const stage = view.getByTestId("stage");
    let grant: () => void = () => undefined;
    const request = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          grant = () => {
            Object.defineProperty(document, "fullscreenElement", {
              configurable: true,
              value: stage,
            });
            resolve();
          };
        }),
    );
    const release = vi.fn(() => Promise.resolve());
    Object.assign(stage, { requestFullscreen: request });
    Object.assign(document, { exitFullscreen: release });

    fireEvent.click(view.getByText("toggle"));
    fireEvent.click(view.getByText("toggle"));
    expect(release).not.toHaveBeenCalled();
    await act(async () => {
      grant();
      await Promise.resolve();
    });
    expect(release).toHaveBeenCalledTimes(1);
    expect(stage.dataset.full).toBe("false");
  });
});
