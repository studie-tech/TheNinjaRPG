import React, { useEffect, useRef } from "react";
import ExportGraph from "@/layout/ExportGraph";
import { Chart as ChartJS } from "chart.js/auto";
import { groupBy } from "@/utils/grouping";
import type { BattleType } from "@/drizzle/constants";

interface LevelStatsProps {
  levelDistribution: {
    level: number;
    count: number;
  }[];
  title: string;
  xaxis: string;
}

export const LevelStats: React.FC<LevelStatsProps> = (props) => {
  const { levelDistribution, title, xaxis } = props;
  const chartRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = chartRef?.current?.getContext("2d");
    if (ctx) {
      const labels = levelDistribution.map((x) => x.level) ?? [];
      const counts = levelDistribution.map((x) => x.count) ?? [];
      const myChart = new ChartJS(ctx, {
        type: "bar",
        options: {
          scales: {
            x: {
              type: "linear",
              ticks: { stepSize: 1 },
              title: { display: true, text: xaxis },
            },
            y: {
              type: "linear",
              ticks: { stepSize: 1 },
              title: { display: true, text: "#Users" },
            },
          },
        },
        data: {
          labels: labels,
          datasets: [
            {
              data: counts,
              label: title,
              borderColor: "#3e95cd",
              backgroundColor: "#7bb6dd",
            },
          ],
        },
      });
      return () => {
        myChart.destroy();
      };
    }
  }, [levelDistribution, title, xaxis]);

  return (
    <div className="relative w-[99%]">
      <canvas ref={chartRef} id="baseUsage"></canvas>
      {chartRef.current !== null && (
        <ExportGraph canvas={chartRef.current} filename="level_distribution" />
      )}
    </div>
  );
};

interface GroupedLevelStatsProps {
  datasets: {
    source: string;
    levelDistribution: { level: number; count: number }[];
  }[];
  title: string;
  xaxis: string;
}

export const GroupedLevelStats: React.FC<GroupedLevelStatsProps> = (props) => {
  const { datasets, title, xaxis } = props;
  const chartRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = chartRef?.current?.getContext("2d");
    if (!ctx) return;

    // Collect all unique levels across datasets, sort asc
    const allLevels = Array.from(
      new Set(datasets.flatMap((d) => d.levelDistribution.map((x) => x.level))),
    ).sort((a, b) => a - b);

    // Build datasets aligned on allLevels
    const chartDatasets = datasets.map((d, i) => {
      const map = new Map(d.levelDistribution.map((x) => [x.level, x.count] as const));
      const colorHue = (i * 53) % 360;
      return {
        label: d.source,
        data: allLevels.map((lvl) => map.get(lvl) ?? 0),
        borderColor: `hsl(${colorHue} 70% 45%)`,
        backgroundColor: `hsl(${colorHue} 70% 60% / 0.7)`,
      };
    });

    const myChart = new ChartJS(ctx, {
      type: "bar",
      options: {
        scales: {
          x: {
            type: "linear",
            ticks: { stepSize: 1 },
            title: { display: true, text: xaxis },
          },
          y: {
            type: "linear",
            min: 0.0,
            title: { display: true, text: "#Users" },
          },
        },
      },
      data: {
        labels: allLevels,
        datasets: chartDatasets as unknown as { data: number[]; label: string }[],
      },
    });

    return () => myChart.destroy();
  }, [datasets, title, xaxis]);

  return (
    <div className="relative w-[99%]">
      <canvas ref={chartRef} id="groupedLevelDistribution"></canvas>
    </div>
  );
};

interface DailyMeanStdProps {
  data: {
    date: string; // YYYY-MM-DD
    mean: number;
    std: number;
    count: number;
  }[];
  title: string;
  yaxis?: string;
}

// Renders a time-like series with mean ± std as a band
export const DailyMeanStdChart: React.FC<DailyMeanStdProps> = (props) => {
  const { data, title, yaxis = "User Level" } = props;
  const chartRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = chartRef?.current?.getContext("2d");
    if (!ctx) return;

    const labels = data.map((d) => d.date);
    const mean = data.map((d) => d.mean);
    const lower = data.map((d) => Math.max(0, d.mean - d.std));
    const upper = data.map((d) => d.mean + d.std);

    const myChart = new ChartJS(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: `${title} (lower)`,
            data: lower,
            borderColor: "hsl(210 10% 75%)",
            backgroundColor: "hsla(210, 70%, 60%, 0.18)",
            pointRadius: 0,
            borderWidth: 0,
          },
          {
            label: `${title} (upper)`,
            data: upper,
            borderColor: "hsl(210 10% 75%)",
            backgroundColor: "hsla(210, 70%, 60%, 0.18)",
            fill: "-1", // fill to previous (lower) dataset
            pointRadius: 0,
            borderWidth: 0,
          },
          {
            label: `${title} (mean)`,
            data: mean,
            borderColor: "hsl(210 70% 45%)",
            backgroundColor: "hsl(210 70% 45%)",
            pointRadius: 2,
            borderWidth: 2,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        responsive: true,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            type: "category",
            title: { display: true, text: "Date" },
          },
          y: {
            type: "linear",
            min: 0,
            title: { display: true, text: yaxis },
          },
        },
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const i = ctx.dataIndex;
                const m = mean[i] ?? 0;
                const up = upper[i] ?? m;
                const lo = lower[i] ?? m;
                const s = (up - lo) / 2;
                const n = data[i]?.count ?? 0;
                const isMean = ctx.dataset.label?.includes("mean");
                const label = isMean ? "Mean" : (ctx.dataset.label ?? title);
                return `${label}: ${m.toFixed(2)} (±${s.toFixed(2)}) [n=${n}]`;
              },
            },
          },
        },
      },
    });

    return () => myChart.destroy();
  }, [data, title, yaxis]);

  return (
    <div className="relative w-[99%]" style={{ height: 360 }}>
      <canvas ref={chartRef} id="dailyMeanStd"></canvas>
    </div>
  );
};

interface DailyCountsBySourceProps {
  datasets: {
    source: string;
    series: { date: string; count: number }[];
  }[];
  title: string;
}

export const DailyCountsBySourceChart: React.FC<DailyCountsBySourceProps> = (props) => {
  const { datasets, title } = props;
  const chartRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = chartRef?.current?.getContext("2d");
    if (!ctx) return;

    // Collect all unique dates across datasets
    const allDates = Array.from(
      new Set(datasets.flatMap((d) => d.series.map((x) => x.date))),
    ).sort();

    // Build dataset per source aligned to allDates
    const chartDatasets = datasets.map((d, i) => {
      const map = new Map(d.series.map((x) => [x.date, x.count] as const));
      const hue = (i * 57) % 360;
      return {
        label: d.source,
        data: allDates.map((dt) => map.get(dt) ?? 0),
        borderColor: `hsl(${hue} 70% 45%)`,
        backgroundColor: `hsl(${hue} 70% 60% / 0.35)`,
        pointRadius: 2,
        borderWidth: 2,
      };
    });

    const chart = new ChartJS(ctx, {
      type: "line",
      data: {
        labels: allDates,
        datasets: chartDatasets as unknown as { data: number[]; label: string }[],
      },
      options: {
        maintainAspectRatio: false,
        responsive: true,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { type: "category", title: { display: true, text: "Date" } },
          y: {
            type: "linear",
            min: 0,
            title: { display: true, text: "#Recruited Users" },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [datasets, title]);

  return (
    <div className="relative w-[99%]" style={{ height: 360 }}>
      <canvas ref={chartRef} id="dailyCountsBySource"></canvas>
    </div>
  );
};

interface RevenueBySourceProps {
  data: { source: string; totalUsd: number }[];
  title: string;
}

export const RevenueBySourceBar: React.FC<RevenueBySourceProps> = (props) => {
  const { data, title } = props;
  const chartRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = chartRef?.current?.getContext("2d");
    if (!ctx) return;

    const labels = data.map((d) => d.source || "(none)");
    const values = data.map((d) => d.totalUsd || 0);

    const chart = new ChartJS(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: title,
            data: values,
            borderColor: "hsl(210 70% 45%)",
            backgroundColor: "hsl(210 70% 60% / 0.6)",
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        responsive: true,
        scales: {
          x: { type: "category", title: { display: true, text: "Referral Source" } },
          y: {
            type: "linear",
            title: { display: true, text: "USD" },
            beginAtZero: true,
          },
        },
      },
    });

    return () => chart.destroy();
  }, [data, title]);

  return (
    <div className="relative w-[99%]" style={{ height: 360 }}>
      <canvas ref={chartRef} id="revenueBySource"></canvas>
    </div>
  );
};

interface QuestFunnelBarProps {
  stepsCompleted: number[];
  title: string;
}

export const QuestFunnelBar: React.FC<QuestFunnelBarProps> = ({
  stepsCompleted,
  title,
}) => {
  const chartRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = chartRef?.current?.getContext("2d");
    if (!ctx || !stepsCompleted.length) return;

    // Find the max number of steps completed by any user
    const maxSteps = Math.max(...stepsCompleted);

    // For each step (0 to maxSteps), calculate the % of users who completed at least that many steps
    const totalUsers = stepsCompleted.length;
    const values: number[] = [];
    const labels: string[] = [];

    for (let step = 0; step <= maxSteps; step++) {
      const count = stepsCompleted.filter((n) => n >= step).length;
      const percent = (count / totalUsers) * 100;
      values.push(percent);
      labels.push(step === 0 ? "0 steps (all)" : `${step}+ steps`);
    }

    const chart = new ChartJS(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "% of users remaining",
            data: values,
            borderColor: "hsl(210 70% 45%)",
            backgroundColor: "hsl(210 70% 60% / 0.6)",
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        responsive: true,
        scales: {
          x: { type: "category", title: { display: true, text: "Quest Progress" } },
          y: {
            type: "linear",
            beginAtZero: true,
            max: 100,
            title: { display: true, text: "% Users Remaining" },
            ticks: {
              callback: (value) => `${value}%`,
            },
          },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (context) => `${context.parsed.y.toFixed(1)}%`,
            },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [stepsCompleted, title]);

  return (
    <div className="relative w-[99%]" style={{ height: 360 }}>
      <canvas ref={chartRef} id="questFunnel"></canvas>
    </div>
  );
};

interface UsageStatsProps {
  usage: {
    battleWon: number;
    battleType: BattleType;
    count: number;
  }[];
}
type UsageDataset = { data: number[]; label: string };
type Label = string | null | (string | null)[];
type Groups = Map<Label, { battleWon: number; count: number }[]>;

export const UsageStats: React.FC<UsageStatsProps> = (props) => {
  const { usage } = props;
  const chartRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = chartRef?.current?.getContext("2d");
    if (ctx) {
      const groups = groupBy(usage, "battleType");
      const labels = Array.from(groups.keys());
      const myChart = getUsageChart(ctx, groups, labels);
      myChart.resize(500, groups.size * 60);
      return () => {
        myChart.destroy();
      };
    }
  }, [usage]);

  return (
    <div className="relative w-[99%]">
      <canvas ref={chartRef} id="baseUsage"></canvas>
      {chartRef.current !== null && (
        <ExportGraph canvas={chartRef.current} filename="usage_statistics" />
      )}
    </div>
  );
};

export const getUsageChart = (
  ctx: CanvasRenderingContext2D,
  groups: Groups,
  labels: Label[],
) => {
  // Calculate the statistics
  const won: UsageDataset = { data: [], label: "Won" };
  const lost: UsageDataset = { data: [], label: "Lost" };
  const fled: UsageDataset = { data: [], label: "Fled" };
  groups.forEach((group) => {
    const wins = group.find((x) => x.battleWon === 1)?.count ?? 0;
    const losses = group.find((x) => x.battleWon === 0)?.count ?? 0;
    const flees = group.find((x) => x.battleWon === 2)?.count ?? 0;
    const total = wins + losses + flees ? wins + losses + flees : 1;
    won.data.push((100 * wins) / total);
    lost.data.push((100 * losses) / total);
    fled.data.push((100 * flees) / total);
  });

  const myChart = new ChartJS(ctx, {
    type: "bar",
    options: {
      maintainAspectRatio: false,
      responsive: true,
      indexAxis: "y",
      scales: {
        x: {
          stacked: true,
          title: { display: true, text: "Change of Outcome [%]" },
        },
        y: {
          stacked: true,
          title: { display: false },
        },
      },
    },
    data: {
      labels: labels,
      datasets: [won, lost, fled],
    },
  });
  return myChart;
};
