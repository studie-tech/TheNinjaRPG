"use client";

import {
  ArrowRight,
  Check,
  Coins,
  GraduationCap,
  Info,
  Lightbulb,
  Package,
  RotateCcw,
  SquarePen,
  X,
} from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import Image from "@/layout/Image";
import type { AcademyDebrief, KessenAcademyLessonInfo } from "@/libs/kessen/academy";
import { KESSEN_DECK_FACTIONS } from "@/libs/kessen/deck";
import { KESSEN_FACTION_NAMES, kessenPackName } from "@/libs/kessen/packs";
import { TOKEN_PREFIX } from "@/libs/kessen/rules";
import { abilitySegments, cardKeywords } from "@/libs/kessen/text";
import type { Seat } from "@/libs/kessen/types";
import { CardBack } from "../CardBack";
import { CardFace, kessenCardLabel } from "../CardFace";
import { KESSEN_FACTION_INFO, npcPortrait } from "../hub/hubData";
import { KeywordGlossary, KeywordText } from "../KeywordText";
import { kessenPackArt, kessenRarityTier } from "../kessenArt";
import { Lanterns } from "./MatchBars";
import { shortCardName } from "./MatchHand";
import { catalogInspectKey, ReachGlossary, seatReach } from "./MatchPanels";
import { houseRuleRoundNote, plural, unrewardedNote } from "./matchText";
import { useLongPress } from "./useLongPress";
import type { KessenTableOutcome, MatchTable } from "./useMatchTable";

/**
 * The mulligan step: the whole hand at a glance, tap cards to replace them (they go to
 * the bottom of the deck and the same number is drawn), then one confirmation. Reading a
 * card is separate from marking it: hover (it also fills the inspect panel) or
 * long-press shows its name, rules and keyword lines below the hand, with Keep and
 * Replace directly under them. A tap past the limit says so in the same reading area.
 */
export const MulliganScreen = ({
  table,
  clock,
}: {
  table: MatchTable;
  /** At a duel, the shared mulligan window's clock above the answers. */
  clock?: ReactNode;
}) => {
  const view = table.confirmed.view;
  const zone = view.seats[table.me];
  const allowance = zone.mull ?? 0;
  const hand = zone.hand ?? [];
  // The marked cards, and whether the last tap went past the limit.
  const [marks, setMarks] = useState({ chosen: [] as string[], atLimit: false });
  const { chosen, atLimit } = marks;
  const [focus, setFocus] = useState<string | null>(hand[0] ?? null);
  const focusCard = focus ? table.instanceCard(focus) : null;
  const reach = seatReach(table, table.me);
  const keepRef = useRef<HTMLButtonElement>(null);
  useFocusOnMount(keepRef);
  const read = (instance: string) => {
    setFocus(instance);
    table.setInspected(instance);
  };
  const toggle = (instance: string) => {
    read(instance);
    if (instance.startsWith(TOKEN_PREFIX)) return;
    setMarks((current) =>
      current.chosen.includes(instance)
        ? {
            chosen: current.chosen.filter((entry) => entry !== instance),
            atLimit: false,
          }
        : current.chosen.length < allowance
          ? { chosen: [...current.chosen, instance], atLimit: false }
          : { ...current, atLimit: true },
    );
  };
  return (
    <section
      className="km-overlay km-mulligan"
      data-house={table.houseRule ? "" : undefined}
      aria-label={`Round ${view.round} mulligan`}
    >
      <header className="km-overlay-head">
        <p className="km-eyebrow">Round {view.round}</p>
        <h2 className="km-overlay-title">Mulligan</h2>
        <p className="km-overlay-sub">
          Replace up to {plural(allowance, "card")}. They go to the bottom of your deck
          and you draw as many. {table.opponentName} chooses in secret.
        </p>
        <p className="km-overlay-hint">
          Tap a card to mark it for replacing. Hover or long-press to read it.
        </p>
        {table.houseRule ? (
          <p className="km-house-line">
            <span className="km-house-name">House rule · {table.houseRule.name}</span>{" "}
            {table.houseRule.text}
          </p>
        ) : null}
      </header>
      <ul className="km-mull-grid" aria-label="Your hand">
        {hand.map((instance) => (
          <MulliganCard
            key={instance}
            table={table}
            instance={instance}
            replace={chosen.includes(instance)}
            focused={focus === instance}
            onRead={() => read(instance)}
            onToggle={() => toggle(instance)}
          />
        ))}
      </ul>
      {/* A fixed-height reading area, so the grid never moves under the finger. */}
      <div className="km-mull-detail" aria-live="polite">
        {atLimit ? (
          <p className="km-mull-limit" role="status">
            Up to {plural(allowance, "card")}: unmark one first.
          </p>
        ) : null}
        {focusCard ? (
          <>
            <p className="km-mull-detail-line">
              <span className="km-prompt-name">{focusCard.name}</span>{" "}
              <KeywordText
                segments={abilitySegments(focusCard.abilities, reach)}
                empty="No ability."
              />
            </p>
            {cardKeywords(focusCard.abilities).map((keyword) => (
              <p key={keyword} className="km-mull-gloss">
                <ReachGlossary keyword={keyword} reach={reach} />
              </p>
            ))}
          </>
        ) : null}
      </div>
      {table.message ? (
        <p className="km-overlay-error" role="alert">
          {table.message}
        </p>
      ) : null}
      {clock ? <div className="km-mull-clock">{clock}</div> : null}
      {/* The primary follows the choice: Keep hand until a card is marked. */}
      <div className="km-overlay-actions km-mull-actions">
        <Button
          ref={keepRef}
          type="button"
          variant={chosen.length === 0 ? "default" : "secondary"}
          loading={table.pending && chosen.length === 0}
          disabled={table.pending}
          onClick={() => table.mulligan([])}
        >
          Keep hand
        </Button>
        <Button
          type="button"
          variant={chosen.length === 0 ? "secondary" : "default"}
          loading={table.pending && chosen.length > 0}
          disabled={table.pending || chosen.length === 0}
          onClick={() => table.mulligan(chosen)}
        >
          {chosen.length === 0 ? "Replace" : `Replace ${chosen.length}`}
        </Button>
      </div>
    </section>
  );
};

/** One mulligan card: tap marks it for replacing; hover or long-press only reads it. */
const MulliganCard = ({
  table,
  instance,
  replace,
  focused,
  onRead,
  onToggle,
}: {
  table: MatchTable;
  instance: string;
  replace: boolean;
  focused: boolean;
  onRead: () => void;
  onToggle: () => void;
}) => {
  const { consumeLongPress, ...press } = useLongPress({
    onLongPress: onRead,
    onHover: onRead,
  });
  const card = table.instanceCard(instance);
  if (!card) return null;
  return (
    <li className="km-mull-slot">
      <button
        type="button"
        className="km-mull-card"
        data-replace={replace ? "" : undefined}
        data-focus={focused ? "" : undefined}
        aria-pressed={replace}
        aria-label={`${kessenCardLabel(card)}${replace ? ", will be replaced" : ""}`}
        onClick={() => {
          if (consumeLongPress()) return;
          onToggle();
        }}
        onFocus={onRead}
        data-button-sfx="off"
        {...press}
      >
        <CardFace card={card} renderSize={150} showProvision={false} />
        {replace ? <span className="km-mull-mark">Replace</span> : null}
      </button>
      <span className="km-card-name" aria-hidden>
        {shortCardName(card.name)}
      </span>
    </li>
  );
};

/**
 * Round end: a brush-wipe banner, the lanterns (one snuffs for the loser) and the
 * summary card; it waits for the player, the deciding round too. The deciding round's
 * banner names the match result and leaves the opponent's line to the match end. At a
 * duel the next decision's clock runs meanwhile, so it shows above Continue.
 */
export const RoundEndOverlay = ({
  table,
  clock,
}: {
  table: MatchTable;
  clock?: ReactNode;
}) => {
  const summary = table.roundEnd;
  const step = table.step;
  const continueRef = useRef<HTMLButtonElement>(null);
  const holding = Boolean(summary) && step?.event.t === "roundEnd" && table.holding;
  useEffect(() => {
    if (holding) continueRef.current?.focus({ preventScroll: true });
  }, [holding]);
  if (!summary || step?.event.t !== "roundEnd") return null;
  const event = step.event;
  const deciding = table.decidingRound;
  const bark = deciding
    ? null
    : event.winner === table.them
      ? table.npc?.barks.roundWon
      : event.winner === table.me
        ? table.npc?.barks.roundLost
        : null;
  const roundTitle =
    summary.outcome === "won"
      ? `Round ${summary.round} won`
      : summary.outcome === "lost"
        ? `Round ${summary.round} lost`
        : `Round ${summary.round} tied`;
  const matchWinner = table.confirmed.view.result?.winner ?? null;
  const matchTitle =
    matchWinner === table.me
      ? "Match won"
      : matchWinner === table.them
        ? "Match lost"
        : "Match drawn";
  // The deciding round's banner scores the match in rounds; its points stay in the line below.
  const roundsWon = (side: Seat) =>
    table.confirmed.view.history.filter((entry) => entry.winner === side).length;
  const [mine, theirs] = deciding
    ? [roundsWon(table.me), roundsWon(table.them)]
    : [summary.mine, summary.theirs];
  const title = deciding ? `${roundTitle} · ${matchTitle}` : roundTitle;
  return (
    <section
      className="km-overlay km-round-end"
      data-outcome={summary.outcome}
      aria-live="assertive"
      aria-label={title}
    >
      <div className="km-brush-banner">
        <h2>
          {roundTitle}
          {deciding ? <span className="km-brush-match">{matchTitle}</span> : null}
        </h2>
        <p className="km-brush-score">
          {mine} <span aria-hidden>–</span>
          <span className="sr-only">to</span> {theirs}
          {deciding ? <span className="km-brush-unit"> in rounds</span> : null}
        </p>
      </div>
      <div className="km-lantern-row">
        <span>You</span>
        <Lanterns count={event.lanterns[table.me]} label="Your lanterns" />
        <Lanterns
          count={event.lanterns[table.them]}
          label={`${table.opponentName}'s lanterns`}
        />
        <span>{table.opponentName}</span>
      </div>
      <div className="km-summary-card">
        <p>{summary.line}</p>
        {summary.riggedOdds ? <p>Rigged Odds decided the tie.</p> : null}
        {summary.savedCards ? (
          <p className="km-summary-verdict">Won by saving cards.</p>
        ) : null}
        {bark ? (
          <p className="km-bark">
            <span className="km-bark-name">{table.opponentName}:</span> “{bark}”
          </p>
        ) : null}
      </div>
      {table.holding && clock ? <div className="km-mull-clock">{clock}</div> : null}
      {table.holding ? (
        <Button
          ref={continueRef}
          type="button"
          size="lg"
          decoration="gold"
          onClick={table.continuePlayback}
        >
          {table.decidingRound ? "See the result" : "Continue"}
        </Button>
      ) : null}
    </section>
  );
};

/**
 * Match end, over the painted board, as one centred stack: the opponent's round portrait
 * medallion under the result banner (gold for a victory, crimson ink for a defeat), their
 * parting line, the rounds, what it paid (ryo, drops and first-win cards flipping in, a
 * first-win pick) and then Rematch / Edit deck. With cards or a pick to show, tables
 * from 540 px wide set the story and actions beside the rewards so the pick, Take and
 * the actions stay in view. Reward cards are read by hover (the
 * side panel), long-press, focus or tap. A finished lesson shows Lemu's debrief instead:
 * why it was won or lost, the lesson's idea in one sentence, its reward, and the next
 * lesson (or "Try again"); the first lesson leads on to the faction choice, the last one
 * closes with the six faction perks.
 */
export const MatchEndScreen = ({
  table,
  lesson,
  academy,
  onClose,
  onRematch,
  isStarting = false,
  startError = null,
  onEditDeck,
  onClaimChoice,
  guestNote,
}: {
  table: MatchTable;
  lesson: boolean;
  /** The finished lesson's debrief and where it leads. */
  academy?: LessonEnd | null;
  onClose: () => void;
  onRematch?: () => void;
  /** A rematch or lesson start is in flight. */
  isStarting?: boolean;
  /** Why the last rematch or lesson start failed. */
  startError?: string | null;
  onEditDeck?: () => void;
  onClaimChoice?: (itemId: string) => Promise<KessenTableOutcome>;
  /** A guest's match settles nothing; this says so in the rewards' place. */
  guestNote?: ReactNode;
}) => {
  const { me, them, setInspected } = table;
  const confirmed = table.npcMatch;
  const [reading, setReading] = useState<string | null>(null);
  // What the player just took from a first-win pick, announced and followed by focus.
  const [claimed, setClaimed] = useState<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);
  // The side panel reads the rewards from here on, not the last card of the board.
  useEffect(() => setInspected(null), [setInspected]);
  const result = confirmed?.result ?? null;
  const winner = result?.winner ?? table.confirmed.view.result?.winner ?? null;
  const conceded = table.confirmed.status === "CONCEDED";
  const expired = table.confirmed.status === "EXPIRED";
  const outcome = conceded
    ? "conceded"
    : expired
      ? "expired"
      : winner === null
        ? "draw"
        : winner === me
          ? "won"
          : "lost";
  const debrief = academy?.debrief ?? null;
  const title =
    debrief && !conceded && !expired
      ? debrief.title
      : {
          won: "You won",
          lost: "You lost",
          draw: "You drew",
          conceded: "You conceded",
          expired: "Match expired",
        }[outcome];
  const history = table.confirmed.view.history;
  const comeback = outcome === "won" && history[0]?.winner === them;
  const bark =
    outcome === "won"
      ? table.npc?.barks.matchLost
      : outcome === "lost"
        ? table.npc?.barks.matchWon
        : null;
  const npc = table.npc;
  const portrait = npc
    ? npcPortrait({
        key: confirmed?.npcKey ?? npc.key,
        image: npc.image,
        lockReason: null,
      })
    : null;
  // Only the first completion of the first lesson opens the starter choice.
  const chooseFaction = lesson && result?.firstWin?.choice?.kind === "starterFaction";
  const choice = result?.firstWin?.choice;
  const pick =
    choice && choice.kind !== "starterFaction" && choice.options.length > 0
      ? choice
      : null;
  // A lesson's own button (Next lesson or Try again) leads; Leave table follows it.
  const academyLeads = !!academy && !chooseFaction && (!debrief?.won || !!academy.next);
  // While a first-win pick waits, Take is the only primary and focus starts on the pick.
  const pickPending = pick !== null && !pick.claimed && !chooseFaction;
  useFocusOnMount(pickPending ? null : primaryRef);
  const pickTaken = pick?.claimed ?? null;
  useEffect(() => {
    if (claimed && pickTaken) {
      (primaryRef.current ?? leaveRef.current)?.focus({ preventScroll: true });
    }
  }, [claimed, pickTaken]);
  const firstWinPaid = (result?.firstWin?.itemIds.length ?? 0) > 0 || pick !== null;
  // NEW marks only a card known to be a first copy: an unowned-legendary pick. A drop
  // can be a further copy of a card that is not yet at its limit, and the result does
  // not say which, so drops and granted cards carry no ribbon.
  const rewards = [
    ...(result?.drops ?? []).map((drop) => ({
      itemId: drop.itemId,
      isNew: false,
      note:
        drop.soldFor !== null
          ? `Surplus sold for ${drop.soldFor} ryo`
          : drop.forbidden
            ? "Forbidden drop"
            : drop.surplus
              ? "Surplus copy"
              : "Drop",
    })),
    ...(result?.firstWin?.itemIds ?? []).map((itemId) => ({
      itemId,
      isNew: false,
      note: "First win",
    })),
    ...(pick?.claimed
      ? [
          {
            itemId: pick.claimed,
            isNew: pick.kind === "unownedLegendary",
            note: "First-win pick",
          },
        ]
      : []),
  ];
  const read = (cardId: string) => {
    setReading(cardId);
    setInspected(catalogInspectKey(cardId));
  };
  const readCard = reading ? table.cardDisplay(reading) : null;
  // Rewards worth a column of their own: cards to see or a pick to make.
  const split = rewards.length > 0 || pickPending;
  const note =
    result && !result.rewarded && result.reason && !lesson
      ? unrewardedNote(result.reason, firstWinPaid)
      : null;
  const hasLines =
    result !== null &&
    (result.ryo > 0 || result.weeklyFirstWinPack || !!result.academy?.graduationPackId);
  // A won lesson replay pays nothing; it says so instead of an empty rewards box.
  const replayNote =
    debrief?.won && result?.academy && result.academy.ryo === 0
      ? "Lesson replays pay no reward."
      : null;
  return (
    <section
      className="km-overlay km-match-end"
      data-outcome={outcome}
      data-split={split ? "" : undefined}
      data-pick={pickPending ? "" : undefined}
      aria-label={title}
    >
      <div className="km-end-stack">
        <div className="km-end-story">
          <div className="km-end-hero">
            {portrait ? (
              <span className="km-end-medallion" aria-hidden>
                <Image
                  src={portrait}
                  alt=""
                  width={256}
                  height={256}
                  draggable={false}
                />
              </span>
            ) : null}
            <div className="km-brush-banner" data-size="large">
              <h2>{title}</h2>
              {comeback && !lesson ? (
                <p className="km-badge-comeback">Comeback</p>
              ) : null}
            </div>
          </div>
          {bark && !lesson ? (
            <p className="km-bark km-end-bark">
              <span className="km-bark-name">{table.opponentName}:</span> “{bark}”
            </p>
          ) : null}
          {debrief ? (
            <div className="km-end-lesson">
              <p className="km-bark km-end-bark">
                <span className="km-bark-name">{table.opponentName}:</span>{" "}
                {debrief.text}
              </p>
              <p className="km-end-idea">
                <Lightbulb aria-hidden />
                <span>
                  <span className="km-eyebrow block">The idea</span>
                  {debrief.idea}
                </span>
              </p>
            </div>
          ) : null}
          {history.length > 0 ? (
            <ol className="km-end-rounds" aria-label="Rounds">
              {history.map((entry) => (
                <li
                  key={entry.round}
                  data-outcome={
                    entry.winner === null ? "tie" : entry.winner === me ? "won" : "lost"
                  }
                >
                  <span className="km-eyebrow">Round {entry.round}</span>
                  <span className="km-end-score">
                    {entry.totals[me]} – {entry.totals[them]}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
        <div className="km-end-claim">
          {/* The result's rewards, as the combat result lists them. */}
          {result ? (
            <section className="km-rewards" aria-label="Rewards">
              {hasLines || note || replayNote ? (
                <div className="km-reward-box">
                  <h3 className="km-reward-title">
                    {lesson ? "Lesson reward" : "Match rewards"}
                  </h3>
                  {hasLines ? (
                    <div className="km-reward-lines">
                      {result.ryo > 0 ? (
                        <p className="km-reward-line">
                          <Coins aria-hidden /> Ryo gained:{" "}
                          <strong>+{result.ryo.toLocaleString()}</strong>
                        </p>
                      ) : null}
                      {result.academy?.graduationPackId ? (
                        <p className="km-reward-line">
                          <GraduationCap aria-hidden /> Academy complete:{" "}
                          <strong>
                            {kessenPackName(result.academy.graduationPackId) ??
                              "Card pack"}
                          </strong>
                        </p>
                      ) : null}
                      {result.weeklyFirstWinPack ? (
                        <p className="km-reward-line">
                          <Package aria-hidden /> Weekly first win:{" "}
                          <strong>Paper Bundle</strong>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {note || replayNote ? (
                    <p className="km-reward-note">
                      <Info aria-hidden />
                      <span>{note ?? replayNote}</span>
                    </p>
                  ) : null}
                </div>
              ) : null}
              {rewards.length > 0 ? (
                <ul className="km-reward-cards">
                  {rewards.map((reward, index) => (
                    <li key={`${reward.itemId}-${index}`}>
                      <RewardCard
                        table={table}
                        itemId={reward.itemId}
                        delay={index}
                        note={reward.note}
                        isNew={reward.isNew}
                        reading={reading === reward.itemId}
                        onRead={() => read(reward.itemId)}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
              {chooseFaction ? (
                <p className="km-end-bark">
                  Your starter faction waits in the Card Hall. The next lessons wait at
                  the Academy.
                </p>
              ) : academy?.factionPerks && debrief?.won ? (
                <FactionPerks />
              ) : pick && !pick.claimed ? (
                <FirstWinChoice
                  table={table}
                  options={pick.options}
                  reading={reading}
                  onRead={read}
                  onClaimChoice={onClaimChoice}
                  onClaimed={setClaimed}
                />
              ) : null}
              {readCard ? (
                <div className="km-end-detail" aria-live="polite">
                  <p className="km-mull-detail-line">
                    <span className="km-prompt-name">{readCard.name}</span>{" "}
                    <KeywordText abilities={readCard.abilities} empty="No ability." />
                  </p>
                  {cardKeywords(readCard.abilities).map((keyword) => (
                    <p key={keyword} className="km-mull-gloss">
                      <KeywordGlossary keyword={keyword} />
                    </p>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
          {guestNote ? (
            <section className="km-rewards" aria-label="Guest match">
              {guestNote}
            </section>
          ) : null}
          <p className="sr-only" role="status">
            {claimed && pickTaken ? `${claimed} is yours.` : ""}
          </p>
          {(onRematch || academy) && startError ? (
            <p className="km-overlay-error" role="alert">
              {startError}
            </p>
          ) : null}
          {pickPending ? (
            <p className="km-end-hint">Claim your first-win card before you leave.</p>
          ) : null}
          <div className="km-end-actions grid gap-2 sm:grid-cols-2 sm:[&>:last-child:nth-child(odd)]:col-span-2">
            {chooseFaction ? (
              <Button
                ref={primaryRef}
                type="button"
                data-primary=""
                className="w-full gap-[6px]"
                onClick={onClose}
              >
                <span>Choose your faction</span>
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            ) : null}
            {academy && !chooseFaction ? (
              debrief?.won ? (
                academy.next ? (
                  <Button
                    ref={primaryRef}
                    type="button"
                    data-primary=""
                    className="h-auto min-h-9 w-full gap-[6px] py-1 whitespace-normal"
                    loading={isStarting}
                    onClick={academy.onNext}
                  >
                    <span>Next lesson: {academy.next.title}</span>
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
                  </Button>
                ) : null
              ) : (
                <Button
                  ref={primaryRef}
                  type="button"
                  data-primary=""
                  className="w-full gap-[6px]"
                  loading={isStarting}
                  onClick={academy.onRetry}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  <span>Try again</span>
                </Button>
              )
            ) : null}
            {onRematch && !chooseFaction ? (
              <Button
                ref={primaryRef}
                type="button"
                variant={pickPending ? "secondary" : "default"}
                data-primary={pickPending ? undefined : ""}
                className="w-full gap-[6px]"
                loading={isStarting}
                onClick={onRematch}
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                <span>Rematch</span>
              </Button>
            ) : null}
            {onEditDeck && !chooseFaction ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full gap-[6px]"
                onClick={onEditDeck}
              >
                <SquarePen className="h-4 w-4" aria-hidden />
                <span>Edit deck</span>
              </Button>
            ) : null}
            {chooseFaction ? null : (
              <Button
                ref={onRematch || academyLeads ? leaveRef : primaryRef}
                type="button"
                variant={onRematch || academyLeads ? "secondary" : "default"}
                className="w-full gap-[6px]"
                onClick={onClose}
              >
                <X className="h-4 w-4" aria-hidden />
                <span>Leave table</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

/**
 * The six factions' passive perks on one screen, closing the Academy: the player picks
 * (or revisits) a faction knowing what each one rewards.
 */
const FactionPerks = () => (
  <section className="km-reward-box km-faction-perks" aria-label="Faction perks">
    <h3 className="km-reward-title">Six factions, six perks</h3>
    <ul className="km-perk-list">
      {KESSEN_DECK_FACTIONS.map((faction) => {
        const info = KESSEN_FACTION_INFO[faction];
        return (
          <li key={faction}>
            <span className="km-perk-name">
              {KESSEN_FACTION_NAMES[faction]}
              {info.perk ? ` · ${info.perk}` : ""}
            </span>
            <span className="km-perk-text">{info.perkText ?? info.identity}</span>
          </li>
        );
      })}
    </ul>
    <p className="km-end-hint">
      Build a deck around your faction in Decks, then take it to the Circuit.
    </p>
  </section>
);

/**
 * A reward card that lands face down and flips (instantly without motion). Hover, focus,
 * long-press or a tap reads it.
 */
const RewardCard = ({
  table,
  itemId,
  delay,
  note,
  isNew,
  reading,
  onRead,
}: {
  table: MatchTable;
  itemId: string;
  delay: number;
  note: string;
  /** The player did not own the card before this match. */
  isNew: boolean;
  reading: boolean;
  onRead: () => void;
}) => {
  const { consumeLongPress, ...press } = useLongPress({
    onLongPress: onRead,
    onHover: onRead,
  });
  const card = table.cardDisplay(itemId);
  if (!card) {
    return (
      <figure className="km-reward-pack">
        <Image src={kessenPackArt(itemId)} alt="" width={160} height={240} />
        <figcaption>
          {kessenPackName(itemId) ?? "Card pack"}
          <span className="block">{note}</span>
        </figcaption>
      </figure>
    );
  }
  return (
    <figure className="km-reward-card">
      <button
        type="button"
        className="km-reward-hit"
        data-reading={reading ? "" : undefined}
        aria-label={`Read ${card.name} (${note})`}
        aria-pressed={reading}
        onClick={() => {
          if (consumeLongPress()) return;
          onRead();
        }}
        onFocus={onRead}
        data-button-sfx="off"
        {...press}
      >
        <span className="km-flip" style={{ animationDelay: `${300 + delay * 350}ms` }}>
          <CardBack
            className="km-flip-back"
            renderSize={160}
            telegraph={kessenRarityTier(card)}
          />
          <CardFace
            className="km-flip-front"
            card={card}
            renderSize={160}
            isNew={isNew}
          />
        </span>
      </button>
      <figcaption>{note}</figcaption>
    </figure>
  );
};

/**
 * A first-win pick in the reward-choice language: the options as cards to select, then
 * "Claim <card>". Hover, focus or long-press reads one; a tap selects it, so no single tap
 * commits the pick.
 */
const FirstWinChoice = ({
  table,
  options,
  reading,
  onRead,
  onClaimChoice,
  onClaimed,
}: {
  table: MatchTable;
  options: string[];
  reading: string | null;
  onRead: (cardId: string) => void;
  onClaimChoice?: (itemId: string) => Promise<KessenTableOutcome>;
  /** The pick was taken: its card name, for the announcement and focus. */
  onClaimed: (name: string) => void;
}) => {
  const titleId = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  useFocusOnMount(firstRef);
  const selectedCard = selected ? table.cardDisplay(selected) : null;
  const take = async () => {
    if (!onClaimChoice || !selected) return;
    setBusy(true);
    setError(null);
    const outcome = await onClaimChoice(selected);
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.message ?? "That choice failed.");
      return;
    }
    // The taken card flips in among the rewards; the reading box follows it.
    onRead(selected);
    onClaimed(selectedCard?.name ?? "The card");
  };
  return (
    <section className="km-choice" aria-labelledby={titleId}>
      <div className="text-center">
        <p id={titleId} className="km-choice-title">
          First win: choose your reward
        </p>
        <p className="km-choice-hint">Select one card, then claim it.</p>
      </div>
      <fieldset className="km-choice-grid">
        <legend className="sr-only">Cards to choose from</legend>
        {options.map((itemId, index) => (
          <ChoiceCard
            key={itemId}
            ref={index === 0 ? firstRef : undefined}
            table={table}
            itemId={itemId}
            selected={selected === itemId}
            reading={reading === itemId}
            disabled={busy}
            onRead={() => onRead(itemId)}
            onSelect={() => {
              setSelected(itemId);
              onRead(itemId);
            }}
          />
        ))}
      </fieldset>
      <p className="sr-only" aria-live="polite">
        {selected ? 1 : 0} / 1 selected
      </p>
      <Button
        type="button"
        className="km-choice-take w-full"
        disabled={!selectedCard || !onClaimChoice}
        loading={busy}
        onClick={() => void take()}
      >
        {selectedCard ? `Claim ${selectedCard.name}` : "Select a card to claim"}
      </Button>
      {error ? (
        <p className="km-overlay-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};

/** One pick option, framed as a reward-choice card with its select mark. */
const ChoiceCard = ({
  ref,
  table,
  itemId,
  selected,
  reading,
  disabled,
  onRead,
  onSelect,
}: {
  ref?: RefObject<HTMLButtonElement | null>;
  table: MatchTable;
  itemId: string;
  selected: boolean;
  reading: boolean;
  disabled: boolean;
  onRead: () => void;
  onSelect: () => void;
}) => {
  const { consumeLongPress, ...press } = useLongPress({
    onLongPress: onRead,
    onHover: onRead,
  });
  const card = table.cardDisplay(itemId);
  if (!card) return null;
  return (
    <button
      ref={ref}
      type="button"
      className="km-choice-card"
      data-selected={selected ? "" : undefined}
      data-reading={reading ? "" : undefined}
      aria-pressed={selected}
      aria-label={`${kessenCardLabel(card)}${selected ? ", selected" : ""}`}
      disabled={disabled}
      onClick={() => {
        if (consumeLongPress()) return;
        onSelect();
      }}
      onFocus={onRead}
      data-button-sfx="off"
      {...press}
    >
      <CardFace card={card} renderSize={180} selected={selected} className="w-full" />
      <span className="km-choice-mark" aria-hidden>
        <span>{selected ? <Check className="h-3 w-3" /> : null}</span>
        {selected ? "Selected" : "Select"}
      </span>
    </button>
  );
};

/**
 * "Big Play" stamp when one action swings the totals by ten or more; at a round's start,
 * the round, its opener and what the house rule does that round.
 */
export const BigPlayStamp = ({ table }: { table: MatchTable }) => {
  const step = table.step;
  if (step?.event.t === "roundStart" && step.event.round > 1) {
    const opener =
      step.event.opener === table.me ? "You open" : `${table.opponentName} opens`;
    const rule = houseRuleRoundNote(
      table.houseRule,
      step.before.rules,
      step.event.round,
    );
    return (
      <span className="km-bigplay" data-kind="round" aria-live="polite">
        Round {step.event.round}
        <span className="km-bigplay-sub">{opener}</span>
        {rule ? <span className="km-bigplay-rule">{rule}</span> : null}
      </span>
    );
  }
  const big = step?.bigPlay;
  if (!big) return null;
  return (
    <span
      className="km-bigplay"
      data-side={big.seat === table.me ? "me" : "them"}
      aria-live="polite"
    >
      Big Play <span className="km-bigplay-swing">+{big.swing}</span>
    </span>
  );
};

/**
 * Moves keyboard focus to an overlay's primary control when the overlay appears; null
 * leaves focus to a control inside it.
 */
const useFocusOnMount = (ref: RefObject<HTMLElement | null> | null) => {
  useEffect(() => {
    ref?.current?.focus({ preventScroll: true });
  }, [ref]);
};

/** How a finished lesson ends: Lemu's debrief and the lesson it leads to. */
export interface LessonEnd {
  debrief: AcademyDebrief;
  /** The next lesson to open; null after the last one. */
  next: KessenAcademyLessonInfo | null;
  onNext: () => void;
  onRetry: () => void;
  /** Close with the six faction perks (the last lesson). */
  factionPerks: boolean;
}
