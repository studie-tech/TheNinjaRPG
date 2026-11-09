"use client";

import type React from "react";
import { useMemo, useRef } from "react";
import { api } from "@/app/_trpc/client";
import { TrainingSpeeds } from "@/drizzle/constants";
import { useLazyChart } from "@/hooks/useLazyChart";
import ContentBox from "@/layout/ContentBox";
import { getEffectiveThemeTextColor } from "@/libs/themePreference";
import { groupBy } from "@/utils/grouping";
import { useActiveLayout } from "@/utils/LayoutContext";

interface TrainingStatsComponentProps {
  userId: string;
  isActive: boolean;
}

/** The x axis of the training log: one point per hour of the day. */
const HOURS_OF_DAY = [...Array(24).keys()];

/** Chart a player's training history, fetching only while its profile tab is active. */
export const UserTrainingLog: React.FC<TrainingStatsComponentProps> = ({
  userId,
  isActive,
}) => {
  // State
  const chartRef = useRef<HTMLCanvasElement>(null);
  const activeLayout = useActiveLayout();

  // Query
  const { data: logEntries } = api.train.getTrainingLog.useQuery(
    { userId },
    { enabled: isActive },
  );

  /**
   * Create dataset for each training speed. Memoized because the draw effect below depends on
   * it: rebuilt on every render it would destroy the chart and start a fresh async draw each
   * time, and the canvas is left blank whenever a cleanup lands after the draw it preceded.
   */
  const datasets = useMemo(() => {
    if (!logEntries) return undefined;
    return TrainingSpeeds.map((speed) => {
      const hourlyEvents = groupBy(
        logEntries
          .filter((e) => e.speed === speed)
          .map((e) => ({
            ...e,
            hourAtDay: e.trainingFinishedAt.getHours(),
          })),
        "hourAtDay",
      );
      return {
        label: speed,
        data: HOURS_OF_DAY.map((i) => {
          const entries = hourlyEvents.get(i) || [];
          return {
            x: i,
            y: entries.length || 0,
            entries: entries,
          };
        }),
      };
    });
  }, [logEntries]);

  const chartFailed = useLazyChart(
    chartRef,
    datasets
      ? (Chart, canvas) => {
          // Update stats chart
          const chartTextColor = getEffectiveThemeTextColor(activeLayout);
          Chart.defaults.color = chartTextColor;
          return new Chart(canvas, {
            type: "bar",
            options: {
              maintainAspectRatio: false,
              responsive: true,
              aspectRatio: 1.1,
              scales: {
                y: {
                  beginAtZero: true,
                  grid: { color: "rgba(148, 163, 184, 0.16)" },
                  ticks: {
                    color: chartTextColor,
                    stepSize: 1,
                  },
                  title: {
                    display: false,
                    text: "#Events",
                  },
                  stacked: true,
                },
                x: {
                  grid: { color: "rgba(148, 163, 184, 0.16)" },
                  stacked: true,
                  ticks: { color: chartTextColor },
                  title: {
                    display: true,
                    color: chartTextColor,
                    text: "Hour of Day",
                  },
                },
              },
              plugins: {
                legend: {
                  position: "bottom",
                  display: true,
                },
                tooltip: {
                  callbacks: {
                    title: (tooltipItems) =>
                      `Training at hour ${tooltipItems?.[0]?.label || "unknown"}`,
                    label: (tooltipItems) => {
                      const raw = tooltipItems?.raw as {
                        entries: { trainingFinishedAt: string }[];
                      };
                      return (
                        raw.entries?.map((e) =>
                          new Date(e.trainingFinishedAt).toLocaleString(),
                        ) || []
                      );
                    },
                  },
                },
              },
            },
            data: {
              labels: HOURS_OF_DAY,
              datasets: datasets,
            },
          });
        }
      : null,
    [activeLayout, datasets],
  );

  return (
    <ContentBox
      title="Training Log"
      subtitle="User activity last 24 hours"
      initialBreak={true}
    >
      <div className="relative w-[99%] p-3">
        {chartFailed ? (
          <p className="py-4 text-center text-muted-foreground text-sm">
            The training chart could not be loaded.
          </p>
        ) : (
          <canvas ref={chartRef} id="chart"></canvas>
        )}
      </div>
    </ContentBox>
  );
};
