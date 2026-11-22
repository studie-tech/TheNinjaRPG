"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { QueryError } from "@/layout/QueryError";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import type { KessenLeaderboard, KessenLeaderboardEntry } from "@/validators/kessen";

/**
 * The ranked ladder by Elo rating, with the signed-in player's own place when it is
 * outside the top rows. The Duels tab and the Kessen leaderboard page show it.
 */
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
  return (
    <section
      className="kh-panel flex flex-col gap-2 p-3"
      aria-labelledby="kessen-ladder"
    >
      <h3 id="kessen-ladder" className="kh-heading text-[18px] leading-tight">
        Ranked ladder
      </h3>
      {error && !leaderboard ? (
        <QueryError
          message={`The ladder could not be loaded: ${error}`}
          onRetry={onRetry}
        />
      ) : (
        <Table
          compact
          data={leaderboard ? rows : undefined}
          columns={LADDER_COLUMNS}
          linkColumn="username"
          linkPrefix="/username/"
          isLoading={!leaderboard}
          emptyText="No rated duels yet. Win one to open the ladder."
        />
      )}
      {leaderboard && !youListed ? (
        <p className="text-muted-foreground text-[11px] tabular-nums">
          {you
            ? `Your place: #${you.rank} · ${you.rating} · ${you.wins}W ${you.losses}L ${you.draws}D`
            : "Play a ranked duel to join the ladder."}
        </p>
      ) : null}
    </section>
  );
};

/** A ladder entry as a table row: the rank (marked for the player), and the record. */
const ladderRow = (entry: KessenLeaderboardEntry, isYou: boolean): LadderRow => ({
  id: entry.userId,
  place: (
    <span className="flex items-center gap-1 tabular-nums">
      #{entry.rank}
      {isYou ? <Badge className="px-1 py-0 text-[11px]">You</Badge> : null}
    </span>
  ),
  avatar: entry.avatar ?? "",
  username: entry.username,
  rating: entry.rating,
  record: (
    <span className="whitespace-nowrap tabular-nums">
      {entry.wins}-{entry.losses}-{entry.draws}
    </span>
  ),
});

const LADDER_COLUMNS: ColumnDefinitionType<LadderRow, keyof LadderRow>[] = [
  { key: "place", header: "#", type: "jsx" },
  { key: "avatar", header: "", type: "avatar" },
  { key: "username", header: "Player", type: "string" },
  { key: "rating", header: "Rating", type: "number" },
  { key: "record", header: "W-L-D", type: "jsx" },
];

type LadderRow = {
  id: string;
  place: ReactNode;
  avatar: string;
  username: string;
  rating: number;
  record: ReactNode;
};
