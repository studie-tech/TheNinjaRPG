"use client";

import { BarChart3, InfoIcon, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { useLocalStorage } from "@/hooks/localstorage";
import BloodlineBalanceFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/BloodlineBalanceFiltering";
import BloodlineFiltering, {
  getFilter as getBloodlineFilter,
  useFiltering as useBloodlineFiltering,
} from "@/layout/BloodlineFiltering";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import NavTabs from "@/layout/NavTabs";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { showMutationToast } from "@/libs/toast";
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
  }, []);

  // Can edit bloodline
  const canEdit = canChangeContent(userData?.role ?? "USER");

  const tableData = data
    ?.flatMap((bloodline) => {
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
  const tableData = data
    ?.map((entry) => {
      const bloodlineId = bloodlineNameToId.get(entry.name);

      return {
        name: entry.name,
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
