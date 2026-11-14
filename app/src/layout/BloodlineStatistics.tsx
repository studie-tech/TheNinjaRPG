import type { ChartData, Chart as ChartJS, ChartOptions } from "chart.js";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface BloodlineStatisticsProps {
  trigger: React.ReactNode;
}

export const BloodlineStatistics: React.FC<BloodlineStatisticsProps> = ({
  trigger,
}) => {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = api.bloodline.getNaturalRollStatistics.useQuery(
    undefined,
    { enabled: open },
  );

  // Format data for chart - calculate percentages
  const chartData = useMemo(() => {
    if (!data) return [];
    // Calculate total including "none" entries but excluding "H" rank
    const filteredData = Object.entries(data).filter(([rank]) => rank !== "H");
    const total = filteredData.reduce((sum, [_, count]) => sum + count, 0);

    // Include all entries including "none" but excluding "H" rank
    return filteredData
      .map(([rank, count]) => ({
        rank,
        count,
        percentage: total > 0 ? (count / total) * 100 : 0,
      }))
      .sort((a, b) => {
        // Sort by rank: S, A, B, C, D, none (at the end)
        const rankOrder: Record<string, number> = {
          S: 0,
          A: 1,
          B: 2,
          C: 3,
          D: 4,
          none: 5,
        };
        return (rankOrder[a.rank] ?? 999) - (rankOrder[b.rank] ?? 999);
      });
  }, [data]);

  // The total covers the same rolls as the chart's percentages
  const totalRolls = chartData.reduce((sum, item) => sum + item.count, 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-[350px] md:w-[450px]" align="end">
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-lg">Bloodline Roll Statistics</h3>
            <p className="text-muted-foreground text-sm">
              Distribution of natural bloodline rolls by rank
            </p>
          </div>

          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <p>Loading statistics...</p>
            </div>
          ) : !data || totalRolls === 0 ? (
            <div className="flex h-40 items-center justify-center">
              <p className="text-center text-gray-500">
                No roll statistics available yet
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between">
                <span>Total bloodline rolls:</span>
                <span className="font-semibold">{totalRolls}</span>
              </div>

              {open && <BloodlineRollChart chartData={chartData} />}

              <div className="text-gray-500 text-xs italic">
                Statistics based on all natural bloodline rolls in the game
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

const BloodlineRollChart: React.FC<{ chartData: BloodlineChartDatum[] }> = ({
  chartData,
}) => {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const [chartFailed, setChartFailed] = useState(false);

  useEffect(() => {
    const ctx = chartRef.current?.getContext("2d");
    if (!ctx || chartData.length === 0) return;

    let chart: ChartJS | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { Chart } = await import("chart.js/auto");
        // The popover can close before the library finishes loading.
        if (cancelled) return;
        // Prepare chart data
        const chartConfig: ChartData = {
          labels: chartData.map((item) =>
            item.rank === "none" ? "No Bloodline" : `${item.rank}-Rank`,
          ),
          datasets: [
            {
              label: "Percentage",
              data: chartData.map((item) => parseFloat(item.percentage.toFixed(2))),
              backgroundColor: chartData.map(
                (item) => `rgba(${rankColor(item.rank)}, 0.7)`,
              ),
              borderColor: chartData.map((item) => `rgb(${rankColor(item.rank)})`),
              borderWidth: 1,
            },
          ],
        };

        // Chart options
        const options: ChartOptions = {
          responsive: true,
          maintainAspectRatio: true,
          aspectRatio: 1,
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const index = context.dataIndex;
                  const item = chartData[index];
                  if (!item) return "";
                  return [
                    `Percentage: ${item.percentage.toFixed(2)}%`,
                    `Count: ${item.count}`,
                  ];
                },
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: "Percentage (%)",
              },
              ticks: {
                callback: (value) => `${value}%`,
              },
            },
          },
        };

        chart = new Chart(ctx, {
          type: "bar",
          data: chartConfig,
          options,
        });
      } catch (error) {
        console.error("Could not load the bloodline statistics chart", error);
        if (!cancelled) setChartFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      chart?.destroy();
    };
  }, [chartData]);

  return (
    <div className="aspect-square w-full">
      {chartFailed ? (
        <p role="alert" className="py-4 text-center text-muted-foreground text-sm">
          The statistics chart could not be loaded. Close and reopen to try again.
        </p>
      ) : (
        <canvas ref={chartRef} />
      )}
    </div>
  );
};

const RANK_COLORS: Record<string, string> = {
  S: "255, 99, 132",
  A: "255, 159, 64",
  B: "255, 205, 86",
  C: "75, 192, 192",
  D: "54, 162, 235",
};

/** Chart colour channels of a roll rank; unranked and "none" rolls are grey. */
const rankColor = (rank: string) => RANK_COLORS[rank] ?? "201, 203, 207";

type BloodlineChartDatum = {
  rank: string;
  count: number;
  percentage: number;
};
