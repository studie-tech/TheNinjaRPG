import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { TowerDefenseOverlay } from "@/layout/TowerDefenseHud";
import { createRun } from "@/libs/towerDefense/sim";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
});

afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
});

const renderOverlay = (pausedByPlayer: boolean) => {
  const onPause = vi.fn();
  const onPanel = vi.fn();
  const view = render(
    <TowerDefenseOverlay
      state={createRun({
        seed: "pause",
        startWave: 1,
        bestWave: 0,
        level: 1,
        dojo: {},
      })}
      speed={1}
      soundOn={false}
      mode="aim"
      isFullscreen={false}
      pausedByPlayer={pausedByPlayer}
      onSpeed={() => undefined}
      onSound={() => undefined}
      onFullscreen={() => undefined}
      onPause={onPause}
      onPanel={onPanel}
      act={() => undefined}
    />,
  );
  return { view, onPause, onPanel };
};

describe("TowerDefenseOverlay pause", () => {
  it("pauses from its button and resumes from the paused banner", () => {
    const running = renderOverlay(false);
    expect(running.view.queryByText(/Paused, tap to resume/)).toBeNull();
    fireEvent.click(running.view.getByLabelText("Pause (P)"));
    expect(running.onPause).toHaveBeenCalledWith(true);
    cleanup();

    const paused = renderOverlay(true);
    fireEvent.click(paused.view.getByText(/Paused, tap to resume/));
    expect(paused.onPause).toHaveBeenCalledWith(false);
    fireEvent.click(paused.view.getByLabelText("Resume (P)"));
    expect(paused.onPause).toHaveBeenLastCalledWith(false);
  });

  it("holds the run while the boosts panel is open", () => {
    const { view, onPanel } = renderOverlay(false);
    fireEvent.click(view.getByLabelText("Active boosts"));
    expect(onPanel).toHaveBeenLastCalledWith(true);
    fireEvent.click(view.getByLabelText("Active boosts"));
    expect(onPanel).toHaveBeenLastCalledWith(false);
  });
});
