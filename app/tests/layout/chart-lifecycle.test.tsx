import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as chartLibrary from "chart.js/auto";
import type { Chart } from "chart.js";
import * as client from "@/app/_trpc/client";
import { CombatStatNames, MasteryNames } from "@/drizzle/constants";
import { BloodlineStatistics } from "@/layout/BloodlineStatistics";
import { GraphsTab } from "@/layout/StrengthWeaknesses";
import type { UserWithRelations } from "@/routers/profile";
import { LayoutContextProvider } from "@/utils/LayoutContext";

const chartDefaults = chartLibrary.Chart.defaults;
const browserGlobals = ["Event", "CustomEvent", "ResizeObserver"] as const;
const browserDescriptors = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
let charts: { destroy: ReturnType<typeof vi.fn> }[];
let attempts: number;
let failAt: number | undefined;
const statistics = { S: 20, none: 80 };
const user = {
  ...Object.fromEntries([...CombatStatNames, ...MasteryNames].map((name) => [name, 100])),
  rank: "JONIN",
  primaryElement: null,
  secondaryElement: null,
  bloodline: null,
  elementalMastery: {},
} as NonNullable<UserWithRelations>;

beforeEach(() => {
  Object.defineProperties(globalThis, {
    Event: { configurable: true, value: window.Event },
    CustomEvent: { configurable: true, value: window.CustomEvent },
    ResizeObserver: { configurable: true, value: class { observe() {} unobserve() {} disconnect() {} } },
  });
  charts = [];
  attempts = 0;
  failAt = undefined;
  const constructor = vi.spyOn(chartLibrary, "Chart").mockImplementation(
    function () {
      attempts += 1;
      if (attempts === failAt) throw new Error("Chart initialization failed");
      const chart = { destroy: vi.fn() };
      charts.push(chart);
      return chart as unknown as Chart;
    } as never,
  );
  Object.assign(constructor, { defaults: { ...chartDefaults } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({}) as never);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  Object.assign(vi.spyOn(client, "api" as never), {
    bloodline: { getNaturalRollStatistics: { useQuery: () => ({ data: statistics, isLoading: false }) } },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  browserGlobals.forEach((key, index) => {
    const descriptor = browserDescriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});

describe("profile chart lifetime", () => {
  it("destroys both charts when data changes and when the tab unmounts", async () => {
    const view = render(<GraphsTab userData={user} />);
    await waitFor(() => expect(charts).toHaveLength(2));
    view.rerender(<GraphsTab userData={{ ...user, offence: 200 }} />);
    expect(charts[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(charts[1]?.destroy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(charts).toHaveLength(4));
    view.unmount();
    expect(charts[2]?.destroy).toHaveBeenCalledTimes(1);
    expect(charts[3]?.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not create charts if the tab unmounts before the import resolves", async () => {
    const view = render(<GraphsTab userData={user} />);
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(charts).toHaveLength(0);
  });

  it("draws only the newest theme when it changes during the import", async () => {
    const view = render(
      <LayoutContextProvider value="default" isPixelLanding={false}>
        <GraphsTab userData={user} />
      </LayoutContextProvider>,
    );
    view.rerender(
      <LayoutContextProvider value="pixel" isPixelLanding={false}>
        <GraphsTab userData={user} />
      </LayoutContextProvider>,
    );
    await waitFor(() => expect(charts).toHaveLength(2));
    expect(attempts).toBe(2);
    expect(chartLibrary.Chart.defaults.color).toBe("#FFFFFF");
  });

  it("cleans up a partial draw and offers the Stats tab after failure", async () => {
    failAt = 2;
    const view = render(<GraphsTab userData={user} />);
    expect((await view.findByRole("alert")).textContent).toContain("Select Stats");
    expect(charts).toHaveLength(1);
    expect(charts[0]?.destroy).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(charts[0]?.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("statistics popover chart lifetime", () => {
  const mount = () => render(<BloodlineStatistics trigger={<button type="button">Roll Statistics</button>} />);

  it("draws only while open, survives debug toggles, and redraws after reopening", async () => {
    const view = mount();
    expect(charts).toHaveLength(0);
    const trigger = view.getByRole("button", { name: "Roll Statistics" });
    fireEvent.click(trigger);
    await waitFor(() => expect(charts).toHaveLength(1));
    const debug = view.getByRole("dialog").querySelector("button");
    expect(debug).not.toBeNull();
    fireEvent.click(debug!);
    await act(async () => { await Promise.resolve(); });
    expect(charts).toHaveLength(1);
    fireEvent.click(trigger);
    await waitFor(() => expect(charts[0]?.destroy).toHaveBeenCalledTimes(1));
    fireEvent.click(trigger);
    await waitFor(() => expect(charts).toHaveLength(2));
    view.unmount();
    expect(charts[1]?.destroy).toHaveBeenCalledTimes(1);
  });

  it("cancels a draw if closed before the import resolves", async () => {
    const view = mount();
    const trigger = view.getByRole("button", { name: "Roll Statistics" });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    await act(async () => { await Promise.resolve(); });
    expect(charts).toHaveLength(0);
  });

  it("shows an actionable failure and retries after reopening", async () => {
    failAt = 1;
    const view = mount();
    const trigger = view.getByRole("button", { name: "Roll Statistics" });
    fireEvent.click(trigger);
    expect((await view.findByRole("alert")).textContent).toContain("Close and reopen");
    fireEvent.click(trigger);
    failAt = undefined;
    fireEvent.click(trigger);
    await waitFor(() => expect(charts).toHaveLength(1));
    expect(view.queryByRole("alert")).toBeNull();
  });
});
