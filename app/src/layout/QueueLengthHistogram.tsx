import { Chart as ChartJS } from "chart.js/auto";
import { Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import QueueLengthFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/QueueLengthFiltering";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

interface QueueLengthHistogramProps {
  title?: string;
  subtitle?: string;
}

export const QueueLengthHistogram: React.FC<QueueLengthHistogramProps> = ({
  title = "Queue Lengths",
  subtitle = "Distribution of queue wait times",
}) => {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const filteringState = useFiltering();
  const filter = getFilter(filteringState);
  const { data: userData } = useUserData();

  // Fetch queue length statistics
  const { data: queueLengthData } = api.data.getQueueLengthStatistics.useQuery(filter);

  // Mutations
  const { mutate: clearAllQueueLengths, isPending: isClearing } =
    api.data.clearAllQueueLengths.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) {
          // Invalidate the queue length statistics query to refresh the data
          await utils.data.getQueueLengthStatistics.invalidate();
        }
      },
    });

  const utils = api.useUtils();

  // Check if user can change content
  const canDelete = canChangeContent(userData?.role ?? "USER");

  useEffect(() => {
    const ctx = chartRef?.current?.getContext("2d");
    if (ctx && queueLengthData && queueLengthData.length > 0) {
      // Group data by ranked rank
      const rankedRankGroups = new Map<
        string,
        { ceiledMinutes: number; count: number }[]
      >();

      queueLengthData.forEach((item) => {
        if (!rankedRankGroups.has(item.rankedRank)) {
          rankedRankGroups.set(item.rankedRank, []);
        }
        rankedRankGroups.get(item.rankedRank)?.push({
          ceiledMinutes: item.ceiledMinutes,
          count: item.count,
        });
      });

      // Get all unique minute values for labels
      const allMinutes = new Set<number>();
      queueLengthData.forEach((item) => {
        allMinutes.add(item.ceiledMinutes);
      });
      const sortedMinutes = Array.from(allMinutes).sort((a, b) => a - b);

      // Create datasets for each ranked rank
      const datasets = Array.from(rankedRankGroups.entries()).map(
        ([rankedRank, items], index) => {
          const colors = [
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

          // Create data array with zeros for missing minutes
          const data = sortedMinutes.map((minutes) => {
            const item = items.find((i) => i.ceiledMinutes === minutes);
            return item ? item.count : 0;
          });

          return {
            label: rankedRank,
            data: data,
            backgroundColor: `${colors[index % colors.length]}80`, // Add transparency
            borderColor: colors[index % colors.length],
            borderWidth: 1,
          };
        },
      );

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
                text: "Minutes",
              },
              ticks: {
                stepSize: 1,
              },
            },
            y: {
              type: "linear" as const,
              title: {
                display: true,
                text: "Number of Queues",
              },
            },
          },
          interaction: {
            mode: "nearest" as const,
            axis: "x" as const,
            intersect: false,
          },
        },
        data: {
          labels: sortedMinutes,
          datasets,
        },
      });

      return () => {
        myChart.destroy();
      };
    }
  }, [queueLengthData]);

  return (
    <ContentBox
      title={title}
      subtitle={subtitle}
      topRightContent={
        <div className="flex items-center gap-2">
          <QueueLengthFiltering state={filteringState} />
          {canDelete && (
            <Confirm2
              title="Clear All Queue Length Data"
              button={
                <Button size="icon">
                  <Trash2 className="h-5 w-5 cursor-pointer" />
                </Button>
              }
              proceed_label="Clear Data"
              confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onAccept={(e) => {
                e.preventDefault();
                clearAllQueueLengths();
              }}
            >
              {isClearing ? (
                <Loader explanation="Clearing data" />
              ) : (
                <>
                  Are you sure you want to clear all queue length data? This action
                  cannot be undone and will reset all queue length statistics. This
                  action will be logged for future audit and review.
                </>
              )}
            </Confirm2>
          )}
        </div>
      }
      initialBreak={true}
      padding={false}
    >
      {queueLengthData && queueLengthData.length > 0 ? (
        <div className="relative h-96 w-full">
          <canvas ref={chartRef} id="queueLengthHistogram"></canvas>
        </div>
      ) : (
        <p className="py-8 text-center text-gray-500">
          No queue length data available.
        </p>
      )}
    </ContentBox>
  );
};
