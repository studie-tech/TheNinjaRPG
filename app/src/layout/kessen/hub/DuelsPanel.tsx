"use client";

import "../kessen.css";
import "./hub.css";
import { Check, Coins, LogOut, Play, Search, Swords, Trash2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  type KessenPvpOutcome,
  useKessenLeaderboard,
  useKessenPvpLobby,
} from "@/hooks/kessen/useKessenPvpLobby";
import { OpponentFinder } from "@/layout/battlearena/OpponentFinder";
import Confirm from "@/layout/Confirm";
import Countdown, { QueueTimer } from "@/layout/Countdown";
import { EmptyState } from "@/layout/EmptyState";
import { FeedbackAlert } from "@/layout/FeedbackAlert";
import Loader from "@/layout/Loader";
import { QueryError } from "@/layout/QueryError";
import Table, { type ColumnDefinitionType } from "@/layout/Table";
import type { DeckFaction } from "@/libs/kessen/deck";
import { showMutationToast } from "@/libs/toast";
import { capitalizeFirstLetter } from "@/utils/string";
import { formatClockTime } from "@/utils/time";
import type {
  KessenChallenge,
  KessenDeckSource,
  KessenLeaderboard,
  KessenLeaderboardEntry,
  KessenPvpLobby,
} from "@/validators/kessen";
import { type DeckChoice, DeckPicker, useDeckChoice } from "./DeckPicker";
import type { KessenDeckSummary } from "./hubData";

/**
 * The Card Hall's Duels tab: the player's rating and ranked record, the duel in progress,
 * the ranked queue, friendly challenges to and from other players, a player finder to
 * challenge someone and the ranked ladder. An unfinished Circuit or lesson match, like a
 * duel in progress, holds new duels back until it is resumed and finished.
 */
export const DuelsPanel = ({
  decks,
  defaultDeckId,
  loanerFaction,
  npcMatch,
  queueMessage,
  onOpenDuel,
  onResumeNpc,
}: DuelsPanelProps) => {
  const pvp = useKessenPvpLobby();
  const leaderboard = useKessenLeaderboard();
  const lobby = pvp.lobby.data;
  if (!lobby) {
    return pvp.lobby.isError ? (
      <QueryError
        layout="panel"
        message={`The duel lobby could not be loaded: ${pvp.lobby.error.message}`}
        onRetry={() => void pvp.lobby.refetch()}
        isRetrying={pvp.lobby.isFetching}
      />
    ) : (
      <Loader explanation="Opening the duel lobby" />
    );
  }
  return (
    <DuelsView
      lobby={lobby}
      leaderboard={leaderboard.data ?? null}
      leaderboardError={leaderboard.isError ? leaderboard.error.message : null}
      onRetryLeaderboard={() => void leaderboard.refetch()}
      decks={decks}
      defaultDeckId={defaultDeckId}
      loanerFaction={loanerFaction}
      npcMatch={npcMatch}
      queueMessage={queueMessage}
      onOpenDuel={onOpenDuel}
      onResumeNpc={onResumeNpc}
      actions={pvp}
      renderFinder={(props) => <OpponentFinder {...props} />}
    />
  );
};

/** The Duels tab from loaded data; the finder is a slot so the view renders on its own. */
export const DuelsView = ({
  lobby,
  leaderboard,
  leaderboardError,
  onRetryLeaderboard,
  decks,
  defaultDeckId,
  loanerFaction,
  npcMatch,
  queueMessage,
  onOpenDuel,
  onResumeNpc,
  actions,
  renderFinder,
}: DuelsViewProps) => {
  // One deck for the ranked queue and new challenges; accepting a challenge picks its own.
  const deck = useDeckChoice(decks, defaultDeckId, loanerFaction);
  if (!lobby.lessonCompleted) {
    return (
      <EmptyState
        icon={Swords}
        title="Duels open after your first lesson"
        description="Finish First Blood at Lemu's Academy, then challenge other players or join the ranked queue."
      />
    );
  }
  const active = lobby.activeMatch;
  const blocked = active !== null || npcMatch !== null;
  return (
    <div className="flex flex-col gap-3 text-base">
      {active ? (
        <section
          className="flex flex-wrap items-center gap-3 kh-callout p-3"
          aria-label="Duel in progress"
        >
          <p className="min-w-0 flex-1">
            <span className="block font-semibold">
              {active.kind === "RANKED" ? "Ranked duel" : "Friendly duel"} against{" "}
              {active.opponent.username}
            </span>
            <span className="text-muted-foreground block text-[11px] tabular-nums">
              {active.yourTurn ? "Your move" : `${active.opponent.username} to move`}
              {active.deadline ? (
                <>
                  {" · "}
                  <Countdown targetDate={active.deadline} format={formatClockTime} />{" "}
                  left
                </>
              ) : null}
            </span>
          </p>
          <Button decoration="gold" onClick={() => onOpenDuel(active.id)}>
            <Play className="mr-2 h-4 w-4" aria-hidden />
            Resume vs {active.opponent.username}
          </Button>
        </section>
      ) : npcMatch ? (
        <section
          className="kh-callout flex flex-wrap items-center gap-3 p-3"
          aria-label="Unfinished match"
        >
          <p className="min-w-0 flex-1">
            {npcMatch.label} is unfinished. Finish or concede it before you duel.
          </p>
          <Button variant="outline" onClick={() => onResumeNpc(npcMatch.id)}>
            <Play className="mr-2 h-4 w-4" aria-hidden />
            Resume
          </Button>
        </section>
      ) : null}
      <section className={SECTION} aria-label="Duel deck">
        <DeckPicker decks={decks} idPrefix="duel" choice={deck} />
      </section>
      <div className="grid gap-3 @min-[640px]/kessen-hall:grid-cols-2">
        <RatingCard ranked={lobby.ranked} />
        <RankedQueue
          lobby={lobby}
          deck={deck}
          blocked={blocked}
          queueMessage={queueMessage}
          onOpenDuel={onOpenDuel}
          actions={actions}
        />
      </div>
      <ChallengeList
        challenges={lobby.challenges}
        decks={decks}
        defaultDeckId={defaultDeckId}
        loanerFaction={loanerFaction}
        blocked={blocked}
        onOpenDuel={onOpenDuel}
        actions={actions}
      />
      <ChallengePlayer
        challenges={lobby.challenges}
        deck={deck}
        blocked={blocked}
        actions={actions}
        renderFinder={renderFinder}
      />
      <Leaderboard
        leaderboard={leaderboard}
        error={leaderboardError}
        onRetry={onRetryLeaderboard}
      />
    </div>
  );
};

/** Rating, ranked record and what today's and this week's wins still pay. */
const RatingCard = ({ ranked }: { ranked: KessenPvpLobby["ranked"] }) => (
  <section className={SECTION} aria-labelledby="kessen-rating">
    <h3 id="kessen-rating" className={HEADING}>
      Your rating
    </h3>
    <p className="flex flex-wrap items-baseline gap-x-3">
      <span className="text-[28px] leading-none font-bold tabular-nums">
        {ranked.rating}
      </span>
      <span className="tabular-nums">
        {ranked.wins}W · {ranked.losses}L · {ranked.draws}D
        <span className="text-muted-foreground"> · {ranked.played} rated</span>
      </span>
    </p>
    <dl className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
      <dt>Ranked wins today</dt>
      <dd className="font-semibold tabular-nums">
        {ranked.rewardedToday}/{ranked.rewardedCap}
      </dd>
      <dt className="col-span-2">
        <Progress
          value={percent(ranked.rewardedToday, ranked.rewardedCap)}
          aria-label="Ranked wins today"
        />
      </dt>
      <dt>Weekly ranked pack</dt>
      <dd className="font-semibold tabular-nums">
        {Math.min(ranked.weeklyWins, ranked.weeklyPackWins)}/{ranked.weeklyPackWins}
      </dd>
      <dt className="col-span-2">
        <Progress
          value={percent(ranked.weeklyWins, ranked.weeklyPackWins)}
          aria-label="Wins towards the weekly ranked pack"
        />
      </dt>
    </dl>
    <p className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
      <Coins className="h-4 w-4 shrink-0" aria-hidden />A rewarded ranked win pays{" "}
      {ranked.winRyo.toLocaleString()} ryo. Friendly duels are for practice.
    </p>
  </section>
);

/** Joining the ranked queue with a deck, or the wait while it searches. */
const RankedQueue = ({
  lobby,
  deck,
  blocked,
  queueMessage,
  onOpenDuel,
  actions,
}: {
  lobby: KessenPvpLobby;
  deck: DeckChoice;
  blocked: boolean;
  queueMessage: string | null;
  onOpenDuel: (matchId: string) => void;
  actions: DuelActions;
}) => {
  const [error, setError] = useState<string | null>(null);
  const queue = lobby.queue;

  const join = async () => {
    setError(null);
    const outcome = await actions.joinRankedQueue(deck.source);
    if (outcome.matchId) onOpenDuel(outcome.matchId);
    else if (!outcome.ok) setError(outcome.message);
  };
  const leave = async () => {
    setError(null);
    const outcome = await actions.leaveRankedQueue();
    if (outcome.matchId) onOpenDuel(outcome.matchId);
    else if (outcome.ok) showMutationToast({ success: true, message: outcome.message });
    else setError(outcome.message);
  };
  const shownError = error ?? queueMessage;

  return (
    <section className={SECTION} aria-labelledby="kessen-ranked-queue">
      <h3 id="kessen-ranked-queue" className={HEADING}>
        Ranked queue
      </h3>
      {queue ? (
        <>
          <p className="flex items-center gap-2" role="status">
            <Search
              className="h-4 w-4 shrink-0 animate-pulse motion-reduce:animate-none"
              aria-hidden
            />
            <span>
              Searching for an opponent · <QueueTimer createdAt={queue.queuedAt} />
            </span>
          </p>
          <p className="text-muted-foreground text-[11px]">
            {lobby.queueCount === 1
              ? "1 player is searching."
              : `${lobby.queueCount} players are searching.`}{" "}
            The search widens the longer you wait.
          </p>
          <Button
            variant="outline"
            className="self-start"
            loading={actions.isLeaving}
            onClick={() => void leave()}
          >
            <LogOut className="mr-2 h-4 w-4" aria-hidden />
            Leave queue
          </Button>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-[11px]">
            Matched by rating against a player of similar strength. Each turn has a
            clock; a player who keeps running out of time forfeits.
          </p>
          <Button
            decoration="gold"
            className="self-start"
            disabled={blocked}
            loading={actions.isJoining}
            onClick={() => void join()}
          >
            <Swords className="mr-2 h-4 w-4" aria-hidden />
            Join the ranked queue
          </Button>
        </>
      )}
      {shownError ? (
        <FeedbackAlert feedback={{ success: false, message: shownError }} foreground />
      ) : null}
    </section>
  );
};

/** Pending challenges to and from the player, each with its answer and expiry. */
const ChallengeList = ({
  challenges,
  decks,
  defaultDeckId,
  loanerFaction,
  blocked,
  onOpenDuel,
  actions,
}: {
  challenges: readonly KessenChallenge[];
  decks: readonly KessenDeckSummary[];
  defaultDeckId: string | null;
  loanerFaction: DeckFaction;
  blocked: boolean;
  onOpenDuel: (matchId: string) => void;
  actions: DuelActions;
}) => {
  // Challenges whose expiry passed while the tab was open leave the list.
  const [expired, setExpired] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const shown = challenges.filter((challenge) => !expired.has(challenge.id));
  if (shown.length === 0) return null;

  const answer = async (
    challenge: KessenChallenge,
    run: (requestId: string) => Promise<KessenPvpOutcome>,
  ) => {
    setError(null);
    const outcome = await run(challenge.id);
    if (outcome.ok) showMutationToast({ success: true, message: outcome.message });
    else setError({ id: challenge.id, message: outcome.message });
  };

  return (
    <section className={SECTION} aria-labelledby="kessen-challenges">
      <h3 id="kessen-challenges" className={HEADING}>
        Challenges
      </h3>
      <ul aria-label="Challenges" className="flex flex-col gap-1.5">
        {shown.map((challenge) => {
          const { opponent } = challenge;
          return (
            <li
              key={challenge.id}
              className={`bg-muted flex flex-col gap-2 rounded-lg border p-2 ${challenge.outgoing ? "" : "border-primary"}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  {challenge.outgoing ? (
                    <>
                      You challenged <b>{opponent.username}</b>
                    </>
                  ) : (
                    <>
                      <b>{opponent.username}</b> challenged you
                    </>
                  )}
                  <span className="text-muted-foreground block text-[11px] tabular-nums">
                    Lv {opponent.level} {capitalizeFirstLetter(opponent.rank)}
                    {opponent.villageName ? ` · ${opponent.villageName}` : ""} · expires
                    in{" "}
                    <Countdown
                      targetDate={challenge.expiresAt}
                      format={formatClockTime}
                      onFinish={() =>
                        setExpired((current) => new Set(current).add(challenge.id))
                      }
                    />
                  </span>
                </span>
                {challenge.outgoing ? (
                  <Button
                    variant="outline"
                    disabled={actions.isAnswering}
                    aria-label={`Withdraw your challenge to ${opponent.username}`}
                    onClick={() => void answer(challenge, actions.cancelChallenge)}
                  >
                    <Trash2 className="mr-1 h-4 w-4" aria-hidden /> Cancel
                  </Button>
                ) : (
                  <span className="flex gap-1.5">
                    <AcceptChallenge
                      challenge={challenge}
                      decks={decks}
                      defaultDeckId={defaultDeckId}
                      loanerFaction={loanerFaction}
                      disabled={blocked || actions.isAnswering}
                      pending={actions.isAnswering}
                      onAccept={actions.acceptChallenge}
                      onOpenDuel={onOpenDuel}
                    />
                    <Button
                      variant="outline"
                      disabled={actions.isAnswering}
                      aria-label={`Decline the challenge from ${opponent.username}`}
                      onClick={() => void answer(challenge, actions.rejectChallenge)}
                    >
                      <X className="mr-1 h-4 w-4" aria-hidden /> Decline
                    </Button>
                  </span>
                )}
              </div>
              {error?.id === challenge.id ? (
                <FeedbackAlert
                  feedback={{ success: false, message: error.message }}
                  foreground
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

/** Accept opens a dialog to choose the deck the duel is played with. */
const AcceptChallenge = ({
  challenge,
  decks,
  defaultDeckId,
  loanerFaction,
  disabled,
  pending,
  onAccept,
  onOpenDuel,
}: {
  challenge: KessenChallenge;
  decks: readonly KessenDeckSummary[];
  defaultDeckId: string | null;
  loanerFaction: DeckFaction;
  disabled: boolean;
  pending: boolean;
  onAccept: DuelActions["acceptChallenge"];
  onOpenDuel: (matchId: string) => void;
}) => {
  const deck = useDeckChoice(decks, defaultDeckId, loanerFaction);
  const [error, setError] = useState<string | null>(null);
  const name = challenge.opponent.username;
  return (
    <Confirm
      title={`Duel ${name}`}
      proceed_label="Accept and take a seat"
      proceed_loading_label="Setting the table…"
      isLoading={pending}
      keepOpenOnAccept
      disabled={disabled}
      button={
        <Button disabled={disabled} aria-label={`Accept the challenge from ${name}`}>
          <Check className="mr-1 h-4 w-4" aria-hidden /> Accept
        </Button>
      }
      onClose={() => setError(null)}
      onAccept={(_event, { close }) => {
        setError(null);
        void onAccept({ requestId: challenge.id, deck: deck.source }).then(
          (outcome) => {
            if (!outcome.ok || !outcome.match) {
              setError(outcome.message);
              return;
            }
            close();
            onOpenDuel(outcome.match.id);
          },
        );
      }}
    >
      <div className="flex flex-col gap-3 text-left">
        <p>
          A friendly duel: no rating, rewards or progress. Both players sit at the table
          now, with a clock on every turn.
        </p>
        <DeckPicker decks={decks} idPrefix={`accept-${challenge.id}`} choice={deck} />
        {error ? (
          <FeedbackAlert feedback={{ success: false, message: error }} foreground />
        ) : null}
      </div>
    </Confirm>
  );
};

/** The player finder, challenging with the chosen deck; refusals show above it. */
const ChallengePlayer = ({
  challenges,
  deck,
  blocked,
  actions,
  renderFinder,
}: {
  challenges: readonly KessenChallenge[];
  deck: DeckChoice;
  blocked: boolean;
  actions: DuelActions;
  renderFinder: DuelsViewProps["renderFinder"];
}) => {
  const [error, setError] = useState<string | null>(null);
  const challengedIds = new Set(
    challenges
      .filter((challenge) => challenge.outgoing)
      .map((challenge) => challenge.opponent.userId),
  );
  const challenge = async (targetId: string) => {
    setError(null);
    const outcome = await actions.createChallenge({ targetId, deck: deck.source });
    if (outcome.ok) showMutationToast({ success: true, message: outcome.message });
    else setError(outcome.message);
  };
  return (
    <section className={SECTION} aria-labelledby="kessen-challenge-player">
      <h3 id="kessen-challenge-player" className={HEADING}>
        Challenge a player
      </h3>
      <p className="text-muted-foreground text-[11px]">
        A friendly duel for practice: no rating or rewards. Challenges expire after a
        few minutes.
      </p>
      {error ? (
        <FeedbackAlert feedback={{ success: false, message: error }} foreground />
      ) : null}
      {renderFinder({
        onChallenge: (targetId) => void challenge(targetId),
        challengedIds,
        isChallenging: blocked || actions.isChallenging,
      })}
    </section>
  );
};

/** The ranked ladder, with the player's own place when it is outside the top rows. */
const Leaderboard = ({
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
    <section className={SECTION} aria-labelledby="kessen-ladder">
      <h3 id="kessen-ladder" className={HEADING}>
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

const percent = (value: number, total: number) =>
  total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;

const LADDER_COLUMNS: ColumnDefinitionType<LadderRow, keyof LadderRow>[] = [
  { key: "place", header: "#", type: "jsx" },
  { key: "avatar", header: "", type: "avatar" },
  { key: "username", header: "Player", type: "string" },
  { key: "rating", header: "Rating", type: "number" },
  { key: "record", header: "W-L-D", type: "jsx" },
];

const SECTION = "kh-panel flex flex-col gap-2 p-3";
const HEADING = "kh-heading text-[18px] leading-tight";

type LadderRow = {
  id: string;
  place: ReactNode;
  avatar: string;
  username: string;
  rating: number;
  record: ReactNode;
};

/** The lobby actions the tab calls (see `useKessenPvpLobby`). */
type DuelActions = {
  createChallenge: (input: {
    targetId: string;
    deck: KessenDeckSource;
  }) => Promise<KessenPvpOutcome>;
  acceptChallenge: (input: {
    requestId: string;
    deck: KessenDeckSource;
  }) => Promise<KessenPvpOutcome>;
  rejectChallenge: (requestId: string) => Promise<KessenPvpOutcome>;
  cancelChallenge: (requestId: string) => Promise<KessenPvpOutcome>;
  joinRankedQueue: (deck: KessenDeckSource) => Promise<KessenPvpOutcome>;
  leaveRankedQueue: () => Promise<KessenPvpOutcome>;
  isChallenging: boolean;
  isAnswering: boolean;
  isJoining: boolean;
  isLeaving: boolean;
};

/** What the hall passes the Duels tab; the tab loads the lobby and ladder itself. */
export interface DuelsPanelProps {
  decks: readonly KessenDeckSummary[];
  defaultDeckId: string | null;
  loanerFaction: DeckFaction;
  /**
   * An unfinished Circuit or lesson match, which holds new duels back; `label` names it
   * as a sentence subject ("Your match against Kimiko").
   */
  npcMatch: { id: string; label: string } | null;
  /** Why the ranked queue's last poll removed the player (`useRankedQueuePolling`). */
  queueMessage: string | null;
  onOpenDuel: (matchId: string) => void;
  onResumeNpc: (matchId: string) => void;
}

/** `DuelsPanelProps` plus the loaded lobby, ladder and lobby actions. */
export interface DuelsViewProps extends DuelsPanelProps {
  lobby: KessenPvpLobby;
  leaderboard: KessenLeaderboard | null;
  leaderboardError: string | null;
  onRetryLeaderboard: () => void;
  actions: DuelActions;
  /** The player finder (OpponentFinder in the hall). */
  renderFinder: (props: {
    onChallenge: (targetId: string) => void;
    challengedIds: Set<string>;
    isChallenging: boolean;
  }) => ReactNode;
}
