"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useLocalStorage } from "@/hooks/localstorage";
import { groupBy } from "@/utils/grouping";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { Button } from "@/components/ui/button";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { api } from "@/app/_trpc/client";
import BloodlineBalanceFiltering, {
  useFiltering,
  getFilter,
} from "@/layout/BloodlineBalanceFiltering";
import BloodlineFiltering, {
  useFiltering as useBloodlineFiltering,
  getFilter as getBloodlineFilter,
} from "@/layout/BloodlineFiltering";
import Link from "next/link";
import NavTabs from "@/layout/NavTabs";
import ItemWithEffects from "@/layout/ItemWithEffects";
import { BarChart3, Trash2, InfoIcon, Pencil } from "lucide-react";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserData } from "@/utils/UserContext";
import { canChangeContent } from "@/utils/permissions";
import Confirm2 from "@/layout/Confirm2";
import Modal2 from "@/layout/Modal2";
import { showMutationToast } from "@/libs/toast";

export default function ManualBloodlineBalance() {
  // State
  const availableTabs = ["Usage", "Power"];
  type Tab = (typeof availableTabs)[number];
  const [tab, setTab] = useLocalStorage<Tab>("bloodlineBalanceTab", "Usage");

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

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedBloodlineId, setSelectedBloodlineId] = useState<string>("");

  // Queries
  const { data, isPending } = api.data.getBloodlineEffectsBalanceStatistics.useQuery(
    getBloodlineFilter(state),
  );

  // Bloodline details query for modal
  const { data: bloodlineDetails, isPending: isBloodlineDetailsPending } =
    api.bloodline.get.useQuery(
      { id: selectedBloodlineId },
      { enabled: !!selectedBloodlineId },
    );

  // Set default effect to be damage
  useEffect(() => {
    if (state.effect.length === 0) {
      state.setEffect(["increasedamagegiven"]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Can edit bloodline
  const canEdit = canChangeContent(userData?.role ?? "USER");

  const tableData = data
    ?.map((bloodline) => {
      return bloodline.effects.map((effect) => {
        return {
          name: bloodline.name,
          links: (
            <div className="flex items-center gap-2">
              <Link href={`/manual/bloodline/statistics/${bloodline.id}`}>
                <BarChart3 className="h-4 w-4 text-muted-foreground hover:text-primary" />
              </Link>
              {canEdit && (
                <Link href={`/manual/bloodline/edit/${bloodline.id}`}>
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Link>
              )}
              <InfoIcon
                className="h-4 w-4 text-muted-foreground hover:text-primary"
                onClick={() => {
                  setSelectedBloodlineId(bloodline.id);
                  setIsModalOpen(true);
                }}
              />
            </div>
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
    .flat()
    .sort((a, b) => b.power - a.power);

  // Table columns
  type BloodlineBalanceRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<
    BloodlineBalanceRow,
    keyof BloodlineBalanceRow
  >[] = [
    { key: "name", header: "Bloodline", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "statClassification", header: "Classification", type: "capitalized" },
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
      back_href="/manual/bloodline"
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

      {/* Bloodline Details Modal */}
      <Modal2
        title="Bloodline Details"
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
        proceed_label={null}
      >
        {isBloodlineDetailsPending ? (
          <Loader explanation="Loading bloodline details" />
        ) : (
          bloodlineDetails && (
            <ItemWithEffects item={bloodlineDetails} showStatistic="bloodline" />
          )
        )}
      </Modal2>
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

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedBloodlineId, setSelectedBloodlineId] = useState<string>("");

  // Get filter object
  const filter = getFilter(filterState);

  // Queries
  const { data, isPending } = api.data.getBloodlineBalanceStatistics.useQuery(filter);
  const { data: bloodlineNames } = api.bloodline.getAllNames.useQuery();
  const { data: bloodlineDetails, isPending: isBloodlineDetailsPending } =
    api.bloodline.get.useQuery(
      { id: selectedBloodlineId },
      { enabled: !!selectedBloodlineId },
    );

  // Mutations
  const { mutate: deleteAllData, isPending: isDeleting } =
    api.data.deleteAllDataBattleAction.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) {
          // Invalidate the bloodline balance statistics query to refresh the data
          await utils.data.getBloodlineBalanceStatistics.invalidate();
        }
      },
    });

  const utils = api.useUtils();

  // Check if user can change content
  const canDelete = canChangeContent(userData?.role ?? "USER");
  const canEdit = canChangeContent(userData?.role ?? "USER");

  // Create mapping from bloodline names to IDs
  const bloodlineNameToId = useMemo(() => {
    if (!bloodlineNames) return new Map<string, string>();
    return new Map(bloodlineNames.map((bloodline) => [bloodline.name, bloodline.id]));
  }, [bloodlineNames]);

  // Process data for table
  const tableData =
    data &&
    (() => {
      const groups = groupBy(data, "name");
      const rows = Array.from(groups.entries()).map(([name, entries]) => {
        const wins = entries
          .filter((entry) => entry.battleWon === 1)
          .reduce((acc, curr) => acc + (curr.count || 0), 0);

        const flees = entries
          .filter((entry) => entry.battleWon === 2)
          .reduce((acc, curr) => acc + (curr.count || 0), 0);

        const losses = entries
          .filter((entry) => entry.battleWon === 0)
          .reduce((acc, curr) => acc + (curr.count || 0), 0);

        const totalUsage = wins + flees + losses;
        const winRate = totalUsage > 0 ? (wins / totalUsage) * 100 : 0;

        // Get equipped count from the first entry (all entries for a bloodline will have the same equipped count)
        const equippedCount = entries[0]?.equippedCount || 0;

        const bloodlineId = bloodlineNameToId.get(name);

        return {
          name,
          links: (
            <div className="flex items-center gap-2">
              <Link href={`/manual/bloodline/statistics/${bloodlineId}`}>
                <BarChart3 className="h-4 w-4 text-muted-foreground hover:text-primary" />
              </Link>
              {canEdit && (
                <Link href={`/manual/bloodline/edit/${bloodlineId}`}>
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Link>
              )}
              <InfoIcon
                className="h-4 w-4 text-muted-foreground hover:text-primary"
                onClick={() => {
                  setSelectedBloodlineId(bloodlineId ?? "");
                  setIsModalOpen(true);
                }}
              />
            </div>
          ),
          totalUsage,
          equippedCount,
          wins,
          flees,
          losses,
          winRate: `${winRate.toFixed(1)}%`,
        };
      });

      // Sort by total usage descending
      return rows.sort((a, b) => b.totalUsage - a.totalUsage);
    })();

  // Table columns
  type BloodlineBalanceRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<
    BloodlineBalanceRow,
    keyof BloodlineBalanceRow
  >[] = [
    { key: "name", header: "Bloodline", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "totalUsage", header: "Uses", type: "number" },
    { key: "equippedCount", header: "Equipped", type: "number" },
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
      back_href="/manual/bloodline"
      padding={false}
      topRightContent={
        <div className="flex items-center gap-2">
          {props.navTabs}
          <BloodlineBalanceFiltering state={filterState} />
          {canDelete && (
            <Confirm2
              title="Clear All Bloodline Battle Data"
              button={
                <Button size="icon">
                  <Trash2 className="h-5 w-5 cursor-pointer" />
                </Button>
              }
              proceed_label="Clear Data"
              confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onAccept={(e) => {
                e.preventDefault();
                deleteAllData({ type: "bloodline" });
              }}
            >
              {isDeleting ? (
                <Loader explanation="Deleting data" />
              ) : (
                <>
                  Are you sure you want to clear all bloodline battle action data? This
                  action cannot be undone and will reset all bloodline usage statistics.
                  This action will be logged for future audit and review.
                </>
              )}
            </Confirm2>
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

      {/* Bloodline Details Modal */}
      <Modal2
        title="Bloodline Details"
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
        proceed_label={null}
      >
        {isBloodlineDetailsPending ? (
          <Loader explanation="Loading bloodline details" />
        ) : (
          bloodlineDetails && (
            <ItemWithEffects item={bloodlineDetails} showStatistic="bloodline" />
          )
        )}
      </Modal2>
    </ContentBox>
  );
};
