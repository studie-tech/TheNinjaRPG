"use client";

import { Chart as ChartJS } from "chart.js/auto";
import { CircleCheckBig, CircleMinus } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { useLocalStorage } from "@/hooks/localstorage";
import type { ContentDetails } from "@/hooks/useContentDetails";
import ContentBox from "@/layout/ContentBox";
import { ContentDetailsModal } from "@/layout/ContentDetailsModal";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";

const AVAILABLE_TABS = ["Incomplete", "Diversity"];

/** Completeness overview of one content type: a table of gaps and diversity charts. */
export const ContentCompletenessPanel: React.FC<ContentCompletenessPanelProps> = (
  props,
) => {
  const { type, storageKey, isPending, details, incomplete, diversity } = props;
  const [filter, setFilter] = useLocalStorage<string>(storageKey, "Incomplete", true);

  return (
    <>
      <ContentBox
        title="Completeness"
        subtitle="Missing information etc."
        defaultBackHref={`/manual/${type}`}
        padding={false}
        topRightContent={
          <NavTabs current={filter} options={AVAILABLE_TABS} setValue={setFilter} />
        }
      >
        <p className="p-3">
          The aim of this overview is to highlight any missing information in content,
          such that we can ensure that content is complete & diverse.
        </p>
        {isPending && <Loader explanation="Loading data" />}
        {!isPending && filter === "Incomplete" && incomplete}
        {!isPending && filter === "Diversity" && <div className="p-3">{diversity}</div>}
      </ContentBox>

      <ContentDetailsModal type={type} {...details} />
    </>
  );
};

/** Table mark for one completeness check. */
export const CompletenessMark: React.FC<{ missing: boolean }> = ({ missing }) =>
  missing ? (
    <CircleMinus className="h-4 w-4 text-red-500" />
  ) : (
    <CircleCheckBig className="h-4 w-4 text-green-500" />
  );

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

interface ContentCompletenessPanelProps {
  type: "jutsu" | "item" | "bloodline";
  /** localStorage key of the selected tab. */
  storageKey: string;
  isPending: boolean;
  details: ContentDetails;
  incomplete: React.ReactNode;
  diversity: React.ReactNode;
}

interface CountsChartProps {
  data: Record<string, number> | undefined;
}

interface StackedCountsChartProps {
  data: Record<string, Record<string, number>> | undefined;
}
