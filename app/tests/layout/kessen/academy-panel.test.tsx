import { afterEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AcademyPanel } from "@/layout/kessen/hub/AcademyPanel";
import { academyProgress, KESSEN_ACADEMY } from "@/libs/kessen/academy";

const allDone = Object.fromEntries(KESSEN_ACADEMY.map((lesson) => [lesson.key, ""]));

const renderPanel = (academy: ReturnType<typeof academyProgress>) => {
  const onStart = vi.fn();
  render(
    <AcademyPanel
      academy={academy}
      pending={false}
      startingKey={null}
      error={null}
      onStart={onStart}
    />,
  );
  return onStart;
};

describe("Lemu's Academy panel", () => {
  afterEach(cleanup);

  it("leads with the next lesson until the series is done", () => {
    renderPanel(academyProgress({ "first-blood": "" }, null));
    expect(screen.getByRole("button", { name: "Start lesson 2" })).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Replay a lesson/ })).toBe(null);
  });

  it("folds a graduate's Academy to one row that replays lessons on request", () => {
    const onStart = renderPanel(academyProgress(allDone, "graduation-match"));
    expect(screen.queryByRole("progressbar")).toBe(null);
    expect(screen.queryByRole("button", { name: /Start lesson/ })).toBe(null);
    expect(screen.getByText(/All 6 lessons done/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Replay a lesson/ }));
    fireEvent.click(screen.getByRole("button", { name: /Replay lesson 3/ }));
    expect(onStart).toHaveBeenCalledWith("cut-the-root");
  });
});
