import { Chart as ChartJS } from "chart.js/auto";
import { Trash2 } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import BattleLengthFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/BattleLengthFiltering";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

interface BattleLengthHistogramProps {
  title?: string;
  subtitle?: string;
}

export const BattleLengthHistogram: React.FC<BattleLengthHistogramProps> = ({
  title = "Battle Lengths",
  subtitle = "Distribution of battle durations",
}) => {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const filteringState = useFiltering();
  const filter = getFilter(filteringState);
  const { data: userData } = useUserData();

  // Fetch battle length statistics
  const { data: battleLengthData } =
    api.data.getBattleLengthStatistics.useQuery(filter);

  // Mutations
  const { mutate: clearAllBattleLengths, isPending: isClearing } =
    api.data.clearAllBattleLengths.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) {
          // Invalidate the battle length statistics query to refresh the data
          await utils.data.getBattleLengthStatistics.invalidate();
        }
      },
    });

  const utils = api.useUtils();

  // Check if user can change content
  const canDelete = canChangeContent(userData?.role ?? "USER");

  useEffect(() => {
    const ctx = chartRef?.current?.getContext("2d");
    if (ctx && battleLengthData && battleLengthData.length > 0) {
      // Group data by battle type
      const battleTypeGroups = new Map<string, { rounds: number; count: number }[]>();

      battleLengthData.forEach((item) => {
        if (!battleTypeGroups.has(item.battleType)) {
          battleTypeGroups.set(item.battleType, []);
        }
        battleTypeGroups.get(item.battleType)?.push({
          rounds: item.rounds,
          count: item.normalized,
        });
      });

      // Get all unique round values for labels
      const allRounds = new Set<number>();
      battleLengthData.forEach((item) => {
        allRounds.add(item.rounds);
      });
      const sortedRounds = Array.from(allRounds).sort((a, b) => a - b);

      // Create datasets for each battle type
      const datasets = Array.from(battleTypeGroups.entries()).map(
        ([battleType, items], index) => {
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

          // Create data array with zeros for missing rounds
          const data = sortedRounds.map((round) => {
            const item = items.find((i) => i.rounds === round);
            return item ? item.count : 0;
          });

          return {
            label: battleType,
            data: data,
            backgroundColor: `${colors[index % colors.length]}80`, // Add transparency
            borderColor: colors[index % colors.length],
            borderWidth: 1,
            // Remove stacking - let bars be grouped side by side
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
                text: "Rounds",
              },
              ticks: {
                stepSize: 1,
              },
              // Remove stacking for grouped bars
            },
            y: {
              type: "linear" as const,
              title: {
                display: true,
                text: "Number of Battles",
              },
              // Remove stacking for grouped bars
            },
          },
          interaction: {
            mode: "nearest" as const,
            axis: "x" as const,
            intersect: false,
          },
        },
        data: {
          labels: sortedRounds,
          datasets,
        },
      });

      return () => {
        myChart.destroy();
      };
    }
  }, [battleLengthData]);

  return (
    <ContentBox
      title={title}
      subtitle={subtitle}
      topRightContent={
        <div className="flex items-center gap-2">
          <BattleLengthFiltering state={filteringState} />
          {canDelete && (
            <Confirm2
              title="Clear All Battle Length Data"
              button={
                <Button size="icon">
                  <Trash2 className="h-5 w-5 cursor-pointer" />
                </Button>
              }
              proceed_label="Clear Data"
              confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onAccept={(e) => {
                e.preventDefault();
                clearAllBattleLengths();
              }}
            >
              {isClearing ? (
                <Loader explanation="Clearing data" />
              ) : (
                <>
                  Are you sure you want to clear all battle length data? This action
                  cannot be undone and will reset all battle length statistics. This
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
      {battleLengthData && battleLengthData.length > 0 ? (
        <div className="relative h-96 w-full">
          <canvas ref={chartRef} id="battleLengthHistogram"></canvas>
        </div>
      ) : (
        <p className="py-8 text-center text-gray-500">
          No battle length data available.
        </p>
      )}
    </ContentBox>
  );
};
