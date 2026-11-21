"use client";

import { Clock } from "lucide-react";
import { api } from "@/app/_trpc/client";
import AvatarImage from "@/layout/Avatar";
import { formatClock } from "@/layout/ChakraStormHud";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import { getFirstOfNextMonth } from "@/utils/time";
import type { ArrayElement } from "@/utils/typeutils";

/** This month's longest verified Undercover runs, one per player. */
export default function ChakraStormLeaderboard() {
  const { data: runs, isPending } = api.chakraStorm.getLeaderboard.useQuery({
    limit: 50,
  });

  const tableData = runs?.map((run, index) => ({
    rank: index + 1,
    time: formatClock(run.seconds),
    kills: run.kills,
    level: run.level,
    createdAt: run.createdAt,
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

  type Row = ArrayElement<typeof tableData>;

  const columns: ColumnDefinitionType<Row, keyof Row>[] = [
    { key: "rank", header: "Rank", type: "number" },
    { key: "user", header: "Player", type: "jsx" },
    { key: "time", header: "Cover held", type: "string" },
    { key: "kills", header: "Defeated", type: "number" },
    { key: "level", header: "Level", type: "number" },
    { key: "createdAt", header: "Date", type: "date" },
  ];

  return (
    <ContentBox
      title="Undercover Leaderboard"
      subtitle="Longest Chakra Storm covers this month"
      defaultBackHref="/chakraStorm"
      padding={false}
    >
      <div className="border-b p-4">
        <div className="flex items-center justify-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <Clock className="h-5 w-5 shrink-0 text-amber-500" />
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
        <p className="text-muted-foreground p-4 text-center">
          No verified Undercover runs this month yet. Open Undercover by scouting the
          City of Mei for ten minutes, then see how long your cover holds.
        </p>
      )}
    </ContentBox>
  );
}
