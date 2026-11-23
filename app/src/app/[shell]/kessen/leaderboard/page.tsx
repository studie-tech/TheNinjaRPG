"use client";

import { Trophy } from "lucide-react";
import { useKessenLeaderboard } from "@/hooks/kessen/useKessenPvpLobby";
import ContentBox from "@/layout/ContentBox";
import { RankedLadder } from "@/layout/kessen/hub/RankedLadder";

/** The ranked Kessen ladder by Elo rating, open to everyone. */
export default function KessenLeaderboardPage() {
  const leaderboard = useKessenLeaderboard();
  return (
    <ContentBox
      title="Kessen Leaderboard"
      subtitle="The best duelists, by ranked Elo rating"
      defaultBackHref="/kessen"
      padding={false}
    >
      <div className="border-b p-4">
        <div className="flex items-center justify-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <Trophy className="h-5 w-5 shrink-0 text-amber-500" />
          <div className="text-center">
            <p className="font-semibold text-amber-600 dark:text-amber-400">
              Ranked by Elo rating
            </p>
            <p className="text-muted-foreground text-sm">
              Win ranked duels to climb the leaderboard.
            </p>
          </div>
        </div>
      </div>
      <RankedLadder
        leaderboard={leaderboard.data ?? null}
        error={leaderboard.isError ? leaderboard.error.message : null}
        onRetry={() => void leaderboard.refetch()}
      />
    </ContentBox>
  );
}
