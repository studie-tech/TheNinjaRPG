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
import ItemBalanceFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/ItemBalanceFiltering";
import ItemFiltering, {
  getFilter as getItemFilter,
  useFiltering as useItemFiltering,
} from "@/layout/ItemFiltering";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal2 from "@/layout/Modal2";
import NavTabs from "@/layout/NavTabs";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { showMutationToast } from "@/libs/toast";
import { groupBy } from "@/utils/grouping";
import { canChangeContent } from "@/utils/permissions";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserData } from "@/utils/UserContext";

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
  const { data: userData } = useUserData();

  // Get filter object
  const filter = getItemFilter(state);

  // Queries
  const { data, isPending } = api.data.getItemEffectsBalanceStatistics.useQuery(filter);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string>("");

  // Get item details for modal
  const { data: itemDetails, isPending: isItemDetailsPending } = api.item.get.useQuery(
    { id: selectedItemId },
    { enabled: !!selectedItemId },
  );

  // Can edit items
  const canEdit = canChangeContent(userData?.role ?? "USER");

  // Process data for table
  const tableData = data
    ?.flatMap((item) => {
      return item.effects.map((effect) => {
        return {
          name: item.name,
          links: (
            <div className="flex items-center gap-2">
              <Link href={`/manual/item/statistics/${item.id}`}>
                <BarChart3 className="h-4 w-4 text-muted-foreground hover:text-primary" />
              </Link>
              {canEdit && (
                <Link href={`/manual/item/edit/${item.id}`}>
                  <Pencil className="h-4 w-4 text-muted-foreground hover:text-primary" />
                </Link>
              )}
              <InfoIcon
                className="h-4 w-4 text-muted-foreground hover:text-primary"
                onClick={() => {
                  setSelectedItemId(item.id);
                  setIsModalOpen(true);
                }}
              />
            </div>
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
    { key: "name", header: "Item", type: "string" },
    { key: "links", header: "Links", type: "jsx" },
    { key: "itemType", header: "Type", type: "capitalized" },
    { key: "effect", header: "Effect", type: "string" },
    { key: "rarity", header: "Rarity", type: "capitalized" },
    { key: "power", header: "Power", type: "number" },
    { key: "rounds", header: "Rounds", type: "number" },
    { key: "powerPerLevel", header: "PowerPerLvl", type: "number" },
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

      {/* Item Details Modal */}
      <Modal2
        title="Item Details"
        isOpen={isModalOpen}
        setIsOpen={setIsModalOpen}
        proceed_label={null}
      >
        {isItemDetailsPending ? (
          <Loader explanation="Loading item details" />
        ) : (
          itemDetails && <ItemWithEffects item={itemDetails} showStatistic="item" />
        )}
      </Modal2>
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
  const { data: userData } = useUserData();

  // Get filter object
  const filter = getFilter(filterState);

  // Queries
  const { data, isPending } = api.data.getItemBalanceStatistics.useQuery(filter);
  const { data: itemNames } = api.item.getAllNames.useQuery();

  // Mutations
  const { mutate: deleteAllData, isPending: isDeleting } =
    api.data.deleteAllDataBattleAction.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) {
          // Invalidate the item balance statistics query to refresh the data
          await utils.data.getItemBalanceStatistics.invalidate();
        }
      },
    });

  const utils = api.useUtils();

  // Create mapping from item names to IDs
  const itemNameToId = useMemo(() => {
    if (!itemNames) return new Map<string, string>();
    return new Map(itemNames.map((item) => [item.name, item.id]));
  }, [itemNames]);

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

        // Get equipped count from the first entry (all entries for an item will have the same equipped count)
        const equippedCount = entries[0]?.equippedCount || 0;

        const itemId = itemNameToId.get(name);
        const nameWithIcon = itemId ? (
          <div key={itemId} className="flex items-center gap-2">
            <span>{name}</span>
            <Link href={`/manual/item/statistics/${itemId}`}>
              <BarChart3 className="h-4 w-4 text-muted-foreground hover:text-primary" />
            </Link>
          </div>
        ) : (
          name
        );

        return {
          name: nameWithIcon,
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
  type ItemBalanceRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<ItemBalanceRow, keyof ItemBalanceRow>[] = [
    {
      key: "name",
      header: "Item",
      type: "jsx",
    },
    { key: "totalUsage", header: "Total Usage", type: "number" },
    { key: "equippedCount", header: "Equipped", type: "number" },
    { key: "wins", header: "Wins", type: "number" },
    { key: "flees", header: "Flees", type: "number" },
    { key: "losses", header: "Losses", type: "number" },
    {
      key: "winRate",
      header: "Win Rate",
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
            <Confirm2
              title="Clear All Item Battle Data"
              button={
                <Button size="icon">
                  <Trash2 className="h-5 w-5 cursor-pointer" />
                </Button>
              }
              proceed_label="Clear Data"
              confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onAccept={(e) => {
                e.preventDefault();
                deleteAllData({ type: "item" });
              }}
            >
              {isDeleting ? (
                <Loader explanation="Deleting data" />
              ) : (
                <>
                  Are you sure you want to clear all item battle action data? This
                  action cannot be undone and will reset all item usage statistics. This
                  action will be logged for future audit and review.
                </>
              )}
            </Confirm2>
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
