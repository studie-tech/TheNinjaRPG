"use client";

import { CheckCircle2, Gauge, Play, ScrollText, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KESSEN_NPC_NAMES } from "@/drizzle/constants";
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
import { parseHtml } from "@/utils/parse";
import type { KessenCircuitEntry, KessenDeckSource } from "@/validators/kessen";
import { hasReward } from "@/validators/rewards";

/**
 * The briefing of a quest's Duel at the Table challenge, shown in full only at the
 * objective's position: the opponent, the AI's tier, the deck to bring and the start.
 * Elsewhere it only points the way there. The match pays nothing but the objective.
 * While another match is unfinished (`onResume`), the start gives way to its table.
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
  /** The unfinished match's resume button text, such as "Resume vs Kazehiko". */
  resumeLabel?: string;
  onResume?: () => void;
  onStart: (deck: KessenDeckSource) => void;
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
      ) : props.onResume ? null : (
        <DeckPicker decks={props.decks} idPrefix="quest-challenge" choice={deck} />
      )}
      {props.error ? (
        <FeedbackAlert feedback={{ success: false, message: props.error }} foreground />
      ) : null}
      <div className="flex flex-col gap-2 @md:flex-row @md:justify-end">
        {challenge.done ? (
          <Button asChild size="lg">
            <Link href={QUEST_LOGBOOK_HREF}>
              <ScrollText className="mr-2 h-5 w-5" />
              Open logbook
            </Link>
          </Button>
        ) : props.onResume ? (
          <Button size="lg" className="w-full @md:w-auto" onClick={props.onResume}>
            <Play className="mr-2 h-5 w-5" />
            {props.resumeLabel ?? "Resume your match"}
          </Button>
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
