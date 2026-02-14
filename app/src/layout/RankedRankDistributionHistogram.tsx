import { Chart as ChartJS } from "chart.js/auto";
import type React from "react";
import { useEffect, useRef } from "react";
import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import RankedRankDistributionFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/RankedRankDistributionFiltering";

interface RankedRankDistributionHistogramProps {
  title?: string;
  subtitle?: string;
}

export const RankedRankDistributionHistogram: React.FC<
  RankedRankDistributionHistogramProps
> = ({ title = "Rank Distribution", subtitle = "Players across ranked ranks" }) => {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const filteringState = useFiltering();
  const filter = getFilter(filteringState);

  // Fetch ranked rank distribution statistics
  const { data: rankDistributionData } =
    api.data.getRankedRankDistributionStatistics.useQuery(filter);

  useEffect(() => {
    const ctx = chartRef?.current?.getContext("2d");
    if (ctx && rankDistributionData && rankDistributionData.length > 0) {
      // Create datasets for the histogram
      const colors = [
        "#8e5ea2", // Wood - Purple
        "#3cba9f", // Adept - Green
        "#e8c3b9", // Master - Pink
        "#c45850", // Legend - Red
        "#ff6384", // Sannin - Bright Pink
      ];

      const myChart = new ChartJS(ctx, {
        type: "bar",
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false, // No legend needed for single dataset
            },
            tooltip: {
              mode: "index" as const,
              intersect: false,
              callbacks: {
                title: (context) => {
                  return `Rank: ${context[0]?.label}`;
                },
                label: (context) => {
                  return `Players: ${context.parsed.y}`;
                },
              },
            },
          },
          scales: {
            x: {
              type: "category" as const,
              position: "bottom" as const,
              title: {
                display: true,
                text: "Ranked Rank",
              },
            },
            y: {
              type: "linear" as const,
              title: {
                display: true,
                text: "Number of Players",
              },
              beginAtZero: true,
            },
          },
          interaction: {
            mode: "nearest" as const,
            axis: "x" as const,
            intersect: false,
          },
        },
        data: {
          labels: rankDistributionData.map((item) => item.rank),
          datasets: [
            {
              label: "Players",
              data: rankDistributionData.map((item) => item.count),
              backgroundColor: rankDistributionData.map(
                (_, index) => `${colors[index % colors.length]}80`, // Add transparency
              ),
              borderColor: rankDistributionData.map(
                (_, index) => colors[index % colors.length],
              ),
              borderWidth: 1,
            },
          ],
        },
      });

      return () => {
        myChart.destroy();
      };
    }
  }, [rankDistributionData]);

  return (
    <ContentBox
      title={title}
      subtitle={subtitle}
      topRightContent={
        <div className="flex items-center gap-2">
          <RankedRankDistributionFiltering state={filteringState} />
        </div>
      }
      initialBreak={true}
      padding={false}
    >
      {rankDistributionData && rankDistributionData.length > 0 ? (
        <div className="relative h-96 w-full">
          <canvas ref={chartRef} id="rankedRankDistributionHistogram"></canvas>
        </div>
      ) : (
        <p className="py-8 text-center text-gray-500">
          No ranked rank distribution data available.
        </p>
      )}
    </ContentBox>
  );
};
