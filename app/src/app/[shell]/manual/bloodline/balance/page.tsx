"use client";

import type React from "react";
import { useEffect } from "react";
import { api } from "@/app/_trpc/client";
import { useLocalStorage } from "@/hooks/localstorage";
import { useContentDetails } from "@/hooks/useContentDetails";
import BloodlineBalanceFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/BloodlineBalanceFiltering";
import BloodlineFiltering, {
  getFilter as getBloodlineFilter,
  useFiltering as useBloodlineFiltering,
} from "@/layout/BloodlineFiltering";
import { ClearBattleDataButton } from "@/layout/ClearDataConfirm";
import ContentBox from "@/layout/ContentBox";
import { ContentDetailsModal } from "@/layout/ContentDetailsModal";
import { ContentLinksCell } from "@/layout/ContentLinksCell";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { canChangeContent } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserData } from "@/utils/UserContext";

export default function ManualBloodlineBalance() {
  // State
  const availableTabs = ["Usage", "Power"];
  type Tab = (typeof availableTabs)[number];
  const [tab, setTab] = useLocalStorage<Tab>("bloodlineBalanceTab", "Usage", true);

  const NavBarBlock = (
    <NavTabs current={tab} options={availableTabs} setValue={setTab} />
  );

  return (
    <>
      {tab === "Usage" && <BloodlineUsageBalance navTabs={NavBarBlock} />}
      {tab === "Power" && <BloodlineEffectsBalance navTabs={NavBarBlock} />}
    </>
  );
}

/**
 * Bloodline Effects Balance
 */
interface BloodlineEffectsBalanceProps {
  navTabs: React.ReactNode;
}

const BloodlineEffectsBalance: React.FC<BloodlineEffectsBalanceProps> = (props) => {
  // Two-level filtering
  const state = useBloodlineFiltering();
  const { data: userData } = useUserData();

  const details = useContentDetails();

  // Queries
  const { data, isPending } = api.data.getBloodlineEffectsBalanceStatistics.useQuery(
    getBloodlineFilter(state),
  );

  // Set default effect to be damage
  useEffect(() => {
    if (state.effect.length === 0) {
      state.setEffect(["increasedamagegiven"]);
    }
  }, []);

  // Can edit bloodline
  const canEdit = canChangeContent(userData?.role ?? "USER");

  const tableData = data
    ?.flatMap((bloodline) => {
      return bloodline.effects.map((effect) => {
        return {
          name: bloodline.name,
          links: (
            <ContentLinksCell
              type="bloodline"
              id={bloodline.id}
              canEdit={canEdit}
              onInfo={() => details.open(bloodline.id)}
            />
          ),
          rank: bloodline.rank,
          statClassification: bloodline.statClassification,
          village: bloodline.village?.name || "None",
          effect: effect.type,
          power: effect.power,
          rounds: effect.rounds ?? "N/A",
          powerPerLevel: effect.powerPerLevel,
        };
      });
    })
    .sort((a, b) => b.power - a.power);

  // Table columns
  type BloodlineBalanceRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<
    BloodlineBalanceRow,
    keyof BloodlineBalanceRow
  >[] = [
    { key: "name", header: "Bloodline", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    {
      key: "statClassification",
      header: "Classification",
      type: "capitalized",
    },
    { key: "effect", header: "Effect", type: "string" },
    { key: "rank", header: "Rank", type: "capitalized" },
    { key: "power", header: "Power", type: "number" },
    { key: "rounds", header: "Rounds", type: "number" },
    { key: "powerPerLevel", header: "PowerPerLvl", type: "number" },
  ];

  return (
    <ContentBox
      title="Bloodline Effects Balance"
      subtitle="Review Bloodline Power Balance"
      padding={false}
      defaultBackHref="/manual/bloodline"
      topRightContent={
        <div className="flex flex-row items-center">
          {props.navTabs}
          <BloodlineFiltering state={state} />
        </div>
      }
    >
      <p className="p-3">Get an overview of the power of each bloodline effect</p>
      {isPending && <Loader explanation="Loading data" />}
      {!isPending && tableData && <Table data={tableData} columns={columns} />}
      {!isPending && tableData && tableData.length === 0 && (
        <div className="px-3 pb-3">
          No data found. You must select at least one effect type in the filter!
        </div>
      )}

      <ContentDetailsModal type="bloodline" {...details} />
    </ContentBox>
  );
};

/**
 * Bloodline Usage Balance
 */
interface BloodlineUsageBalanceProps {
  navTabs: React.ReactNode;
}

const BloodlineUsageBalance: React.FC<BloodlineUsageBalanceProps> = (props) => {
  // State
  const filterState = useFiltering();
  const { data: userData } = useUserData();

  const details = useContentDetails();

  // Get filter object
  const filter = getFilter(filterState);

  // Queries
  const { data, isPending } = api.data.getBloodlineBalanceStatistics.useQuery(filter);

  const utils = api.useUtils();

  // Check if user can change content
  const canEdit = canChangeContent(userData?.role ?? "USER");

  // Process data for table
  const tableData = data
    ?.map((entry) => {
      return {
        name: entry.name,
        links: (
          <ContentLinksCell
            type="bloodline"
            id={entry.bloodlineId}
            canEdit={canEdit}
            onInfo={() => details.open(entry.bloodlineId)}
          />
        ),
        userCount: entry.userCount,
        totalUsage: entry.totalUsage,
        wins: entry.wins,
        flees: entry.flees,
        losses: entry.losses,
        winRate: entry.winRate,
      };
    })
    ?.sort((a, b) => b.totalUsage - a.totalUsage);

  // Table columns
  type BloodlineBalanceRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<
    BloodlineBalanceRow,
    keyof BloodlineBalanceRow
  >[] = [
    { key: "name", header: "Bloodline", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "userCount", header: "#users", type: "number" },
    { key: "totalUsage", header: "#uses", type: "number" },
    { key: "wins", header: "Wins", type: "number" },
    { key: "flees", header: "Flees", type: "number" },
    { key: "losses", header: "Losses", type: "number" },
    {
      key: "winRate",
      header: "WinRate",
      type: "string",
    },
  ];

  return (
    <ContentBox
      title="Bloodline Balance"
      subtitle="Data since last reset"
      defaultBackHref="/manual/bloodline"
      padding={false}
      topRightContent={
        <div className="flex items-center gap-2">
          {props.navTabs}
          <BloodlineBalanceFiltering state={filterState} />
          {canEdit && (
            <ClearBattleDataButton
              type="bloodline"
              label="bloodline"
              onCleared={() => utils.data.getBloodlineBalanceStatistics.invalidate()}
            />
          )}
        </div>
      }
    >
      <p className="p-3">
        Here we aim to give an overview of bloodline usage & win-statistics, so as to
        make it transparent if any bloodline is over/under-powered and in need of
        balance adjustment.
      </p>
      {isPending && <Loader explanation="Loading data" />}
      {!isPending && tableData && <Table data={tableData} columns={columns} />}

      <ContentDetailsModal type="bloodline" {...details} />
    </ContentBox>
  );
};
