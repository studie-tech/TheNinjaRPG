"use client";

import "@/screens/kessen/hall.css";
import { Eye } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useWatchedKessenDuel } from "@/hooks/kessen/useKessenDuel";
import { useKessenCatalog } from "@/hooks/kessen/useKessenHub";
import { useNavigationRouter } from "@/hooks/navigation";
import { EmptyState } from "@/layout/EmptyState";
import { HallBox } from "@/layout/kessen/hub/HallBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { QueryError } from "@/layout/QueryError";
import { useRequiredUserInfo } from "@/utils/UserContext";

/**
 * A Kessen duel between two players, watched read-only on the Card Hall's table: both
 * hands hidden, seen from the first player's side, following each turn live until the
 * result. The way back leads to the tavern, where such duels are announced. A player
 * seated in the live duel is sent to the Card Hall, which opens their own table.
 */
export function KessenWatchScreen(props: { params: { matchid: string } }) {
  const { matchid } = props.params;
  const router = useNavigationRouter();
  const { data: userId } = useRequiredUserInfo();
  const duel = useWatchedKessenDuel(matchid, !!userId);
  const catalog = useKessenCatalog(!!userId);
  const { match } = duel;
  const leave = () => router.push(TAVERN_HREF);
  const isSeated =
    !!match &&
    match.status === "ACTIVE" &&
    match.players.some((player) => player.userId === userId);
  useEffect(() => {
    if (isSeated) router.replace(SEAT_HREF);
  }, [isSeated, router]);

  if (isSeated) return <Loader explanation="Taking your seat" />;
  if (match && catalog.data) {
    const [first, second] = match.players;
    return (
      <HallBox
        scene={{
          title: "Spectating",
          label: `${first.username} vs ${second.username} · ${match.kind === "RANKED" ? "Ranked" : "Friendly"} duel`,
          onLeave: leave,
          content: (
            <KessenMatchView
              key={match.id}
              payload={match}
              log={duel.log}
              catalog={catalog.data.cards}
              onAction={refuse}
              onConcede={() => undefined}
              onClose={leave}
              spectating
            />
          ),
        }}
      >
        {null}
      </HallBox>
    );
  }
  const error = duel.error ?? catalog.error;
  return (
    <HallBox
      title="Spectating"
      subtitle="A Kessen duel"
      backHref={TAVERN_HREF}
      leaderboardLink={false}
    >
      {error ? (
        <QueryError
          layout="panel"
          message={`The duel could not be loaded: ${error.message}`}
          onRetry={() => void Promise.all([duel.refetch(), catalog.refetch()])}
          isRetrying={duel.isFetching || catalog.isFetching}
        />
      ) : duel.data && !match ? (
        <EmptyState
          icon={Eye}
          title="This duel is not at the table"
          description="The link may be mistyped, or the duel was cleared away."
          action={
            <Button asChild variant="outline">
              <Link href={TAVERN_HREF}>Back to the tavern</Link>
            </Button>
          }
        />
      ) : (
        <Loader explanation="Finding the duel" />
      )}
    </HallBox>
  );
}

// The table, its playback and its stylesheet load only once the duel is in hand.
const KessenMatchView = dynamic(
  () => import("@/layout/kessen/match/MatchView").then((mod) => mod.KessenMatchView),
  { ssr: false, loading: () => <Loader explanation="Setting the table" /> },
);

const TAVERN_HREF = "/tavern";

/** The Card Hall opens the player's live duel on arrival, over its Duels section. */
const SEAT_HREF = "/kessen?tab=duels";

/** A spectator's table sends nothing; its controls never offer a play. */
const refuse = async () => ({ ok: false, message: "Spectators cannot play." });
