import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import type { Chart } from "chart.js";
import * as chartLibrary from "chart.js";
import WordCloud from "@/layout/Wordcloud";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

let charts: { destroy: ReturnType<typeof vi.fn> }[];

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  vi.useFakeTimers();
  charts = [];
  vi.spyOn(chartLibrary, "Chart").mockImplementation((() => {
    const chart = { destroy: vi.fn() };
    charts.push(chart);
    return chart as unknown as Chart;
  }) as never);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({}) as never,
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

it("clears the drawn cloud when the text no longer has words", () => {
  const view = render(<WordCloud text="Chakra flows through chakra paths" />);
  act(() => vi.advanceTimersByTime(100));
  expect(charts).toHaveLength(1);

  view.rerender(<WordCloud text="" />);
  act(() => vi.advanceTimersByTime(100));
  expect(charts).toHaveLength(1);
  expect(charts[0]?.destroy).toHaveBeenCalledTimes(1);
});
