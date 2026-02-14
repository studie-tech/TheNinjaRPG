"use client";

import { Clock } from "lucide-react";
import Link from "next/link";
import { api } from "@/app/_trpc/client";
import AvatarImage from "@/layout/Avatar";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Loader from "@/layout/Loader";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { getFirstOfNextMonth } from "@/utils/time";
import type { ArrayElement } from "@/utils/typeutils";
import { useUserData } from "@/utils/UserContext";

export default function TowerDefenseLeaderboard() {
  const { data: userData } = useUserData();

  // Fetch leaderboard data
  const { data: runs, isPending } = api.towerDefense.getLeaderboard.useQuery({
    limit: 50,
  });

  if (!userData) return <Loader explanation="Loading user data..." />;

  // Process data for the table
  const tableData = runs?.map((run, index) => ({
    ...run,
    rank: index + 1,
    user: (
      <div className="flex items-center gap-2">
        <Link href={`/username/${run.user.username}`}>
          <div className="w-10">
            <AvatarImage href={run.user.avatar} alt={run.user.username} size={100} />
          </div>
        </Link>
        <div>
          <Link href={`/username/${run.user.username}`} className="font-bold">
            {run.user.username}
          </Link>
          <p className="text-muted-foreground text-xs">{run.user.rank}</p>
        </div>
      </div>
    ),
  }));

  type RunWithJSX = ArrayElement<typeof tableData>;

  const columns: ColumnDefinitionType<RunWithJSX, keyof RunWithJSX>[] = [
    { key: "rank", header: "Rank", type: "number" },
    { key: "user", header: "Player", type: "jsx" },
    { key: "score", header: "Score", type: "number" },
    { key: "wave", header: "Wave", type: "number" },
    { key: "startedAt", header: "Date", type: "date" },
  ];

  return (
    <ContentBox
      title="Tower Defense Leaderboard"
      subtitle="Top performing runs"
      defaultBackHref="/manual/towerDefense"
      padding={false}
    >
      {/* Monthly Reset Notice */}
      <div className="border-b p-4">
        <div className="flex items-center justify-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <Clock className="h-5 w-5 text-amber-500" />
          <div className="text-center">
            <p className="font-semibold text-amber-600 dark:text-amber-400">
              Leaderboard resets on the 1st of every month
            </p>
            <p className="text-muted-foreground text-sm">
              Next reset in:{" "}
              <Countdown targetDate={getFirstOfNextMonth()} className="font-bold" />
            </p>
          </div>
        </div>
      </div>

      {isPending && <Loader explanation="Loading leaderboard..." />}
      {!isPending && tableData && tableData.length > 0 && (
        <Table data={tableData} columns={columns} />
      )}
      {!isPending && tableData && tableData.length === 0 && (
        <p className="p-4 text-center text-muted-foreground">
          No completed runs found on the leaderboard yet.
        </p>
      )}
    </ContentBox>
  );
}
