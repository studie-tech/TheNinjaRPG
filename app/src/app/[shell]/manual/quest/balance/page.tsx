"use client";

import type { TooltipItem } from "chart.js/auto";
import { Chart as ChartJS } from "chart.js/auto";
import type React from "react";
import { useEffect, useRef } from "react";
import { api } from "@/app/_trpc/client";
import { LetterRanks } from "@/drizzle/constants";
import { useLocalStorage } from "@/hooks/localstorage";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import QuestRewardBalanceFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/QuestRewardBalanceFiltering";

export default function ManualQuestBalance() {
  const availableTabs = ["Rewards"] as const;
  type Tab = (typeof availableTabs)[number];
  const [tab, setTab] = useLocalStorage<Tab>("questBalanceTab", "Rewards", true);

  const NavBarBlock = (
    <NavTabs current={tab} options={[...availableTabs]} setValue={setTab} />
  );

  return <>{tab === "Rewards" && <QuestRewardsBalance navTabs={NavBarBlock} />}</>;
}

interface QuestRewardsBalanceProps {
  navTabs: React.ReactNode;
}

const QuestRewardsBalance: React.FC<QuestRewardsBalanceProps> = ({ navTabs }) => {
  // Filtering
  const filterState = useFiltering();
  const filter = getFilter(filterState);

  // Query
  const { data, isPending } = api.data.getQuestRewardStatistics.useQuery(filter);

  // Ranks for x-axis

  // Charts
  const scatterRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ranks = [...LetterRanks] as string[];
    if (!scatterRef.current) return;

    const points = (data ?? []).map((q) => ({
      x: q.questRank,
      y: q.value,
      name: q.name,
    }));
    const ctx = scatterRef.current.getContext("2d");
    if (!ctx) return;
    const chart = new ChartJS(ctx, {
      type: "scatter",
      data: {
        datasets: [
          {
            label: `${filterState.reward} per quest`,
            data: points as unknown as { x: string; y: number }[],
            backgroundColor: "rgba(59, 130, 246, 0.6)",
            pointRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        scales: {
          x: {
            type: "category",
            labels: ranks,
            title: { display: true, text: "Quest Rank" },
          },
          y: { title: { display: true, text: filterState.reward } },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx: TooltipItem<"scatter">) => {
                const raw = ctx.raw as {
                  x: string;
                  y: number;
                  name?: string;
                };
                const name = raw?.name ? `${raw.name}: ` : "";
                return `${name}${filterState.reward} = ${ctx.parsed.y}`;
              },
            },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [data, filterState.reward]);

  return (
    <ContentBox
      title="Quest Balance"
      subtitle="Reward totals by rank"
      defaultBackHref="/manual/quest"
      padding={false}
      topRightContent={
        <div className="flex items-center gap-2">
          {navTabs}
          <QuestRewardBalanceFiltering state={filterState} />
        </div>
      }
    >
      <p className="p-3">
        Overview of {filterState.reward} totals per quest (quest reward + objectives),
        grouped by quest rank. Hover to see quest names.
      </p>
      {isPending && <Loader explanation="Loading data" />}
      {!isPending && (
        <div className="h-80">
          <canvas ref={scatterRef} />
        </div>
      )}
    </ContentBox>
  );
};
