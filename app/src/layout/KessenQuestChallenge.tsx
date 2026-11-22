"use client";

import { CheckCircle2, Gauge, Hourglass, Play, ScrollText, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KESSEN_NPC_NAMES } from "@/drizzle/constants";
import Confirm from "@/layout/Confirm";
import { FeedbackAlert } from "@/layout/FeedbackAlert";
import { NpcPortrait } from "@/layout/kessen/hub/CircuitMap";
import { DeckPicker, useDeckChoice } from "@/layout/kessen/hub/DeckPicker";
import {
  KESSEN_TIER_LABELS,
  type KessenDeckSummary,
} from "@/layout/kessen/hub/hubData";
import Link from "@/layout/Link";
import { Reward } from "@/layout/Objective";
import {
  ChallengeElsewhere,
  ChallengeGone,
  ChallengeNotice,
  QUEST_LOGBOOK_HREF,
} from "@/layout/QuestChallenge";
import { TowerDefenseStat } from "@/layout/TowerDefenseLobby";
import type { DeckFaction } from "@/libs/kessen/deck";
import type { findQuestChallenge } from "@/libs/quest/challenge";
import { cn } from "@/libs/shadui";
import { parseHtml } from "@/utils/parse";
import type { KessenCircuitEntry, KessenDeckSource } from "@/validators/kessen";
import { hasReward } from "@/validators/rewards";

/**
 * The briefing of a quest's Duel at the Table challenge, shown in full only at the
 * objective's position: the opponent, the AI's tier, the deck to bring and the start.
 * Elsewhere it only points the way there. The match pays nothing but the objective.
 * While a match or duel is unfinished (`resume`), the start gives way to its table: this
 * duel's own when the player left it for the hall, otherwise the one blocking the seat.
 * Another NPC match or lesson may be conceded to take the seat, as on the Circuit; a
 * duel against a player only resumes.
 */
export const KessenQuestChallenge = (props: {
  challenge: FoundChallenge | null;
  /** The opponent's Circuit entry, for its portrait, title and house rule. */
  opponent: KessenCircuitEntry | undefined;
  decks: readonly KessenDeckSummary[];
  defaultDeckId: string | null | undefined;
  loanerFaction: DeckFaction;
  isStarting: boolean;
  error: string | null;
  /**
   * The unfinished match or duel: its resume button text ("Resume vs Kazehiko"), the
   * match as a sentence's subject ("Your match against Kazehiko"), whether it is this
   * briefing's own duel and whether it is a duel against another player.
   */
  resume?: {
    label: string;
    unfinished: string;
    isThisDuel: boolean;
    isPlayerDuel: boolean;
    onOpen: () => void;
  };
  /** Starts the duel; `replaceActive` concedes the unfinished NPC match first. */
  onStart: (deck: KessenDeckSource, replaceActive?: boolean) => void;
}) => {
  const { challenge, opponent } = props;
  const deck = useDeckChoice(props.decks, props.defaultDeckId, props.loanerFaction);
  if (!challenge) return <ChallengeGone noun="duel" />;
  const { objective, quest } = challenge;
  const isHere = challenge.atLocation || objective.hideLocation;
  if (!challenge.done && !isHere)
    return (
      <ChallengeElsewhere
        questName={quest.name}
        objective={objective}
        purpose="take your seat at the table there"
      />
    );
  const name = KESSEN_NPC_NAMES[objective.npcKey];
  const { resume } = props;
  const concedable = resume && !resume.isThisDuel && !resume.isPlayerDuel;
  const offersConcede = concedable && challenge.available;
  // "Your match against Lemu" as the object of "Concede …".
  const unfinishedObject = resume
    ? resume.unfinished.charAt(0).toLowerCase() + resume.unfinished.slice(1)
    : "";
  return (
    <div className="@container space-y-4 p-3">
      <div className="flex items-start gap-3">
        {opponent ? (
          <span className="block h-[80px] w-[80px] shrink-0 p-[4px]">
            <NpcPortrait entry={{ ...opponent, lockReason: null }} size={96} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[12px] text-muted-foreground uppercase tracking-wider">
            {quest.name}
          </p>
          <h2 className="kh-heading text-[22px] leading-tight">{name}</h2>
          {opponent ? <p className="text-muted-foreground">{opponent.title}</p> : null}
          {objective.description && (
            <div className="mt-1">{parseHtml(objective.description)}</div>
          )}
          <Reward info={objective} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <TowerDefenseStat
          icon={<Swords className="h-5 w-5 text-red-500" />}
          label="Opponent"
          value={`${name}'s signature deck`}
        />
        <TowerDefenseStat
          icon={<Gauge className="h-5 w-5 text-amber-500" />}
          label="Difficulty"
          value={KESSEN_TIER_LABELS[objective.tier]}
        />
      </div>
      {opponent?.houseRule ? (
        <p className="text-sm">
          <span className="font-semibold">{opponent.houseRule.name}:</span>{" "}
          {opponent.houseRule.text}
        </p>
      ) : null}
      <p className="text-muted-foreground text-sm">
        Win a best-of-three match against {name}&apos;s signature deck. This duel earns
        no ryo, cards or Circuit progress; it counts only for the quest.
      </p>
      {challenge.done ? (
        <ChallengeNotice
          tone="success"
          icon={<CheckCircle2 className="h-5 w-5 text-green-500" />}
        >
          {hasReward(objective)
            ? "You won the duel. Collect the objective's reward in your logbook."
            : "You won the duel. Continue the quest in your logbook."}
        </ChallengeNotice>
      ) : !challenge.available ? (
        <ChallengeNotice icon={<ScrollText className="h-5 w-5 text-amber-500" />}>
          Finish the earlier objectives of {quest.name} first.
        </ChallengeNotice>
      ) : resume?.isThisDuel ? (
        <ChallengeNotice icon={<Hourglass className="h-5 w-5 text-amber-500" />}>
          This duel is under way.
        </ChallengeNotice>
      ) : concedable ? (
        <>
          <ChallengeNotice icon={<Hourglass className="h-5 w-5 text-amber-500" />}>
            {resume.unfinished} is unfinished. Resume it, or concede it to take a seat.
          </ChallengeNotice>
          <DeckPicker decks={props.decks} idPrefix="quest-challenge" choice={deck} />
        </>
      ) : resume ? (
        <ChallengeNotice icon={<Hourglass className="h-5 w-5 text-amber-500" />}>
          {resume.unfinished} is unfinished. Finish or concede it before you take a
          seat.
        </ChallengeNotice>
      ) : (
        <DeckPicker decks={props.decks} idPrefix="quest-challenge" choice={deck} />
      )}
      {props.error ? (
        <FeedbackAlert feedback={{ success: false, message: props.error }} foreground />
      ) : null}
      {/* The Resume and Concede pair needs about 400-500px, more than the row gets on
          phones (@2xl is 504px), so there the pair wraps and each button fills its line. */}
      <div className="flex flex-col gap-2 @md:flex-row @md:flex-wrap @md:justify-end">
        {challenge.done ? (
          <Button asChild size="lg">
            <Link href={QUEST_LOGBOOK_HREF}>
              <ScrollText className="mr-2 h-5 w-5" />
              Open logbook
            </Link>
          </Button>
        ) : resume ? (
          <>
            <Button
              size="lg"
              className={cn(
                "w-full @md:w-auto",
                offersConcede && "@md:grow @2xl:grow-0",
              )}
              onClick={resume.onOpen}
            >
              <Play className="mr-2 h-5 w-5" />
              {resume.isThisDuel ? "Return to the table" : resume.label}
            </Button>
            {offersConcede ? (
              <Confirm
                title={`Concede ${unfinishedObject}?`}
                tone="destructive"
                proceed_label={`Concede and challenge ${name}`}
                proceed_loading_label="Shuffling..."
                isLoading={props.isStarting}
                button={
                  <Button
                    size="lg"
                    variant="outline"
                    disabled={props.isStarting}
                    className="w-full @md:w-auto @md:grow @2xl:grow-0"
                  >
                    Concede it and take a seat…
                  </Button>
                }
                onAccept={() => props.onStart(deck.source, true)}
              >
                <p>
                  {resume.unfinished} ends as a loss with no rewards, and the duel
                  against {name} starts.
                </p>
                <p className="text-muted-foreground">Then: {deck.label}</p>
              </Confirm>
            ) : null}
          </>
        ) : (
          <Button
            size="lg"
            className="w-full @md:w-auto"
            disabled={props.isStarting || !challenge.available}
            onClick={() => props.onStart(deck.source)}
          >
            <Play className="mr-2 h-5 w-5" />
            {props.isStarting ? "Shuffling..." : "Take a seat"}
          </Button>
        )}
      </div>
    </div>
  );
};

type FoundChallenge = NonNullable<
  ReturnType<typeof findQuestChallenge<"win_kessen_challenge">>
>;
