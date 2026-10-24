"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  TERRITORY_WAR_AI_POINTS,
  TERRITORY_WAR_BOOST_HOURS,
  TERRITORY_WAR_BOOST_PERCENT,
  TERRITORY_WAR_DURATION_MINUTES,
  TERRITORY_WAR_INTERVAL_HOURS,
  TERRITORY_WAR_PVP_POINTS,
  TERRITORY_WAR_TARGET_POINTS,
  TERRITORY_WAR_TEAM_SIZE,
  TERRITORY_WAR_TOKEN_REWARD,
} from "@/drizzle/constants";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { pushToCombat } from "@/utils/routing";
import { useRequiredUserData } from "@/utils/UserContext";

export default function TerritoryWarPage() {
  const { data: user, timeDiff, updateUser } = useRequiredUserData();
  const router = useRouter();
  const utils = api.useUtils();
  const [feedback, setFeedback] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const current = api.territoryWar.getCurrent.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const onSuccess = async (result: { success: boolean; message?: string }) => {
    setFeedback({ success: result.success, message: result.message ?? "Updated team" });
    await Promise.all([
      utils.territoryWar.invalidate(),
      utils.profile.getUser.invalidate(),
    ]);
  };
  const onError = (error: { message: string }) =>
    setFeedback({ success: false, message: error.message });
  const create = api.territoryWar.createTeam.useMutation({
    onMutate: () => setFeedback(null),
    onSuccess,
    onError,
  });
  const join = api.territoryWar.joinTeam.useMutation({
    onMutate: () => setFeedback(null),
    onSuccess,
    onError,
  });
  const leave = api.territoryWar.leaveTeam.useMutation({
    onMutate: () => setFeedback(null),
    onSuccess,
    onError,
  });
  const start = api.territoryWar.startBattle.useMutation({
    onMutate: () => setFeedback(null),
    onError,
    onSuccess: async (result) => {
      if (result.success && result.battleId) {
        await updateUser({
          status: "BATTLE",
          battleId: result.battleId,
          updatedAt: new Date(),
        });
        pushToCombat(router, result.battleId);
      } else await onSuccess(result);
    },
  });
  useRefreshAt(
    [current.data?.event?.endsAt, current.data?.boostUntil, current.data?.nextStartsAt],
    () => void current.refetch(),
    timeDiff,
  );
  const pending =
    create.isPending || join.isPending || leave.isPending || start.isPending;
  const {
    event,
    teams = [],
    scores = [],
    competitor,
    boostUntil,
    nextStartsAt,
  } = current.data ?? {};
  const active =
    !!event && !event.resolvedAt && event.endsAt.getTime() > Date.now() - timeDiff;
  const ownTeam = teams.find((team) =>
    team.queue.some((member) => member.userId === user?.userId),
  );
  const inSector = user?.sector === event?.sector;
  return (
    <ContentBox
      title="Territory Wars"
      subtitle="One battlefield. Every village and faction."
      defaultBackHref="/travel"
    >
      <div className="space-y-5">
        {current.isLoading && <Loader explanation="Loading Territory War" />}
        {current.error && (
          <Alert variant="destructive">
            <AlertDescription>
              Unable to load Territory Wars.{" "}
              <Button variant="outline" onClick={() => void current.refetch()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {feedback && (
          <Alert variant={feedback.success ? "default" : "destructive"}>
            <AlertDescription>{feedback.message}</AlertDescription>
          </Alert>
        )}
        {boostUntil && boostUntil.getTime() > Date.now() - timeDiff && (
          <Alert>
            <AlertDescription>
              <p>
                Victory bonus: +{TERRITORY_WAR_BOOST_PERCENT}% training and profession
                experience, and {TERRITORY_WAR_BOOST_PERCENT}% shorter crafting and
                cooking. Ends in{" "}
                <Countdown targetDate={boostUntil} timeDiff={timeDiff} />.
              </p>
            </AlertDescription>
          </Alert>
        )}
        {active && event ? (
          <section
            className="space-y-3 rounded-lg border bg-popover p-4"
            aria-label="Active Territory War"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-xl">Sector {event.sector}</h2>
                <p>
                  Closes in{" "}
                  <Countdown
                    targetDate={event.endsAt}
                    timeDiff={timeDiff}
                    onEndShow="Closed"
                  />
                </p>
              </div>
              <Link
                href={`/travel?sector=${event.sector}`}
                className="font-semibold text-orange-600 underline"
              >
                View sector on map
              </Link>
            </div>
            <p>
              You represent <b>{competitor?.name}</b>. Defeat the War Camp guardian for{" "}
              {TERRITORY_WAR_AI_POINTS} points per winning teammate, or win PvP here for{" "}
              {TERRITORY_WAR_PVP_POINTS} points per opponent.
            </p>
            {!inSector && (
              <p className="text-muted-foreground">
                Travel to sector {event.sector} to form or join a guardian team.
              </p>
            )}
            {user?.status === "BATTLE" && (
              <Link href="/combat" className="underline">
                Return to your battle
              </Link>
            )}
            {!ownTeam && (
              <Button
                disabled={pending || !inSector || user?.status !== "AWAKE"}
                onClick={() => create.mutate({ eventId: event.id })}
              >
                Create guardian team
              </Button>
            )}
            <fieldset className="min-w-0 space-y-3">
              <legend className="sr-only">Guardian teams</legend>
              {teams
                .filter((team) => team.queue.length > 0)
                .map((team) => {
                  const joined = team.id === ownTeam?.id;
                  return (
                    <div
                      key={team.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div>
                        <b>
                          {joined ? "Your team" : "Open team"} · {team.queue.length}/
                          {TERRITORY_WAR_TEAM_SIZE}
                        </b>
                        <p className="text-sm">
                          {team.queue.map((member) => member.user.username).join(", ")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {joined ? (
                          <>
                            <Button
                              disabled={pending || !inSector}
                              onClick={() => start.mutate({ teamId: team.id })}
                            >
                              Attack guardian
                            </Button>
                            <Button
                              variant="outline"
                              disabled={pending}
                              onClick={() => leave.mutate({ teamId: team.id })}
                            >
                              Leave
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            disabled={
                              pending ||
                              !!ownTeam ||
                              !inSector ||
                              user?.status !== "AWAKE" ||
                              team.queue.length >= TERRITORY_WAR_TEAM_SIZE
                            }
                            onClick={() => join.mutate({ teamId: team.id })}
                          >
                            Join team
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </fieldset>
            {ownTeam && (
              <p className="text-muted-foreground text-sm">
                Start with one to {TERRITORY_WAR_TEAM_SIZE} players from your
                competitor. Each team fights one guardian.
              </p>
            )}
          </section>
        ) : (
          !current.isLoading &&
          !current.error && (
            <section className="rounded-lg border p-4">
              <h2 className="font-semibold">No Territory War is active</h2>
              {nextStartsAt ? (
                <p>
                  Next event in{" "}
                  <Countdown
                    targetDate={nextStartsAt}
                    timeDiff={timeDiff}
                    onEndShow="a moment"
                  />
                  .
                </p>
              ) : (
                <p>
                  The next guardian will be announced here and in global notifications.
                </p>
              )}
              {event && !scores.some((score) => score.rewarded) && (
                <p>
                  No competitor reached {TERRITORY_WAR_TARGET_POINTS} points. No rewards
                  were awarded.
                </p>
              )}
            </section>
          )
        )}
        <section className="space-y-2" aria-label="Territory War standings">
          <h2 className="font-bold text-lg">
            {active ? "Live standings" : "Latest standings"} · First to{" "}
            {TERRITORY_WAR_TARGET_POINTS}
          </h2>
          {scores.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b">
                    <th className="p-2">Competitor</th>
                    <th className="p-2 text-right">Points</th>
                    <th className="p-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.map((score) => (
                    <tr key={score.competitorId} className="border-b">
                      <td className="p-2">
                        {score.name}
                        {score.competitorId === competitor?.id ? " (you)" : ""}
                      </td>
                      <td className="p-2 text-right font-semibold tabular-nums">
                        {score.points}
                      </td>
                      <td className="p-2">
                        {score.rewarded ? "Winner" : active ? "Competing" : "Finished"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground">No points scored yet.</p>
          )}
        </section>
        <section className="space-y-2 rounded-lg border p-4">
          <h2 className="font-semibold">Victory spoils</h2>
          <p>
            {TERRITORY_WAR_TOKEN_REWARD.toLocaleString()} tokens for the winning
            village, Syndicate, hideout or stronghold. Factions without a settlement
            receive the same amount in clan points.
          </p>
          <p>
            Members receive +{TERRITORY_WAR_BOOST_PERCENT}% to all training and
            profession experience, with {TERRITORY_WAR_BOOST_PERCENT}% shorter crafting
            and cooking, for {TERRITORY_WAR_BOOST_HOURS} hour. These bonuses stack with
            other boosts.
          </p>
          <p className="text-muted-foreground text-sm">
            Events last up to {TERRITORY_WAR_DURATION_MINUTES} minutes and end as soon
            as a competitor reaches {TERRITORY_WAR_TARGET_POINTS} points. A tie at the
            target grants both competitors the bonus. No rewards below the target. The
            next event starts {TERRITORY_WAR_INTERVAL_HOURS} hours after the previous
            one ends. Unaffiliated outlaws represent Syndicate.
          </p>
        </section>
      </div>
    </ContentBox>
  );
}
