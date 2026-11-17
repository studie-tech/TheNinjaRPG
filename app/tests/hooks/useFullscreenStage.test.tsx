import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useFullscreenStage } from "@/hooks/useFullscreenStage";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
});

afterEach(() => {
  cleanup();
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
});
