"use client";

import { sentenceCase as label } from "change-case";
import { Check } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  EVENT_TOURNAMENT_READY_SECONDS,
  EVENT_TOURNAMENT_RETENTION_DAYS,
} from "@/drizzle/constants";
import { useLiveCountdown } from "@/hooks/useLiveCountdown";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import UserSearchSelect from "@/layout/UserSearchSelect";
import { getRewardArray } from "@/libs/objectives";
import { showMutationToast } from "@/libs/toast";
import { canManageTournaments } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import type { UserSearchResult } from "@/validators/register";
import type { EventGame, EventTournamentState } from "@/validators/tournament";

const TournamentEditor = dynamic(
  () =>
    import("@/layout/EventTournamentEditor").then(
      (module) => module.EventTournamentEditor,
    ),
  { loading: () => <Loader explanation="Loading tournament editor" /> },
);

/**
 * Shared player/staff view with advisory series readiness separate from match acceptance.
 * Mutations refresh details, listings and both global notice surfaces.
 */
export const EventTournaments = ({
  tournamentId,
  staff = false,
}: {
  tournamentId?: string;
  staff?: boolean;
}) => {
  const { data: user, status: userStatus } = useUserData();
  const reconcile = useEventActionCache();
  const [editing, setEditing] = useState(false);
  const canManage = canManageTournaments(user?.role ?? "USER");
  const list = api.tournament.listEvents.useQuery(undefined, {
    enabled: !tournamentId,
    refetchInterval: 15000,
  });
  const details = api.tournament.getEvent.useQuery(
    { tournamentId: tournamentId ?? "" },
    { enabled: !!tournamentId, refetchInterval: 5000 },
  );
  const utils = api.useUtils();
  const refresh = async () => {
    await Promise.all([
      utils.tournament.getEvent.invalidate(),
      utils.tournament.listEvents.invalidate(),
      utils.tournament.getEventNotices.invalidate(),
    ]);
  };
  const [message, setMessage] = useState("");
  const manage = api.tournament.manageEvent.useMutation({
    onSettled: reconcile.settle,
    onSuccess: async (result) => {
      setMessage(result.message);
      showMutationToast(result);
      await Promise.all([refresh(), reconcile.apply()]);
    },
  });
  const participate = api.tournament.participateEvent.useMutation({
    onSettled: reconcile.settle,
    onSuccess: async (result) => {
      setMessage(result.message);
      showMutationToast(result);
      await Promise.all([refresh(), reconcile.apply()]);
    },
  });
  const event = details.data?.eventData;
  const pending = manage.isPending || participate.isPending;
  const playerAction = (
    action: "JOIN" | "WITHDRAW" | "DECLINE" | "ACCEPT" | "READY" | "NOT_READY",
    seriesId?: string,
  ) => {
    if (tournamentId)
      participate.mutate({
        tournamentId,
        action,
        seriesId,
        originSocketId: reconcile.originSocketId(),
      });
  };
  const staffAction = (
    action: "PUBLISH" | "SEED" | "BEGIN" | "CANCEL",
    extra: { payRewards?: boolean; scheduledAt?: number; seriesId?: string } = {},
  ) => {
    if (tournamentId)
      manage.mutate({
        tournamentId,
        action,
        ...extra,
        originSocketId: reconcile.originSocketId(),
      });
  };
  if (userStatus === "pending") return <Loader explanation="Loading your account" />;
  if (staff && !canManage)
    return (
      <ContentBox title="Tournaments">
        <p>Content, event or coding staff access is required.</p>
      </ContentBox>
    );
  if (list.isError || details.isError)
    return (
      <ContentBox title="Tournaments">
        <p role="alert">Could not load tournaments.</p>
        <Button onClick={() => (tournamentId ? details.refetch() : list.refetch())}>
          Try again
        </Button>
      </ContentBox>
    );
  if ((tournamentId && details.isLoading) || (!tournamentId && list.isLoading))
    return <Loader explanation="Loading tournaments" />;
  if (tournamentId && !event)
    return (
      <ContentBox title="Tournament unavailable">
        <Link href="/tournaments">Back to tournaments</Link>
      </ContentBox>
    );
  if (editing && canManage)
    return (
      <TournamentEditor
        tournamentId={tournamentId}
        initial={event?.config}
        onSaved={() => {
          setEditing(false);
          void refresh();
        }}
      />
    );
  if (!event)
    return (
      <ContentBox
        title={staff ? "Manage tournaments" : "Wake Island Tournaments"}
        subtitle="Staff-hosted competitions at the Colosseum"
        defaultBackHref={staff ? "/manual" : "/colosseum"}
      >
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p>Register at Wake Island. Staff generate brackets and begin each round.</p>
          {canManage && (
            <Button onClick={() => setEditing(true)}>Create tournament</Button>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {list.data?.map(
            (row) =>
              row.eventData && (
                <Link
                  key={row.id}
                  href={`${staff ? "/manual/tournaments" : "/tournaments"}/${row.id}`}
                  className="rounded-lg border bg-card p-4 text-card-foreground hover:bg-accent"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-bold text-lg">{row.eventData.config.name}</h2>
                    <Badge variant="outline">{label(row.eventData.status)}</Badge>
                  </div>
                  <p className="mt-2 text-sm">{row.eventData.config.description}</p>
                  <p className="mt-3 text-muted-foreground text-sm">
                    {label(row.eventData.config.format)} ·{" "}
                    {label(row.eventData.config.rules)} rules ·{" "}
                    {row.eventData.participantCount}/{row.eventData.config.capacity}{" "}
                    slots
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Registration closes{" "}
                    {date(row.eventData.config.registrationClosesAt)}
                  </p>
                </Link>
              ),
          )}
        </div>
        {!list.data?.length && (
          <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
            No tournaments have been announced.
          </p>
        )}
        <p className="mt-4 text-muted-foreground text-xs">
          Completed brackets remain available for {EVENT_TOURNAMENT_RETENTION_DAYS}{" "}
          days.
        </p>
      </ContentBox>
    );
  const seat = event.participants.find(
    (p) => p.userId === user?.userId && !p.withdrawn,
  );
  const rounds = [...new Set(event.series.map((s) => s.round))].sort((a, b) => a - b);
  const currentRound = Math.min(
    ...event.series.filter((s) => !s.complete).map((s) => s.round),
  );
  const seatName = (id: string | null) =>
    event.participants.find((p) => p.id === id)?.username ??
    "Bye / no advancing player";
  return (
    <ContentBox
      title={event.config.name}
      subtitle="Wake Island Colosseum"
      defaultBackHref={staff ? "/manual/tournaments" : "/tournaments"}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge>{label(event.status)}</Badge>
        <Badge variant="outline">{label(event.config.format)}</Badge>
        <Badge variant="outline">{label(event.config.rules)} rules</Badge>
        <Badge variant="outline">{label(event.config.registration)}</Badge>
        <Badge variant="outline">{label(event.config.scheduling)}</Badge>
      </div>
      <p>{event.config.description}</p>
      <p className="mt-2 text-sm">
        Registration closes {date(event.config.registrationClosesAt)}. Event ends{" "}
        {date(event.config.endsAt)}.
      </p>
      <p className="mt-2 text-muted-foreground text-sm">
        Best of {event.config.bestOf}, with round overrides shown below. Each game has a{" "}
        {EVENT_TOURNAMENT_READY_SECONDS / 60}-minute ready check. Be awake and available
        at Wake Island to accept. AI rules can be edited between games. Exhibition
        matches award no ordinary combat progression or PvP statistics.
      </p>
      {event.config.format === "ROUND_ROBIN" && (
        <p className="mt-2 text-sm">
          Standings use series wins, then game wins, then original seed to break ties.
        </p>
      )}
      {event.scheduledRoundAt && (
        <p className="mt-2 font-semibold">
          Next round scheduled for {date(event.scheduledRoundAt)}
        </p>
      )}
      {message && (
        <p role="status" className="my-3 rounded-md border p-3">
          {message}
        </p>
      )}
      <div className="my-4 rounded-lg border p-4">
        <h2 className="font-bold">
          Registration · {event.participants.filter((p) => !p.withdrawn).length}/
          {event.config.capacity} slots reserved
        </h2>
        <p className="text-sm">
          PvP brackets {event.config.minBracket}–{event.config.maxBracket}; at least{" "}
          {event.config.minPvpWins} PvP wins, {event.config.minWinRate}% win rate and{" "}
          {event.config.minMasteredJutsu} mastered jutsu.
        </p>
        <p className="text-muted-foreground text-xs">
          Eligibility is frozen when you register. Invitations reserve a slot and
          require acceptance.
        </p>
        {event.status === "REGISTRATION" && !seat?.accepted && (
          <div className="mt-3 space-y-2">
            {details.data?.eligibility.map((reason) => (
              <p key={reason} className="text-destructive text-sm">
                {reason}
              </p>
            ))}
            <Button
              disabled={pending || !!details.data?.eligibility.length}
              onClick={() => playerAction("JOIN")}
            >
              {seat?.invited ? "Accept invitation" : "Join tournament"}
            </Button>
            {seat?.invited && (
              <Button
                variant="outline"
                className="ml-2"
                disabled={pending}
                onClick={() => playerAction("DECLINE")}
              >
                Decline invitation
              </Button>
            )}
          </div>
        )}
        {seat?.accepted && !["COMPLETED", "CANCELLED"].includes(event.status) && (
          <Button
            className="mt-3"
            variant="outline"
            disabled={pending}
            onClick={() => playerAction("WITHDRAW")}
          >
            Withdraw from tournament
          </Button>
        )}
        <section
          className="mt-4 grid gap-4 sm:grid-cols-2"
          aria-label="Tournament invitation status"
        >
          {[true, false].map((accepted) => {
            const participants = event.participants.filter(
              (p) => !p.withdrawn && p.accepted === accepted,
            );
            return (
              <section key={String(accepted)}>
                <h3 className="mb-2 font-semibold text-sm">
                  {accepted ? "Confirmed participants" : "Pending invitations"} (
                  {participants.length})
                </h3>
                <div className="flex flex-wrap gap-2">
                  {participants.map((p) => (
                    <Badge variant={accepted ? "secondary" : "outline"} key={p.id}>
                      {accepted && (
                        <Check className="mr-1 h-3 w-3" aria-hidden="true" />
                      )}
                      {p.seed ? `#${p.seed} ` : ""}
                      {p.username}
                    </Badge>
                  ))}
                  {!participants.length && (
                    <p className="text-muted-foreground text-sm">None</p>
                  )}
                </div>
              </section>
            );
          })}
        </section>
      </div>
      {canManage && (
        <StaffTournamentControls
          event={event}
          currentRound={currentRound}
          tournamentId={tournamentId ?? ""}
          pending={pending}
          onEdit={() => setEditing(true)}
          onAction={staffAction}
        />
      )}
      <details className="my-4 rounded-lg border p-3">
        <summary className="cursor-pointer font-bold">Tournament rewards</summary>
        <p className="my-2 text-muted-foreground text-sm">
          Rewards are paid after the entire event completes. Per-win rewards count
          series wins with played games. Cancellation can pay earned participation and
          series-win rewards.
        </p>
        {Object.entries(event.config.rewards).map(([key, reward]) => (
          <div key={key} className="mb-2">
            <h3 className="font-semibold">{label(key)}</h3>
            <p className="text-sm">
              {getRewardArray(reward).join(", ") || "No rewards"}
            </p>
          </div>
        ))}
      </details>
      {!!event.standings.length && (
        <div className="mb-4 rounded-lg border p-4">
          <h2 className="font-bold">Final standings</h2>
          {event.standings.map((id, i) => (
            <p key={id ?? `empty-${i}`}>
              {i + 1}. {id ? seatName(id) : "No placement"}
            </p>
          ))}
        </div>
      )}
      <div className="space-y-6">
        {rounds.map((round) => (
          <section key={round}>
            <h2 className="mb-2 font-bold text-lg">Round {round}</h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {event.series
                .filter((s) => s.round === round)
                .map((series) => {
                  const game = series.games.at(-1);
                  const inSeries = !!seat && series.seats.includes(seat.id);
                  // Readiness tracks players, while bracket rows use stable seat IDs.
                  const readySeatIds = new Set(
                    event.participants
                      .filter(
                        (participant) =>
                          !participant.withdrawn &&
                          series.readyUserIds?.includes(participant.userId),
                      )
                      .map((participant) => participant.id),
                  );
                  return (
                    <div
                      className={`rounded-lg border p-4 ${inSeries && !series.complete ? "border-orange-500 bg-orange-500/5" : "bg-card"}`}
                      key={series.id}
                    >
                      <div className="flex justify-between gap-2">
                        <Badge variant="outline">{label(series.bracket)}</Badge>
                        <span className="text-muted-foreground text-sm">
                          Best of {series.bestOf}
                        </span>
                      </div>
                      <div className="my-3 space-y-2">
                        {series.seats.map((id, i) => (
                          <div
                            key={`${series.id}-${i}`}
                            className="flex justify-between gap-2"
                          >
                            <span
                              className={
                                series.complete && id === series.winnerId
                                  ? "font-bold text-orange-500"
                                  : ""
                              }
                            >
                              {series.resolved
                                ? seatName(id)
                                : "Awaiting previous match"}
                              {!series.begun &&
                                !series.complete &&
                                series.round === currentRound &&
                                id &&
                                readySeatIds.has(id) && (
                                  <span className="ml-2 inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                                    <Check className="h-4 w-4" aria-hidden="true" />{" "}
                                    Ready
                                  </span>
                                )}
                            </span>
                            <b>{series.scores[i]}</b>
                          </div>
                        ))}
                      </div>
                      {series.complete ? (
                        <p className="text-sm">
                          {series.winnerId
                            ? `Advances: ${seatName(series.winnerId)}`
                            : "No advancing player"}
                        </p>
                      ) : event.status === "CANCELLED" ? (
                        <p className="text-sm">Cancelled</p>
                      ) : game?.status === "READY" ? (
                        <ReadyCheck
                          game={game}
                          gameNumber={series.games.length}
                          userId={user?.userId ?? ""}
                          inSeries={inSeries}
                          pending={pending}
                          onAccept={() => playerAction("ACCEPT", series.id)}
                        />
                      ) : game?.status === "FIGHTING" ? (
                        <Link
                          className="font-semibold text-orange-500 underline"
                          href={inSeries ? "/combat" : `/battlelog/${game.battleId}`}
                        >
                          {inSeries ? "Enter battle" : "Spectate live"}
                        </Link>
                      ) : (
                        <p className="text-muted-foreground text-sm">
                          {game?.status === "STARTING"
                            ? "Starting battle…"
                            : series.scheduledAt
                              ? `Scheduled ${date(series.scheduledAt)}`
                              : "Waiting for staff to begin"}
                        </p>
                      )}
                      {inSeries &&
                        seat?.accepted &&
                        !series.begun &&
                        !series.complete &&
                        series.resolved &&
                        series.round === currentRound &&
                        ["PREPARED", "RUNNING"].includes(event.status) && (
                          <div className="mt-3 space-y-2">
                            <p className="text-muted-foreground text-sm">
                              Let staff know you are ready for this series. Staff still
                              begin the match.
                            </p>
                            <Button
                              variant="outline"
                              disabled={pending}
                              onClick={() =>
                                playerAction(
                                  series.readyUserIds?.includes(user?.userId ?? "")
                                    ? "NOT_READY"
                                    : "READY",
                                  series.id,
                                )
                              }
                            >
                              {series.readyUserIds?.includes(user?.userId ?? "")
                                ? "Cancel ready"
                                : "Ready for next round"}
                            </Button>
                          </div>
                        )}
                      {canManage &&
                        event.config.scheduling === "SEQUENTIAL" &&
                        ["PREPARED", "RUNNING"].includes(event.status) &&
                        series.round === currentRound &&
                        !series.begun &&
                        !series.complete &&
                        series.resolved && (
                          <Button
                            className="mt-2"
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                              staffAction("BEGIN", { seriesId: series.id })
                            }
                          >
                            Begin series
                          </Button>
                        )}
                      {!!series.games.length && (
                        <details className="mt-3 text-xs">
                          <summary className="cursor-pointer">Game history</summary>
                          {series.games.map((g, i) => (
                            <p key={g.id}>
                              Game {i + 1}: {label(g.outcome ?? g.status)}
                              {g.winnerId
                                ? ` · ${event.participants.find((p) => p.userId === g.winnerId)?.username ?? g.winnerId}`
                                : ""}
                              {g.outcome === "BATTLE" && (
                                <>
                                  {" "}
                                  ·{" "}
                                  <Link
                                    href={`/battlelog/${g.battleId}`}
                                    className="underline"
                                  >
                                    Battle log
                                  </Link>
                                </>
                              )}
                            </p>
                          ))}
                        </details>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
      {canManage && (
        <details className="mt-5 rounded-lg border p-3">
          <summary className="cursor-pointer font-bold">Staff audit log</summary>
          {[...event.audit].reverse().map((a, i) => (
            <p className="text-xs" key={`${a.at}-${i}`}>
              {date(a.at)} · {a.action} · {a.userId}
            </p>
          ))}
        </details>
      )}
    </ContentBox>
  );
};

/** Show the current game's acceptance window, including the delay between series games. */
const ReadyCheck = ({
  game,
  gameNumber,
  userId,
  inSeries,
  pending,
  onAccept,
}: {
  game: EventGame;
  gameNumber: number;
  userId: string;
  inSeries: boolean;
  pending: boolean;
  onAccept: () => void;
}) => {
  const seconds = useLiveCountdown((game.deadline - Date.now()) / 1000);
  const accepted = game.accepted.includes(userId);
  return (
    <div className="space-y-2">
      <p className="text-sm">
        Game {gameNumber}:{" "}
        {Date.now() < game.opensAt
          ? `Opens ${date(game.opensAt)}`
          : `Accept by ${date(game.deadline)} (${Math.ceil(seconds)}s)`}
      </p>
      <p className="text-sm">
        {game.accepted.length}/2 accepted{accepted ? " · You accepted" : ""}
      </p>
      {inSeries && (
        <Button
          disabled={pending || Date.now() < game.opensAt || seconds <= 0 || accepted}
          onClick={onAccept}
        >
          Accept match
        </Button>
      )}
    </div>
  );
};

/** Staff roster and scheduling actions, using the same current round as the series cards. */
const StaffTournamentControls = ({
  event,
  currentRound,
  tournamentId,
  pending,
  onEdit,
  onAction,
}: {
  event: EventTournamentState;
  currentRound: number;
  tournamentId: string;
  pending: boolean;
  onEdit: () => void;
  onAction: (
    action: "PUBLISH" | "SEED" | "BEGIN" | "CANCEL",
    extra?: { payRewards?: boolean; scheduledAt?: number; seriesId?: string },
  ) => void;
}) => {
  const [scheduledAt, setScheduledAt] = useState("");
  const [seatId, setSeatId] = useState("");
  const [message, setMessage] = useState("");
  const form = useForm<{ username: string; users: UserSearchResult[] }>({
    defaultValues: { username: "", users: [] },
  });
  const utils = api.useUtils();
  const reconcile = useEventActionCache();
  const mutation = api.tournament.manageEvent.useMutation({
    onSettled: reconcile.settle,
    onSuccess: async (result) => {
      setMessage(result.message);
      showMutationToast(result);
      await Promise.all([
        utils.tournament.getEvent.invalidate(),
        utils.tournament.listEvents.invalidate(),
        utils.tournament.getEventNotices.invalidate(),
        reconcile.apply(),
      ]);
    },
  });
  const applyRoster = (action: "INVITE" | "REMOVE_INVITE" | "SUBSTITUTE") =>
    mutation.mutate({
      tournamentId,
      action,
      seatId: seatId || undefined,
      userId: form.getValues("users")[0]?.userId,
      originSocketId: reconcile.originSocketId(),
    });
  if (event.status === "COMPLETED") return null;
  if (event.status === "CANCELLED")
    return !event.payRewards ? (
      <div className="my-4 rounded-lg border p-4">
        <p className="mb-2">
          This tournament was cancelled without rewards. Staff may still pay earned
          participation and series-win rewards.
        </p>
        <Button
          disabled={pending}
          onClick={() => onAction("CANCEL", { payRewards: true })}
        >
          Pay earned cancellation rewards
        </Button>
      </div>
    ) : null;
  return (
    <div className="my-4 space-y-3 rounded-lg border border-orange-500/50 p-4">
      <h2 className="font-bold">Staff controls</h2>
      <div className="flex flex-wrap gap-2">
        {event.status === "DRAFT" && (
          <>
            <Button onClick={onEdit}>Edit draft</Button>
            <Button disabled={pending} onClick={() => onAction("PUBLISH")}>
              Open registration
            </Button>
          </>
        )}
        {event.status === "REGISTRATION" && (
          <Button disabled={pending} onClick={() => onAction("SEED")}>
            Close registration & generate bracket
          </Button>
        )}
        {["PREPARED", "RUNNING"].includes(event.status) && (
          <Button disabled={pending} onClick={() => onAction("BEGIN")}>
            {event.config.scheduling === "SEQUENTIAL"
              ? "Begin next series"
              : "Begin round"}
          </Button>
        )}
      </div>
      {["PREPARED", "RUNNING"].includes(event.status) && (
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor="event-scheduled-start" className="space-y-1 text-sm">
            Schedule next round / series
            <Input
              id="event-scheduled-start"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </label>
          <Button
            variant="outline"
            disabled={pending || !scheduledAt}
            onClick={() =>
              onAction("BEGIN", {
                scheduledAt: new Date(scheduledAt).getTime(),
                seriesId:
                  event.config.scheduling === "SEQUENTIAL"
                    ? event.series.find(
                        (s) =>
                          s.round === currentRound &&
                          !s.complete &&
                          !s.begun &&
                          s.resolved,
                      )?.id
                    : undefined,
              })
            }
          >
            Schedule start
          </Button>
        </div>
      )}
      {event.status !== "DRAFT" && (
        <details>
          <summary className="cursor-pointer font-semibold">
            Invitations & substitutions
          </summary>
          <div className="mt-3 space-y-3">
            <UserSearchSelect
              useFormMethods={form}
              showYourself
              showAi={false}
              maxUsers={1}
              label="Player"
            />
            <label className="block text-sm">
              Existing seat (for overwrite, removal or substitution)
              <select
                className="mt-1 block w-full rounded-md border bg-background p-2"
                value={seatId}
                onChange={(e) => setSeatId(e.target.value)}
              >
                <option value="">New invitation</option>
                {event.participants.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.username}
                    {p.withdrawn ? " (withdrawn)" : !p.accepted ? " (invited)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              {event.status === "REGISTRATION" ? (
                <>
                  <Button
                    disabled={mutation.isPending}
                    onClick={() => applyRoster("INVITE")}
                  >
                    Invite / overwrite invitation
                  </Button>
                  <Button
                    variant="outline"
                    disabled={mutation.isPending || !seatId}
                    onClick={() => applyRoster("REMOVE_INVITE")}
                  >
                    Withdraw invitation
                  </Button>
                </>
              ) : (
                <Button
                  disabled={mutation.isPending || !seatId}
                  onClick={() => applyRoster("SUBSTITUTE")}
                >
                  Substitute player in seat
                </Button>
              )}
            </div>
            {message && (
              <p role="status" className="text-sm">
                {message}
              </p>
            )}
          </div>
        </details>
      )}
      <details>
        <summary className="cursor-pointer text-destructive">Cancel tournament</summary>
        <p className="my-2 text-sm">
          Cancellation closes the tournament. Finish active games first. Choose whether
          earned participation and series-win rewards are paid.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() => onAction("CANCEL", { payRewards: false })}
          >
            Cancel without rewards
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onAction("CANCEL", { payRewards: true })}
          >
            Cancel and pay earned rewards
          </Button>
        </div>
      </details>
    </div>
  );
};

/** Display event timestamps in the player's browser locale and time zone. */
const date = (value: number) => new Date(value).toLocaleString();

/** Reconcile synchronized launches, rewards and participation through the profile query. */
const useEventActionCache = () => {
  const { pusher } = useUserData();
  const utils = api.useUtils();
  return {
    originSocketId: () => pusher?.connection.socket_id,
    // Preserve the global error toast while recovering an action whose response was lost.
    settle: (_result: unknown, error: unknown) => {
      if (error)
        return Promise.all([
          utils.profile.getUser.invalidate(),
          utils.tournament.getEvent.invalidate(),
          utils.tournament.listEvents.invalidate(),
          utils.tournament.getEventNotices.invalidate(),
        ]);
    },
    apply: () => utils.profile.getUser.invalidate(),
  };
};
