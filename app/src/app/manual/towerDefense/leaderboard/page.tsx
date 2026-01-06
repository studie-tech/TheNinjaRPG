"use client";

import { api } from "@/app/_trpc/client";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import AvatarImage from "@/layout/Avatar";
import Link from "next/link";
import { useUserData } from "@/utils/UserContext";
import type { ArrayElement } from "@/utils/typeutils";

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
          <p className="text-xs text-muted-foreground">{run.user.rank}</p>
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
      {isPending && <Loader explanation="Loading leaderboard..." />}
      {!isPending && tableData && tableData.length > 0 && (
        <Table data={tableData} columns={columns} />
      )}
      {!isPending && tableData && tableData.length === 0 && (
        <p className="p-4 text-muted-foreground text-center">
          No completed runs found on the leaderboard yet.
        </p>
      )}
    </ContentBox>
  );
}
