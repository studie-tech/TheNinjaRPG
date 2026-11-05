"use client";

import { Chart as ChartJS } from "chart.js/auto";
import { useEffect, useRef } from "react";

export function CountsChart(props: CountsChartProps) {
  const classChartRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const classCtx = classChartRef?.current?.getContext("2d");
    if (classCtx) {
      const data = Object.entries(props.data || {});
      const myClassChart = new ChartJS(classCtx, {
        type: "bar",
        options: rotatedBarOptions(false),
        data: {
          labels: data.map(([text]) => text),
          datasets: [
            {
              data: data.map(([, value]) => value),
              borderWidth: 1,
            },
          ],
        },
      });
      // Remove on unmount
      return () => {
        myClassChart.destroy();
      };
    }
  }, [props.data]);

  return (
    <div className="relative w-[99%] p-3">
      <canvas ref={classChartRef}></canvas>
    </div>
  );
}

export function StackedCountsChart(props: StackedCountsChartProps) {
  const stackedChartRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const stackedCtx = stackedChartRef?.current?.getContext("2d");
    if (stackedCtx && props.data) {
      const effectTypes = Object.keys(props.data);
      const calculations = Array.from(
        new Set(Object.values(props.data).flatMap((calcObj) => Object.keys(calcObj))),
      );

      const datasets = calculations.map((calculation, index) => {
        const colors = [
          "#FF6384",
          "#36A2EB",
          "#FFCE56",
          "#4BC0C0",
          "#9966FF",
          "#FF9F40",
        ];
        return {
          label: calculation,
          data: effectTypes.map(
            (effectType) => props.data?.[effectType]?.[calculation] || 0,
          ),
          backgroundColor: colors[index % colors.length],
          borderColor: colors[index % colors.length],
          borderWidth: 1,
        };
      });

      const myStackedChart = new ChartJS(stackedCtx, {
        type: "bar",
        options: rotatedBarOptions(true),
        data: {
          labels: effectTypes,
          datasets: datasets,
        },
      });

      // Remove on unmount
      return () => {
        myStackedChart.destroy();
      };
    }
  }, [props.data]);

  return (
    <div className="relative w-[99%] p-3">
      <canvas ref={stackedChartRef}></canvas>
    </div>
  );
}

/** Bars with vertical labels; a stacked chart also needs its legend to read the series. */
const rotatedBarOptions = (stacked: boolean) => ({
  maintainAspectRatio: false,
  responsive: true,
  aspectRatio: 1.1,
  scales: {
    x: {
      ticks: {
        maxRotation: 90,
        minRotation: 90,
        autoSkip: false,
      },
      stacked,
    },
    y: {
      beginAtZero: true,
      stacked,
    },
  },
  plugins: {
    legend: {
      display: stacked,
    },
  },
});

interface CountsChartProps {
  data: Record<string, number> | undefined;
}

interface StackedCountsChartProps {
  data: Record<string, Record<string, number>> | undefined;
}
