import { Chart as ChartJS } from "chart.js/auto";
import type React from "react";
import { useEffect, useRef } from "react";
import { ClearDataConfirm } from "@/layout/ClearDataConfirm";
import ContentBox from "@/layout/ContentBox";
import { groupBy } from "@/utils/grouping";
import { canChangeContent } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";

/**
 * Statistics box drawing one side-by-side bar series per group over a numeric x axis, with
 * a filter slot and, for content editors, a confirmed clear action. The caller owns the
 * query and the clear mutation.
 *
 * The chart redraws when `rows` changes identity, so pass query data as it comes back and
 * keep `toPoint` a plain mapping of one row. Rows with no data show `emptyText` instead.
 */
export const GroupedBarHistogram = <Row,>(props: GroupedBarHistogramProps<Row>) => {
  const { rows, toPoint, xLabel, yLabel } = props;
  const chartRef = useRef<HTMLCanvasElement>(null);
  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));
  const canClear = canChangeContent(userData?.role ?? "USER");

  useEffect(() => {
    const ctx = chartRef?.current?.getContext("2d");
    if (ctx && rows && rows.length > 0) {
      const myChart = new ChartJS(ctx, {
        type: "bar",
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: "top" as const,
            },
            tooltip: {
              mode: "index" as const,
              intersect: false,
            },
          },
          scales: {
            x: {
              type: "linear" as const,
              position: "bottom" as const,
              title: {
                display: true,
                text: xLabel,
              },
              ticks: {
                stepSize: 1,
              },
            },
            y: {
              type: "linear" as const,
              title: {
                display: true,
                text: yLabel,
              },
            },
          },
          interaction: {
            mode: "nearest" as const,
            axis: "x" as const,
            intersect: false,
          },
        },
        data: buildGroupedBarData(rows.map(toPoint)),
      });

      return () => {
        myChart.destroy();
      };
    }
  }, [rows]);

  return (
    <ContentBox
      title={props.title}
      subtitle={props.subtitle}
      topRightContent={
        <div className="flex items-center gap-2">
          {props.filter}
          {canClear && (
            <ClearDataConfirm title={props.clearTitle} onConfirm={props.onClear}>
              {props.clearText}
            </ClearDataConfirm>
          )}
        </div>
      }
      initialBreak={true}
      padding={false}
    >
      {rows && rows.length > 0 ? (
        <div className="relative h-96 w-full">
          <canvas ref={chartRef} id={props.canvasId}></canvas>
        </div>
      ) : (
        <p className="py-8 text-center text-gray-500">{props.emptyText}</p>
      )}
    </ContentBox>
  );
};

/**
 * Chart data with one dataset per group, in order of first appearance, over the sorted
 * distinct x values. An x missing from a group is a 0 bar; the first point of a duplicate wins.
 */
export const buildGroupedBarData = (points: GroupedBarPoint[]) => {
  const groups = groupBy(points, "group");
  const labels = [...new Set(points.map((point) => point.x))].sort((a, b) => a - b);
  const datasets = [...groups.entries()].map(([group, items], index) => {
    const color = HISTOGRAM_COLORS[index % HISTOGRAM_COLORS.length];
    return {
      label: group,
      data: labels.map((x) => items.find((item) => item.x === x)?.y ?? 0),
      backgroundColor: `${color}80`, // Add transparency
      borderColor: color,
      borderWidth: 1,
    };
  });
  return { labels, datasets };
};

const HISTOGRAM_COLORS = [
  "#3e95cd",
  "#8e5ea2",
  "#3cba9f",
  "#e8c3b9",
  "#c45850",
  "#ff6384",
  "#36a2eb",
  "#ffce56",
  "#4bc0c0",
  "#9966ff",
];

export type GroupedBarPoint = { group: string; x: number; y: number };

interface GroupedBarHistogramProps<Row> {
  title: string;
  subtitle: string;
  rows: Row[] | undefined;
  toPoint: (row: Row) => GroupedBarPoint;
  xLabel: string;
  yLabel: string;
  filter: React.ReactNode;
  clearTitle: string;
  clearText: string;
  onClear: () => void;
  emptyText: string;
  canvasId: string;
}
