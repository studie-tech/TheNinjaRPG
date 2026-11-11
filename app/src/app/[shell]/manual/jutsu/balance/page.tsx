"use client";

import type React from "react";
import { useEffect } from "react";
import { api } from "@/app/_trpc/client";
import { useLocalStorage } from "@/hooks/localstorage";
import { useContentDetails } from "@/hooks/useContentDetails";
import { ClearBattleDataButton } from "@/layout/ClearDataConfirm";
import ContentBox from "@/layout/ContentBox";
import { ContentDetailsModal } from "@/layout/ContentDetailsModal";
import { ContentLinksCell } from "@/layout/ContentLinksCell";
import JutsuBalanceFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/JutsuBalanceFiltering";
import JutsuFiltering, {
  getFilter as getJutsuFilter,
  useFiltering as useJutsuFiltering,
} from "@/layout/JutsuFiltering";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { summarizeBattleOutcomes } from "@/libs/statistics";
import { groupBy } from "@/utils/grouping";
import { canChangeContent } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserData } from "@/utils/UserContext";

export default function ManualJutsusBalance() {
  // State
  const availableTabs = ["Usage", "Power"];
  type Tab = (typeof availableTabs)[number];
  const [tab, setTab] = useLocalStorage<Tab>("jutsuBalanceTab", "Usage", true);

  const NavBarBlock = (
    <NavTabs current={tab} options={availableTabs} setValue={setTab} />
  );

  return (
    <>
      {tab === "Usage" && <JutsuUsageBalance navTabs={NavBarBlock} />}
      {tab === "Power" && <JutsuEffectsBalance navTabs={NavBarBlock} />}
    </>
  );
}

/**
 * Jutsu Effects Balance
 */
interface JutsuEffectsBalanceProps {
  navTabs: React.ReactNode;
}

const JutsuEffectsBalance: React.FC<JutsuEffectsBalanceProps> = (props) => {
  // Two-level filtering
  const state = useJutsuFiltering();
  const { data: userData } = useUserData();

  const details = useContentDetails();

  // Queries
  const { data, isPending } = api.data.getJutsuEffectsBalanceStatistics.useQuery(
    getJutsuFilter(state),
  );

  // Set default effect to be damage
  useEffect(() => {
    if (state.effect.length === 0) {
      state.setEffect(["damage"]);
    }
  }, []);

  // Can edit jutsu
  const canEdit = canChangeContent(userData?.role ?? "USER");

  const tableData = data
    ?.flatMap((jutsu) => {
      return jutsu.effects.map((effect) => {
        return {
          name: jutsu.name,
          links: (
            <ContentLinksCell
              type="jutsu"
              id={jutsu.id}
              canEdit={canEdit}
              onInfo={() => details.open(jutsu.id)}
            />
          ),
          rank: jutsu.requiredRank,
          jutsuType: jutsu.jutsuType,
          bloodline: jutsu.bloodline?.name || "None",
          effect: effect.type,
          power: effect.power,
          rounds: effect.rounds ?? "N/A",
          powerPerLevel: effect.powerPerLevel,
        };
      });
    })
    .sort((a, b) => b.power - a.power);

  // Table columns
  type JutsuBalanceRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<JutsuBalanceRow, keyof JutsuBalanceRow>[] = [
    { key: "name", header: "Name", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "jutsuType", header: "Type", type: "capitalized" },
    { key: "effect", header: "Effect", type: "string" },
    { key: "rank", header: "Rank", type: "capitalized" },
    { key: "power", header: "Power", type: "number" },
    { key: "rounds", header: "Rounds", type: "number" },
    { key: "powerPerLevel", header: "Power/Level", type: "number" },
  ];

  return (
    <ContentBox
      title="Jutsu Effects Balance"
      subtitle="Review Jutsu Power Balance"
      padding={false}
      defaultBackHref="/manual/jutsu"
      topRightContent={
        <div className="flex flex-row items-center">
          {props.navTabs}
          <JutsuFiltering state={state} />
        </div>
      }
    >
      <p className="p-3">Get an overview of the power of each jutsu effect</p>
      {isPending && <Loader explanation="Loading data" />}
      {!isPending && tableData && <Table data={tableData} columns={columns} />}
      {!isPending && tableData && tableData.length === 0 && (
        <div className="px-3 pb-3">
          No data found. You must select at least one effect type in the filter!
        </div>
      )}

      <ContentDetailsModal type="jutsu" {...details} />
    </ContentBox>
  );
};

/**
 * Jutsu Usage Balance
 */
interface JutsuUsageBalanceProps {
  navTabs: React.ReactNode;
}

const JutsuUsageBalance: React.FC<JutsuUsageBalanceProps> = (props) => {
  // State
  const filterState = useFiltering({ persistKey: "manual-jutsu-balance" });
  const { data: userData } = useUserData();

  const details = useContentDetails();

  // Get filter object
  const filter = getFilter(filterState);

  // Queries
  const { data, isPending } = api.data.getJutsuBalanceStatistics.useQuery(filter);

  const utils = api.useUtils();

  // Check if user can change content
  const canDelete = canChangeContent(userData?.role ?? "USER");
  const canEdit = canChangeContent(userData?.role ?? "USER");

  // Process data for table
  // Group and process data for table, no useMemo
  const tableData =
    data &&
    (() => {
      // Group by id: each row links to its own jutsu
      const groups = groupBy(data, "jutsuId");
      const rows = Array.from(groups.entries()).map(([jutsuId, entries]) => {
        const name = entries[0]?.name ?? jutsuId;
        const outcomes = summarizeBattleOutcomes(entries);

        // Get equipped count from the first entry (all entries for a jutsu will have the same equipped count)
        const equippedCount = entries[0]?.equippedCount || 0;

        return {
          name,
          links: (
            <ContentLinksCell
              type="jutsu"
              id={jutsuId}
              canEdit={canEdit}
              onInfo={() => details.open(jutsuId)}
            />
          ),
          equippedCount,
          ...outcomes,
        };
      });

      // Sort by total usage descending
      return rows.sort((a, b) => b.totalUsage - a.totalUsage);
    })();

  // Table columns
  type JutsuBalanceRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<JutsuBalanceRow, keyof JutsuBalanceRow>[] = [
    { key: "name", header: "Name", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "totalUsage", header: "Uses", type: "number" },
    { key: "equippedCount", header: "Equipped", type: "number" },
    { key: "wins", header: "Wins", type: "number" },
    { key: "flees", header: "Flees", type: "number" },
    { key: "losses", header: "Losses", type: "number" },
    {
      key: "winRate",
      header: "Win rate",
      type: "string",
    },
  ];

  return (
    <ContentBox
      title="Jutsu Balance"
      subtitle="Data since last reset"
      defaultBackHref="/manual/jutsu"
      padding={false}
      topRightContent={
        <div className="flex items-center gap-2">
          {props.navTabs}
          <JutsuBalanceFiltering state={filterState} />
          {canDelete && (
            <ClearBattleDataButton
              type="jutsu"
              label="jutsu"
              onCleared={() => utils.data.getJutsuBalanceStatistics.invalidate()}
            />
          )}
        </div>
      }
    >
      <p className="p-3">
        Here we aim to give an overview of jutsu usage & win-statistics, so as to make
        it transparent if any jutsu or combination of jutsus is over/under-powered and
        in need of balance adjustment.
      </p>
      {isPending && <Loader explanation="Loading data" />}
      {!isPending && tableData && <Table data={tableData} columns={columns} />}

      <ContentDetailsModal type="jutsu" {...details} />
    </ContentBox>
  );
};
