"use client";

import { BarChart3 } from "lucide-react";
import type React from "react";
import { useEffect } from "react";
import { api } from "@/app/_trpc/client";
import { useLocalStorage } from "@/hooks/localstorage";
import { useContentDetails } from "@/hooks/useContentDetails";
import { ClearBattleDataButton } from "@/layout/ClearDataConfirm";
import ContentBox from "@/layout/ContentBox";
import { ContentDetailsModal } from "@/layout/ContentDetailsModal";
import { ContentLinksCell } from "@/layout/ContentLinksCell";
import ItemBalanceFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/ItemBalanceFiltering";
import ItemFiltering, {
  getFilter as getItemFilter,
  useFiltering as useItemFiltering,
} from "@/layout/ItemFiltering";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import NavTabs from "@/layout/NavTabs";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { summarizeBattleOutcomes } from "@/libs/statistics";
import { groupBy } from "@/utils/grouping";
import { canChangeContent } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserDataSelector } from "@/utils/UserContext";

export default function ManualItemsBalance() {
  // State
  const availableTabs = ["Usage", "Power"];
  type Tab = (typeof availableTabs)[number];
  const [tab, setTab] = useLocalStorage<Tab>("itemBalanceTab", "Usage", true);

  const NavBarBlock = (
    <NavTabs current={tab} options={availableTabs} setValue={setTab} />
  );

  return (
    <>
      {tab === "Usage" && <ItemUsageBalance navTabs={NavBarBlock} />}
      {tab === "Power" && <ItemEffectsBalance navTabs={NavBarBlock} />}
    </>
  );
}

/**
 * Item Effects Balance
 */
interface ItemEffectsBalanceProps {
  navTabs: React.ReactNode;
}

const ItemEffectsBalance: React.FC<ItemEffectsBalanceProps> = (props) => {
  // Two-level filtering
  const state = useItemFiltering();
  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));

  // Get filter object
  const filter = getItemFilter(state);

  // Queries
  const { data, isPending } = api.data.getItemEffectsBalanceStatistics.useQuery(filter);

  const details = useContentDetails();

  // Can edit items
  const canEdit = canChangeContent(userData?.role ?? "USER");

  // Process data for table
  const tableData = data
    ?.flatMap((item) => {
      return item.effects.map((effect) => {
        return {
          name: item.name,
          links: (
            <ContentLinksCell
              type="item"
              id={item.id}
              canEdit={canEdit}
              onInfo={() => details.open(item.id)}
            />
          ),
          rarity: item.rarity,
          itemType: item.itemType,
          slot: item.slot,
          effect: effect.type,
          power: effect.power,
          rounds: effect.rounds ?? "N/A",
          powerPerLevel: effect.powerPerLevel,
        };
      });
    })
    .sort((a, b) => b.power - a.power);

  // Table columns
  type ItemBalanceRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<ItemBalanceRow, keyof ItemBalanceRow>[] = [
    { key: "name", header: "Name", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "itemType", header: "Type", type: "capitalized" },
    { key: "effect", header: "Effect", type: "string" },
    { key: "rarity", header: "Rarity", type: "capitalized" },
    { key: "power", header: "Power", type: "number" },
    { key: "rounds", header: "Rounds", type: "number" },
    { key: "powerPerLevel", header: "Power/Level", type: "number" },
  ];

  // Set the default filters
  useEffect(() => {
    state.setOnlyInShop(undefined);
    state.setEffect(["damage"]);
  }, []);

  return (
    <ContentBox
      title="Item Effects Balance"
      subtitle="Review Item Power Balance"
      padding={false}
      defaultBackHref="/manual/item"
      topRightContent={
        <div className="flex flex-row items-center">
          {props.navTabs}
          <ItemFiltering state={state} />
        </div>
      }
    >
      <p className="p-3">Get an overview of the power of each item effect</p>
      {isPending && <Loader explanation="Loading data" />}
      {!isPending && tableData && <Table data={tableData} columns={columns} />}
      {!isPending && tableData && tableData.length === 0 && (
        <div className="px-3 pb-3">
          No data found. You must select at least one effect type in the filter!
        </div>
      )}

      <ContentDetailsModal type="item" {...details} />
    </ContentBox>
  );
};

/**
 * Item Usage Balance
 */
interface ItemUsageBalanceProps {
  navTabs: React.ReactNode;
}

const ItemUsageBalance: React.FC<ItemUsageBalanceProps> = (props) => {
  // State
  const filterState = useFiltering();
  const { data: userData } = useUserDataSelector((u) => ({ role: u.role }));

  // Get filter object
  const filter = getFilter(filterState);

  // Queries
  const { data, isPending } = api.data.getItemBalanceStatistics.useQuery(filter);

  const utils = api.useUtils();

  // Process data for table
  const tableData =
    data &&
    (() => {
      const groups = groupBy(data, "itemId");
      const rows = Array.from(groups.entries()).map(([itemId, entries]) => {
        const name = entries[0]?.name ?? itemId;
        const outcomes = summarizeBattleOutcomes(entries);

        // Get equipped count from the first entry (all entries for an item will have the same equipped count)
        const equippedCount = entries[0]?.equippedCount || 0;

        const nameWithIcon = (
          <div key={itemId} className="flex items-center gap-2">
            <span>{name}</span>
            <Link href={`/manual/item/statistics/${itemId}`}>
              <BarChart3 className="h-4 w-4 text-muted-foreground hover:text-primary" />
            </Link>
          </div>
        );

        return {
          name: nameWithIcon,
          equippedCount,
          ...outcomes,
        };
      });

      // Sort by total usage descending
      return rows.sort((a, b) => b.totalUsage - a.totalUsage);
    })();

  // Table columns
  type ItemBalanceRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<ItemBalanceRow, keyof ItemBalanceRow>[] = [
    {
      key: "name",
      header: "Name",
      type: "jsx",
    },
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

  // Check if user can change content
  const canDelete = canChangeContent(userData?.role ?? "USER");

  return (
    <ContentBox
      title="Item Balance"
      subtitle="Data since last reset"
      defaultBackHref="/manual/item"
      padding={false}
      topRightContent={
        <div className="flex items-center gap-2">
          {props.navTabs}
          <ItemBalanceFiltering state={filterState} />
          {canDelete && (
            <ClearBattleDataButton
              type="item"
              label="item"
              onCleared={() => utils.data.getItemBalanceStatistics.invalidate()}
            />
          )}
        </div>
      }
    >
      <p className="p-3">
        Here we aim to give an overview of item usage & win-statistics, so as to make it
        transparent if any item or combination of items is over/under-powered and in
        need of balance adjustment.
      </p>
      {isPending && <Loader explanation="Loading data" />}
      {!isPending && tableData && <Table data={tableData} columns={columns} />}
    </ContentBox>
  );
};
