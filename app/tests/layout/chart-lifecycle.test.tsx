import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { Chart } from "chart.js";
import * as chartLibrary from "chart.js/auto";
import * as client from "@/app/_trpc/client";
import { CombatStatNames, MasteryNames } from "@/drizzle/constants";
import { BloodlineStatistics } from "@/layout/BloodlineStatistics";
import { GraphsTab } from "@/layout/StrengthWeaknesses";
import type { UserWithRelations } from "@/routers/profile";
import { LayoutContextProvider } from "@/utils/LayoutContext";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const chartDefaults = chartLibrary.Chart.defaults;
let charts: { destroy: ReturnType<typeof vi.fn> }[];
let attempts: number;
let failAt: number | undefined;
const statistics = { S: 20, none: 80 };
const user = {
  ...Object.fromEntries(
    [...CombatStatNames, ...MasteryNames].map((name) => [name, 100]),
  ),
  rank: "JONIN",
  primaryElement: null,
  secondaryElement: null,
  bloodline: null,
  elementalMastery: {},
} as NonNullable<UserWithRelations>;

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  charts = [];
  attempts = 0;
  failAt = undefined;
  const chartConstructor = vi.spyOn(chartLibrary, "Chart").mockImplementation((() => {
    attempts += 1;
    if (attempts === failAt) throw new Error("Chart initialization failed");
    const chart = { destroy: vi.fn() };
    charts.push(chart);
    return chart as unknown as Chart;
  }) as never);
  Object.assign(chartConstructor, { defaults: { ...chartDefaults } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({}) as never,
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  Object.assign(vi.spyOn(client, "api" as never), {
    bloodline: {
      getNaturalRollStatistics: {
        useQuery: () => ({ data: statistics, isLoading: false }),
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
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
    await act(async () => {
      await Promise.resolve();
    });
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
  const mount = () =>
    render(
      <BloodlineStatistics trigger={<button type="button">Roll Statistics</button>} />,
    );

  it("draws only while open, offers no debug controls, and redraws after reopening", async () => {
    const view = mount();
    expect(charts).toHaveLength(0);
    const trigger = view.getByRole("button", { name: "Roll Statistics" });
    fireEvent.click(trigger);
    await waitFor(() => expect(charts).toHaveLength(1));
    expect(view.getByRole("dialog").querySelector("button")).toBeNull();
    expect(view.getByRole("dialog").querySelector("pre")).toBeNull();
    fireEvent.click(trigger);
    await waitFor(() => expect(charts[0]?.destroy).toHaveBeenCalledTimes(1));
    fireEvent.click(trigger);
    await waitFor(() => expect(charts).toHaveLength(2));
    view.unmount();
    expect(charts[1]?.destroy).toHaveBeenCalledTimes(1);
  });

  it("charts and totals each rank except H with its own colour", async () => {
    Object.assign(vi.spyOn(client, "api" as never), {
      bloodline: {
        getNaturalRollStatistics: {
          useQuery: () => ({
            data: { D: 10, C: 20, B: 30, A: 15, S: 5, H: 100, none: 20 },
            isLoading: false,
          }),
        },
      },
    });
    const view = mount();
    fireEvent.click(view.getByRole("button", { name: "Roll Statistics" }));
    await waitFor(() => expect(charts).toHaveLength(1));
    expect(
      view.getByText("Total bloodline rolls:").nextElementSibling?.textContent,
    ).toBe("100");
    const config = (chartLibrary.Chart as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as {
      data: { labels: string[]; datasets: Record<string, unknown>[] };
    };
    expect(config.data.labels).toEqual([
      "S-Rank",
      "A-Rank",
      "B-Rank",
      "C-Rank",
      "D-Rank",
      "No Bloodline",
    ]);
    expect(config.data.datasets[0]).toEqual(
      expect.objectContaining({
        data: [5, 15, 30, 20, 10, 20],
        backgroundColor: [
          "rgba(255, 99, 132, 0.7)",
          "rgba(255, 159, 64, 0.7)",
          "rgba(255, 205, 86, 0.7)",
          "rgba(75, 192, 192, 0.7)",
          "rgba(54, 162, 235, 0.7)",
          "rgba(201, 203, 207, 0.7)",
        ],
        borderColor: [
          "rgb(255, 99, 132)",
          "rgb(255, 159, 64)",
          "rgb(255, 205, 86)",
          "rgb(75, 192, 192)",
          "rgb(54, 162, 235)",
          "rgb(201, 203, 207)",
        ],
      }),
    );
  });

  it("cancels a draw if closed before the import resolves", async () => {
    const view = mount();
    const trigger = view.getByRole("button", { name: "Roll Statistics" });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    await act(async () => {
      await Promise.resolve();
    });
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
