import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as chartLibrary from "chart.js/auto";
import { useRef, useState } from "react";
import { useLazyChart } from "@/hooks/useLazyChart";

type Draw = Parameters<typeof useLazyChart>[1];

let failures: boolean[];

const Chart = ({ draw, data }: { draw: Draw; data: number }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  failures.push(useLazyChart(canvas, draw, [data]));
  return <canvas ref={canvas} />;
};

/** Replaces its canvas on failure, as the hook's callers do. */
const FallbackChart = ({ draw, data }: { draw: Draw; data: number }) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const failed = useLazyChart(canvas, draw, [data]);
  return failed ? <p role="status">Unavailable</p> : <canvas ref={canvas} />;
};

const chartHandle = () => ({ destroy: vi.fn() });

beforeEach(() => {
  failures = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useLazyChart", () => {
  it("hands the constructor and canvas to the draw, and destroys the chart on unmount", async () => {
    const chart = chartHandle();
    const draw = vi.fn((_: typeof chartLibrary.Chart, __: HTMLCanvasElement) => chart);
    const view = render(<Chart draw={draw} data={1} />);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
    expect(draw.mock.calls[0]?.[0]).toBe(chartLibrary.Chart);
    expect(draw.mock.calls[0]?.[1]).toBe(
      view.container.querySelector("canvas") as HTMLCanvasElement,
    );
    view.unmount();
    expect(chart.destroy).toHaveBeenCalledTimes(1);
  });

  it("redraws on a dependency change and ignores a new draw closure alone", async () => {
    const charts = [chartHandle(), chartHandle()];
    const draw = vi.fn(() => charts[draw.mock.calls.length - 1] ?? chartHandle());
    const view = render(<Chart draw={draw} data={1} />);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
    view.rerender(<Chart draw={() => draw()} data={1} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(draw).toHaveBeenCalledTimes(1);
    view.rerender(<Chart draw={draw} data={2} />);
    expect(charts[0]?.destroy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(2));
  });

  it("does not draw a run superseded or unmounted during the import", async () => {
    const draw = vi.fn(chartHandle);
    const view = render(<Chart draw={draw} data={1} />);
    view.rerender(<Chart draw={draw} data={2} />);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));

    const unmounted = vi.fn(chartHandle);
    render(<Chart draw={unmounted} data={1} />).unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("skips loading while there is nothing to draw", async () => {
    const view = render(<Chart draw={null} data={1} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(failures.every((failed) => !failed)).toBe(true);
    const draw = vi.fn(chartHandle);
    view.rerender(<Chart draw={draw} data={2} />);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
  });

  it("reports a failed draw and clears it on the next run", async () => {
    const view = render(
      <Chart
        draw={() => {
          throw new Error("Draw failed");
        }}
        data={1}
      />,
    );
    await waitFor(() => expect(failures.at(-1)).toBe(true));
    const draw = vi.fn(chartHandle);
    view.rerender(<Chart draw={draw} data={2} />);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
    expect(failures.at(-1)).toBe(false);
  });

  it("restores a canvas replaced by the fallback before the next run draws", async () => {
    const chart = chartHandle();
    const draw = vi.fn((_: typeof chartLibrary.Chart, __: HTMLCanvasElement) => chart);
    let setData: (data: number) => void = () => undefined;
    const Retried = () => {
      const [data, set] = useState(1);
      setData = set;
      const failing: Draw = () => {
        throw new Error("Draw failed");
      };
      return <FallbackChart draw={data === 1 ? failing : draw} data={data} />;
    };
    const view = render(<Retried />);
    await waitFor(() => expect(view.getByRole("status")).toBeTruthy());
    expect(view.container.querySelector("canvas")).toBeNull();

    // A data update outside act commits on the scheduler, so an already loaded chunk resolves
    // before any state set by the effect could put the canvas back.
    setData(2);
    await waitFor(() => expect(draw).toHaveBeenCalledTimes(1));
    expect(draw.mock.calls[0]?.[1]).toBe(
      view.container.querySelector("canvas") as HTMLCanvasElement,
    );
    expect(view.queryByRole("status")).toBeNull();
  });

  it("keeps the fallback while a rerender leaves the failed deps unchanged", async () => {
    const failing: Draw = () => {
      throw new Error("Draw failed");
    };
    const view = render(<FallbackChart draw={failing} data={1} />);
    await waitFor(() => expect(view.getByRole("status")).toBeTruthy());
    const draw = vi.fn(chartHandle);
    view.rerender(<FallbackChart draw={draw} data={1} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.getByRole("status")).toBeTruthy();
    expect(draw).not.toHaveBeenCalled();
  });

  it("does not retry a failed draw on its own", async () => {
    const view = render(<FallbackChart draw={chartHandle} data={1} />);
    await waitFor(() => expect(view.container.querySelector("canvas")).toBeTruthy());
    const failing = vi.fn<NonNullable<Draw>>(() => {
      throw new Error("Draw failed");
    });
    view.rerender(<FallbackChart draw={failing} data={2} />);
    await waitFor(() => expect(view.getByRole("status")).toBeTruthy());
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
