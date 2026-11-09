import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { PoolStatusBars } from "@/layout/PoolStatusBars";
import StatusBar from "@/layout/StatusBar";

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(new Date().getTime());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StatusBar capacity changes", () => {
  it.each([2800, 2600])(
    "updates a full bar when capacity falls and current is %s",
    (current) => {
      const regenAt = new Date();
      const view = render(
        <StatusBar
          title="EP"
          color="bg-violet-500"
          showText
          status="AWAKE"
          regen={20}
          lastRegenAt={regenAt}
          current={2800}
          total={2800}
        />,
      );
      expect(view.getByText("EP (2800 / 2800)")).toBeTruthy();
      view.rerender(
        <StatusBar
          title="EP"
          color="bg-violet-500"
          showText
          status="AWAKE"
          regen={20}
          lastRegenAt={regenAt}
          current={current}
          total={2600}
        />,
      );
      expect(view.getByText("EP (2600 / 2600)")).toBeTruthy();
    },
  );

  it("keeps elapsed regeneration when capacity changes", () => {
    const regenAt = new Date(Date.now() - 120_000);
    const view = render(
      <StatusBar
        title="EP"
        color="bg-violet-500"
        showText
        status="AWAKE"
        regen={200}
        lastRegenAt={regenAt}
        current={2000}
        total={2800}
      />,
    );
    expect(view.getByText("EP (2400 / 2800) (60s)")).toBeTruthy();
    view.rerender(
      <StatusBar
        title="EP"
        color="bg-violet-500"
        showText
        status="AWAKE"
        regen={200}
        lastRegenAt={regenAt}
        current={2000}
        total={3000}
      />,
    );
    expect(view.getByText("EP (2400 / 3000) (60s)")).toBeTruthy();
  });
});

describe("PoolStatusBars", () => {
  const pools = {
    curHealth: 10,
    maxHealth: 100,
    curChakra: 20,
    maxChakra: 200,
    curStamina: 30,
    maxStamina: 300,
  };

  it("renders HP, CP and SP in order from their own pools", () => {
    const view = render(<PoolStatusBars pools={pools} status="AWAKE" />);
    expect(view.container.textContent).toBe("HP (10 / 100)CP (20 / 200)SP (30 / 300)");
    const fills = [
      ...view.container.querySelectorAll(".bg-red-500, .bg-blue-500, .bg-green-500"),
    ];
    expect(fills.map((fill) => fill.className)).toEqual([
      expect.stringContaining("bg-red-500"),
      expect.stringContaining("bg-blue-500"),
      expect.stringContaining("bg-green-500"),
    ]);
  });

  it("remounts a bar on pool changes only when asked", () => {
    const bars = (remountOnChange: boolean, curHealth: number) => (
      <PoolStatusBars
        pools={{ ...pools, curHealth }}
        status="AWAKE"
        remountOnChange={remountOnChange}
      />
    );
    const firstBar = (view: ReturnType<typeof render>) =>
      view.container.firstElementChild;

    const kept = render(bars(false, 10));
    const keptBar = firstBar(kept);
    kept.rerender(bars(false, 11));
    expect(firstBar(kept)).toBe(keptBar);
    cleanup();

    const remounted = render(bars(true, 10));
    const remountedBar = firstBar(remounted);
    remounted.rerender(bars(true, 11));
    expect(firstBar(remounted)).not.toBe(remountedBar);
  });
});
