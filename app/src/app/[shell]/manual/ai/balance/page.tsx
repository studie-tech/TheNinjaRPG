"use client";

import type React from "react";
import { useEffect } from "react";
import { api } from "@/app/_trpc/client";
import { useLocalStorage } from "@/hooks/localstorage";
import AiBalanceFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/AiBalanceFiltering";
import { ClearBattleDataButton } from "@/layout/ClearDataConfirm";
import ContentBox from "@/layout/ContentBox";
import { ContentLinksCell } from "@/layout/ContentLinksCell";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import UserFiltering, {
  getFilter as getUserFilter,
  useFiltering as useUserFiltering,
} from "@/layout/UserFiltering";
import { summarizeBattleOutcomes } from "@/libs/statistics";
import { groupBy } from "@/utils/grouping";
import { canChangeContent } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserData } from "@/utils/UserContext";

export default function ManualAIsBalance() {
  // State
  const availableTabs = ["Usage", "Power"];
  type Tab = (typeof availableTabs)[number];
  const [tab, setTab] = useLocalStorage<Tab>("aiBalanceTab", "Usage", true);

  const NavBarBlock = (
    <NavTabs current={tab} options={availableTabs} setValue={setTab} />
  );

  return (
    <>
      {tab === "Usage" && <AiUsageBalance navTabs={NavBarBlock} />}
      {tab === "Power" && <AiEffectsBalance navTabs={NavBarBlock} />}
    </>
  );
}

// AiUsageBalance Component
const AiUsageBalance: React.FC<{ navTabs: React.ReactNode }> = ({ navTabs }) => {
  // State
  const filterState = useFiltering();
  const { data: userData } = useUserData();

  // Get filter object
  const filter = getFilter(filterState);

  // Queries
  const { data, isPending } = api.data.getAiBalanceStatistics.useQuery(filter);

  const utils = api.useUtils();

  // Process data for table
  const tableData =
    data &&
    (() => {
      const groups = groupBy(data, "name");
      const rows = Array.from(groups.entries()).map(([name, entries]) => {
        const outcomes = summarizeBattleOutcomes(entries);

        // Every row of a group shares the AI's userId
        const aiUserId = entries[0]?.aiUserId ?? "";

        return {
          name,
          links: <ContentLinksCell type="ai" id={aiUserId} canEdit />,
          ...outcomes,
        };
      });

      // Sort by total usage descending
      return rows.sort((a, b) => b.totalUsage - a.totalUsage);
    })();

  // Table columns
  type AiBalanceRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<AiBalanceRow, keyof AiBalanceRow>[] = [
    { key: "name", header: "Name", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "totalUsage", header: "Uses", type: "number" },
    { key: "wins", header: "Wins", type: "number" },
    { key: "flees", header: "Flees", type: "number" },
    { key: "losses", header: "Losses", type: "number" },
    {
      key: "winRate",
      header: "Win rate",
      type: "string",
    },
  ];

  // Check if user can change content
  const canDelete = canChangeContent(userData?.role ?? "USER");

  return (
    <ContentBox
      title="AI Balance"
      subtitle="Data since last reset"
      defaultBackHref="/manual/ai"
      padding={false}
      topRightContent={
        <div className="flex items-center gap-2">
          {navTabs}
          <AiBalanceFiltering state={filterState} />
          {canDelete && (
            <ClearBattleDataButton
              type="ai"
              label="AI"
              onCleared={() => utils.data.getAiBalanceStatistics.invalidate()}
            />
          )}
        </div>
      }
    >
      <p className="p-3">
        Here we aim to give an overview of AI usage & win-statistics, so as to make it
        transparent if any AI is over/under-powered and in need of balance adjustment.
      </p>
      {isPending && <Loader explanation="Loading data" />}
      {!isPending && tableData && <Table data={tableData} columns={columns} />}
    </ContentBox>
  );
};

// AiEffectsBalance Component
const AiEffectsBalance: React.FC<{ navTabs: React.ReactNode }> = ({ navTabs }) => {
  // State
  const filterState = useUserFiltering();
  const { data: userData } = useUserData();

  // Set default effect filter on mount
  useEffect(() => {
    if (!filterState.effect || filterState.effect.length === 0) {
      filterState.setEffect(["damage"]);
    }
  }, [filterState]);

  // Queries
  const { data, isPending } = api.data.getAiEffectsBalanceStatistics.useQuery({
    ...getUserFilter(filterState),
    isAi: true,
    effect: filterState.effect,
    limit: 100,
    orderBy: "Strongest",
  });

  // Check permissions
  const canEdit = canChangeContent(userData?.role ?? "USER");

  // Process data for table
  const tableData = data?.map((row) => ({
    name: row.name,
    rank: row.rank,
    level: row.level,
    origin: row.origin,
    effect: row.effect,
    power: row.power,
    rounds: row.rounds,
    powerPerLevel: row.powerPerLevel,
    links: <ContentLinksCell type="ai" id={row.id} canEdit={canEdit} />,
  }));

  // Table columns
  type AiEffectsRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<AiEffectsRow, keyof AiEffectsRow>[] = [
    {
      key: "name",
      header: "Name",
      type: "jsx",
    },
    { key: "links", header: "Links", type: "jsx" },
    { key: "level", header: "Level", type: "number" },
    { key: "origin", header: "Origin", type: "string" },
    { key: "effect", header: "Effect", type: "string" },
    { key: "power", header: "Power", type: "number" },
    { key: "rounds", header: "Rounds", type: "number" },
    { key: "powerPerLevel", header: "Power/Level", type: "string" },
  ];

  return (
    <ContentBox
      title="AI Effects Balance"
      subtitle="Effect-based power analysis"
      defaultBackHref="/manual/ai"
      padding={false}
      topRightContent={
        <div className="flex items-center gap-2">
          {navTabs}
          <UserFiltering state={filterState} aiToggles={true} />
        </div>
      }
    >
      <p className="p-3">
        Here we analyze AI power based on their jutsu and item effects, helping to
        identify imbalances in effect distribution and power scaling.
      </p>
      {isPending && <Loader explanation="Loading data" />}
      {!isPending && tableData && <Table data={tableData} columns={columns} />}
    </ContentBox>
  );
};
