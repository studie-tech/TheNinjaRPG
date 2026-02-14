"use client";

import { BarChart3, InfoIcon, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { useLocalStorage } from "@/hooks/localstorage";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import JutsuBalanceFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/JutsuBalanceFiltering";
import JutsuFiltering, {
  getFilter as getJutsuFilter,
  useFiltering as useJutsuFiltering,
} from "@/layout/JutsuFiltering";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import NavTabs from "@/layout/NavTabs";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { showMutationToast } from "@/libs/toast";
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

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedJutsuId, setSelectedJutsuId] = useState<string>("");

  // Queries
  const { data, isPending } = api.data.getJutsuEffectsBalanceStatistics.useQuery(
    getJutsuFilter(state),
  );

  // Jutsu details query for modal
  const { data: jutsuDetails, isPending: isJutsuDetailsPending } =
    api.jutsu.get.useQuery({ id: selectedJutsuId }, { enabled: !!selectedJutsuId });

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
            <div className="flex items-center gap-2">
              <Link href={`/manual/jutsu/statistics/${jutsu.id}`}>
                <BarChart3 className="h-4 w-4 text-muted-foreground hover:text-primary" />
              </Link>
              {canEdit && (
                <Link href={`/manual/jutsu/edit/${jutsu.id}`}>
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Link>
              )}
              <InfoIcon
                className="h-4 w-4 text-muted-foreground hover:text-primary"
                onClick={() => {
                  setSelectedJutsuId(jutsu.id);
                  setIsModalOpen(true);
                }}
              />
            </div>
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
    { key: "name", header: "Jutsu", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "jutsuType", header: "Type", type: "capitalized" },
    { key: "effect", header: "Effect", type: "string" },
    { key: "rank", header: "Rank", type: "capitalized" },
    { key: "power", header: "Power", type: "number" },
    { key: "rounds", header: "Rounds", type: "number" },
    { key: "powerPerLevel", header: "PowerPerLvl", type: "number" },
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

      {/* Jutsu Details Modal */}
      <Modal2
        title="Jutsu Details"
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
        proceed_label={null}
      >
        {isJutsuDetailsPending ? (
          <Loader explanation="Loading jutsu details" />
        ) : (
          jutsuDetails && <ItemWithEffects item={jutsuDetails} showStatistic="jutsu" />
        )}
      </Modal2>
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
  const filterState = useFiltering();
  const { data: userData } = useUserData();

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedJutsuId, setSelectedJutsuId] = useState<string>("");

  // Get filter object
  const filter = getFilter(filterState);

  // Queries
  const { data, isPending } = api.data.getJutsuBalanceStatistics.useQuery(filter);
  const { data: jutsuNames } = api.jutsu.getAllNames.useQuery();
  const { data: jutsuDetails, isPending: isJutsuDetailsPending } =
    api.jutsu.get.useQuery({ id: selectedJutsuId }, { enabled: !!selectedJutsuId });

  // Mutations
  const { mutate: deleteAllData, isPending: isDeleting } =
    api.data.deleteAllDataBattleAction.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) {
          // Invalidate the jutsu balance statistics query to refresh the data
          await utils.data.getJutsuBalanceStatistics.invalidate();
        }
      },
    });

  const utils = api.useUtils();

  // Check if user can change content
  const canDelete = canChangeContent(userData?.role ?? "USER");
  const canEdit = canChangeContent(userData?.role ?? "USER");

  // Create mapping from jutsu names to IDs
  const jutsuNameToId = useMemo(() => {
    if (!jutsuNames) return new Map<string, string>();
    return new Map(jutsuNames.map((jutsu) => [jutsu.name, jutsu.id]));
  }, [jutsuNames]);

  // Process data for table
  // Group and process data for table, no useMemo
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

        // Get equipped count from the first entry (all entries for a jutsu will have the same equipped count)
        const equippedCount = entries[0]?.equippedCount || 0;

        const jutsuId = jutsuNameToId.get(name);

        return {
          name,
          links: (
            <div className="flex items-center gap-2">
              <Link href={`/manual/jutsu/statistics/${jutsuId}`}>
                <BarChart3 className="h-4 w-4 text-muted-foreground hover:text-primary" />
              </Link>
              {canEdit && (
                <Link href={`/manual/jutsu/edit/${jutsuId}`}>
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Link>
              )}
              <InfoIcon
                className="h-4 w-4 text-muted-foreground hover:text-primary"
                onClick={() => {
                  setSelectedJutsuId(jutsuId ?? "");
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
  type JutsuBalanceRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<JutsuBalanceRow, keyof JutsuBalanceRow>[] = [
    { key: "name", header: "Jutsu", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "totalUsage", header: "#uses", type: "number" },
    { key: "equippedCount", header: "#equipped", type: "number" },
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
      title="Jutsu Balance"
      subtitle="Data since last reset"
      defaultBackHref="/manual/jutsu"
      padding={false}
      topRightContent={
        <div className="flex items-center gap-2">
          {props.navTabs}
          <JutsuBalanceFiltering state={filterState} />
          {canDelete && (
            <Confirm2
              title="Clear All Jutsu Battle Data"
              button={
                <Button size="icon">
                  <Trash2 className="h-5 w-5 cursor-pointer" />
                </Button>
              }
              proceed_label="Clear Data"
              confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onAccept={(e) => {
                e.preventDefault();
                deleteAllData({ type: "jutsu" });
              }}
            >
              {isDeleting ? (
                <Loader explanation="Deleting data" />
              ) : (
                <>
                  Are you sure you want to clear all jutsu battle action data? This
                  action cannot be undone and will reset all jutsu usage statistics.
                  This action will be logged for future audit and review.
                </>
              )}
            </Confirm2>
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

      {/* Jutsu Details Modal */}
      <Modal2
        title="Jutsu Details"
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
        proceed_label={null}
      >
        {isJutsuDetailsPending ? (
          <Loader explanation="Loading jutsu details" />
        ) : (
          jutsuDetails && <ItemWithEffects item={jutsuDetails} showStatistic="jutsu" />
        )}
      </Modal2>
    </ContentBox>
  );
};
