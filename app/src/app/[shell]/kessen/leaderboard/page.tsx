"use client";

import { useKessenLeaderboard } from "@/hooks/kessen/useKessenPvpLobby";
import { HallBox } from "@/layout/kessen/hub/HallBox";
import { RankedLadder } from "@/layout/kessen/hub/RankedLadder";

/** The ranked Kessen ladder by Elo rating, open to everyone. */
export default function KessenLeaderboardPage() {
  const leaderboard = useKessenLeaderboard();
  return (
    <HallBox
      title="Kessen Leaderboard"
      subtitle="The best duelists, by ranked Elo rating"
      backHref="/kessen"
      leaderboardLink={false}
    >
      <RankedLadder
        leaderboard={leaderboard.data ?? null}
        error={leaderboard.isError ? leaderboard.error.message : null}
        onRetry={() => void leaderboard.refetch()}
      />
    </HallBox>
  );
}
