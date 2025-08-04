"use client";

import React, { useMemo } from "react";
import { groupBy } from "@/utils/grouping";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { Button } from "@/components/ui/button";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { api } from "@/app/_trpc/client";
import AiBalanceFiltering, {
  useFiltering,
  getFilter,
} from "@/layout/AiBalanceFiltering";
import Link from "next/link";
import { BarChart3, Trash2 } from "lucide-react";
import type { ArrayElement } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import { canChangeContent } from "@/utils/permissions";
import Confirm2 from "@/layout/Confirm2";
import { showMutationToast } from "@/libs/toast";

export default function ManualAIsBalance() {
  // State
  const filterState = useFiltering();
  const { data: userData } = useRequiredUserData();

  // Get filter object
  const filter = getFilter(filterState);

  // Queries
  const { data, isPending } = api.data.getAiBalanceStatistics.useQuery(filter);

  // Mutations
  const { mutate: deleteAllData, isPending: isDeleting } =
    api.data.deleteAllDataBattleAction.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success) {
          // Invalidate the AI balance statistics query to refresh the data
          await utils.data.getAiBalanceStatistics.invalidate();
        }
      },
    });

  const utils = api.useUtils();

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

        // Extract AI ID from the name or use the aiUserId
        const aiUserId = entries[0]?.aiUserId;
        const nameWithIcon = aiUserId ? (
          <div className="flex items-center gap-2">
            <span>{name}</span>
            <Link href={`/manual/ai/statistics/${aiUserId}`}>
              <BarChart3 className="h-4 w-4 text-muted-foreground hover:text-primary" />
            </Link>
          </div>
        ) : (
          name
        );

        return {
          name: nameWithIcon,
          totalUsage,
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
  type AiBalanceRow = ArrayElement<typeof tableData>;
  const columns: ColumnDefinitionType<AiBalanceRow, keyof AiBalanceRow>[] = [
    {
      key: "name",
      header: "AI",
      type: "jsx",
    },
    { key: "totalUsage", header: "Total Usage", type: "number" },
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
        title="AI Balance"
        subtitle="Data since last reset"
        back_href="/manual/ai"
        padding={false}
        topRightContent={
          <div className="flex items-center gap-2">
            <AiBalanceFiltering state={filterState} />
            {canDelete && (
              <Confirm2
                title="Clear All AI Battle Data"
                button={
                  <Button size="icon">
                    <Trash2 className="h-5 w-5 cursor-pointer" />
                  </Button>
                }
                proceed_label="Clear Data"
                confirmClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onAccept={(e) => {
                  e.preventDefault();
                  deleteAllData({ type: "ai" });
                }}
              >
                {isDeleting ? (
                  <Loader explanation="Deleting data" />
                ) : (
                  <>
                    Are you sure you want to clear all AI battle action data? This
                    action cannot be undone and will reset all AI usage statistics. This
                    action will be logged for future audit and review.
                  </>
                )}
              </Confirm2>
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
    </>
  );
}
