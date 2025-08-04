"use client";

import React, { useMemo } from "react";
import { groupBy } from "@/utils/grouping";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { Button } from "@/components/ui/button";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { api } from "@/app/_trpc/client";
import ItemBalanceFiltering, {
  useFiltering,
  getFilter,
} from "@/layout/ItemBalanceFiltering";
import Link from "next/link";
import { BarChart3, Trash2 } from "lucide-react";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import { canChangeContent } from "@/utils/permissions";
import Confirm2 from "@/layout/Confirm2";
import { showMutationToast } from "@/libs/toast";

export default function ManualItemsBalance() {
  // State
  const filterState = useFiltering();
  const { data: userData } = useRequiredUserData();

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
          <div className="flex items-center gap-2">
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
    <>
      <ContentBox
        title="Item Balance"
        subtitle="Data since last reset"
        back_href="/manual/item"
        padding={false}
        topRightContent={
          <div className="flex items-center gap-2">
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
                    action cannot be undone and will reset all item usage statistics.
                    This action will be logged for future audit and review.
                  </>
                )}
              </Confirm2>
            )}
          </div>
        }
      >
        <p className="p-3">
          Here we aim to give an overview of item usage & win-statistics, so as to make
          it transparent if any item or combination of items is over/under-powered and
          in need of balance adjustment.
        </p>
        {isPending && <Loader explanation="Loading data" />}
        {!isPending && tableData && <Table data={tableData} columns={columns} />}
      </ContentBox>
    </>
  );
}
