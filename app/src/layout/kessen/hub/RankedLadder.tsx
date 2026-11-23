"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import AvatarImage from "@/layout/Avatar";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { QueryError } from "@/layout/QueryError";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import type { KessenLeaderboard, KessenLeaderboardEntry } from "@/validators/kessen";

/** The ranked leaderboard, including the viewer's place outside the displayed rows. */
export const RankedLadder = ({
  leaderboard,
  error,
  onRetry,
}: {
  leaderboard: KessenLeaderboard | null;
  error: string | null;
  onRetry: () => void;
}) => {
  const you = leaderboard?.you ?? null;
  const rows = (leaderboard?.entries ?? []).map((entry) =>
    ladderRow(entry, entry.userId === you?.userId),
  );
  const youListed = you !== null && rows.some((row) => row.id === you.userId);
  if (error && !leaderboard) {
    return (
      <QueryError
        className="p-4"
        message={`The leaderboard could not be loaded: ${error}`}
        onRetry={onRetry}
      />
    );
  }
  if (!leaderboard) return <Loader explanation="Loading leaderboard..." />;
  return (
    <>
      {rows.length > 0 ? (
        <Table data={rows} columns={LADDER_COLUMNS} />
      ) : (
        <p className="text-muted-foreground p-4 text-center">
          No ranked duels yet. Play a ranked duel to join the leaderboard.
        </p>
      )}
      {you && !youListed ? (
        <p className="text-muted-foreground border-t p-4 text-sm tabular-nums">
          {`Your place: #${you.rank} · ${you.rating} · ${you.wins}W ${you.losses}L ${you.draws}D`}
        </p>
      ) : null}
    </>
  );
};

/** An Elo entry with the minigames' avatar/name presentation and ranked record. */
const ladderRow = (entry: KessenLeaderboardEntry, isYou: boolean): LadderRow => ({
  id: entry.userId,
  place: (
    <span className="flex items-center gap-1 tabular-nums">
      {entry.rank}
      {isYou ? <Badge className="px-1 py-0 text-xs">You</Badge> : null}
    </span>
  ),
  user: (
    <div className="flex items-center gap-2">
      <Link
        href={`/username/${entry.username}`}
        aria-label={`View ${entry.username}'s profile`}
      >
        <div className="w-10">
          <AvatarImage href={entry.avatar} alt="" size={100} />
        </div>
      </Link>
      <div>
        <Link href={`/username/${entry.username}`} className="font-bold">
          {entry.username}
        </Link>
        <p className="text-muted-foreground text-xs">Level {entry.level}</p>
      </div>
    </div>
  ),
  rating: entry.rating,
  wins: entry.wins,
  losses: entry.losses,
  draws: entry.draws,
});

const LADDER_COLUMNS: ColumnDefinitionType<LadderRow, keyof LadderRow>[] = [
  { key: "place", header: "Rank", type: "jsx" },
  { key: "user", header: "Player", type: "jsx" },
  { key: "rating", header: "Rating", type: "number" },
  { key: "wins", header: "Wins", type: "number" },
  { key: "losses", header: "Losses", type: "number" },
  { key: "draws", header: "Draws", type: "number" },
];

type LadderRow = {
  id: string;
  place: ReactNode;
  user: ReactNode;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
};
