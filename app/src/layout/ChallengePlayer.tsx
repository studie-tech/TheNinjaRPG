"use client";

import { Eye, Layers, Loader2, Swords } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { KESSEN_CHALLENGE_EXPIRY_SECONDS, MAX_PLAYER_LEVEL } from "@/drizzle/constants";
import { useKessenHub } from "@/hooks/kessen/useKessenHub";
import { useKessenPvpLobby } from "@/hooks/kessen/useKessenPvpLobby";
import { useCreateSparChallenge } from "@/hooks/useSparChallenge";
import type { MutationFeedback } from "@/layout/FeedbackAlert";
import { type DeckChoice, useDeckChoice } from "@/layout/kessen/hub/DeckPicker";
import {
  catalogLookup,
  defaultDeck,
  type KessenDeckSummary,
  summarizeDeck,
} from "@/layout/kessen/hub/hubData";
import Link from "@/layout/Link";
import { SPAR_EXPIRY_SECONDS } from "@/libs/combat/constants";
import { type DeckFaction, KESSEN_DECK_FACTIONS } from "@/libs/kessen/deck";
import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import { cn } from "@/libs/shadui";
import type { ChallengeMatch } from "@/validators/comments";

/**
 * A swords icon that opens `ChallengePanel` for a player, so a spar or a duel is one
 * click away wherever players meet, such as their tavern messages.
 */
export function ChallengeButton({
  opponent,
  conversationId,
  className,
}: ChallengePanelProps & { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          aria-label={`Challenge ${opponent.username}`}
        >
          <Swords className="h-6 w-6 hover:text-orange-500" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="max-h-[var(--radix-popover-content-available-height)] w-[320px] overflow-y-auto p-[8px]"
      >
        <ChallengePanel opponent={opponent} conversationId={conversationId} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Every way to challenge a player straight away: a spar in the arena and a friendly
 * Kessen duel. Each option sends with one click and answers next to its button; the
 * challenged player accepts on the arena or Card Hall page as usual. Render it only while
 * shown, since the Kessen option reads the player's decks.
 */
export function ChallengePanel({ opponent, conversationId }: ChallengePanelProps) {
  return (
    <div className="flex flex-col gap-[8px]">
      <p className="px-[2px] text-[13px] font-bold">
        Challenge <span className="break-all">{opponent.username}</span>
      </p>
      <SparOption opponent={opponent} conversationId={conversationId} />
      <KessenOption opponent={opponent} conversationId={conversationId} />
    </div>
  );
}

/**
 * A conversation's one-line announcement that a challenge sent from it started a match,
 * in place of a message card: who plays, what, when, and a link to watch it live.
 */
export function ChallengeMatchNotice({
  challenger,
  match,
  createdAt,
  compact = false,
}: {
  challenger: string;
  match: ChallengeMatch;
  createdAt: Date;
  /** The chat panel's dense rows. */
  compact?: boolean;
}) {
  const isSpar = match.type === "SPAR";
  const Icon = isSpar ? Swords : Layers;
  return (
    <div
      className={cn(
        "flex items-center gap-[8px] rounded-lg border border-dashed text-[13px]",
        compact ? "px-[8px] py-[4px]" : "bg-popover mb-3 px-[12px] py-[8px]",
      )}
    >
      <Icon className="h-[16px] w-[16px] shrink-0 text-orange-600" aria-hidden />
      <p className="min-w-0 flex-1">
        <b>{challenger}</b> and <b>{match.opponentName}</b> started{" "}
        {isSpar ? "a spar" : "a Kessen duel"}
        <span className="text-muted-foreground">
          {" · "}
          {/* Locale and timezone differ between server and browser. */}
          <time dateTime={createdAt.toISOString()} suppressHydrationWarning>
            {createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </time>
        </span>
      </p>
      <Button
        asChild
        variant="outline"
        className="h-[28px] shrink-0 px-[10px] text-[12px]"
      >
        <Link
          href={
            isSpar ? `/battlelog/${match.matchId}` : `/kessen/watch/${match.matchId}`
          }
        >
          <Eye className="mr-[4px] h-[14px] w-[14px]" aria-hidden /> Watch
        </Link>
      </Button>
    </div>
  );
}

/** A spar with the arena's challenge options. */
function SparOption({ opponent, conversationId }: ChallengePanelProps) {
  const { mutate, isPending } = useCreateSparChallenge();
  const [useRankedRules, setUseRankedRules] = useState(false);
  // A spar challenged from a conversation is announced there only when it can be watched.
  const [spectatable, setSpectatable] = useState(!!conversationId);
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);
  const send = () => {
    setFeedback(null);
    mutate(
      {
        targetId: opponent.userId,
        useRankedRules,
        spectatable,
        conversationId: conversationId ?? undefined,
      },
      { onSuccess: (data) => setFeedback(data) },
    );
  };
  return (
    <ChallengeOption
      icon={<Swords className="h-[18px] w-[18px]" aria-hidden />}
      title="Spar"
      description={`Arena battle, no rewards or losses. Expires in ${SPAR_EXPIRY_SECONDS / 60} min.`}
      sendLabel={`Send ${opponent.username} a sparring challenge`}
      isSending={isPending}
      onSend={send}
      feedback={feedback}
      followUp={{ href: "/battlearena#Sparring", label: "Open the arena" }}
    >
      <div className="flex flex-col gap-[6px]">
        <OptionCheckbox
          checked={useRankedRules}
          onChange={setUseRankedRules}
          label="Ranked rules"
          hint={`ranked loadouts, level ${MAX_PLAYER_LEVEL} stats`}
        />
        <OptionCheckbox
          checked={spectatable}
          onChange={setSpectatable}
          label="Allow spectators"
        />
      </div>
    </ChallengeOption>
  );
}

/**
 * A friendly Kessen duel with a deck from the player's Card Hall. Until the first
 * Academy lesson is done the option explains where Kessen is learned instead.
 */
function KessenOption({ opponent, conversationId }: ChallengePanelProps) {
  const { hub, catalog } = useKessenHub();
  const props = {
    icon: <Layers className="h-[18px] w-[18px]" aria-hidden />,
    title: "Kessen duel",
    description: `Friendly card duel, no rating or rewards. Expires in ${KESSEN_CHALLENGE_EXPIRY_SECONDS / 60} min.`,
    sendLabel: `Send ${opponent.username} a Kessen challenge`,
  };
  // A failed background refetch keeps the loaded decks usable.
  if ((!hub.data && hub.isError) || (!catalog.data && catalog.isError)) {
    return (
      <ChallengeOption {...props} disabled>
        <p className="text-destructive text-[12px]">
          Your decks could not be loaded.{" "}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => void Promise.all([hub.refetch(), catalog.refetch()])}
          >
            Try again
          </button>
        </p>
      </ChallengeOption>
    );
  }
  if (!hub.data || !catalog.data) {
    return (
      <ChallengeOption {...props} disabled isSending>
        <p className="text-muted-foreground text-[12px]">Loading your decks…</p>
      </ChallengeOption>
    );
  }
  if (hub.data.needsLesson) {
    return (
      <ChallengeOption {...props} disabled>
        <p className="text-[12px]">
          Finish Lemu&apos;s first Academy lesson to duel players.{" "}
          <Link
            href="/kessen"
            className="font-semibold text-orange-600 hover:underline"
          >
            Open the Card Hall
          </Link>
        </p>
      </ChallengeOption>
    );
  }
  const lookup = catalogLookup(catalog.data.cards);
  const decks = hub.data.decks.map((deck) =>
    summarizeDeck(deck, lookup, hub.data.owned),
  );
  return (
    <KessenChallenge
      {...props}
      opponent={opponent}
      conversationId={conversationId}
      decks={decks}
      defaultDeckId={defaultDeck(decks)?.id ?? null}
      loanerFaction={hub.data.loanerFaction}
    />
  );
}

/** The Kessen option once the decks are known: a deck choice and the send button. */
function KessenChallenge({
  opponent,
  conversationId,
  decks,
  defaultDeckId,
  loanerFaction,
  ...props
}: Pick<ChallengeOptionProps, "icon" | "title" | "description" | "sendLabel"> & {
  opponent: ChallengeOpponent;
  conversationId?: string | null;
  decks: readonly KessenDeckSummary[];
  defaultDeckId: string | null;
  loanerFaction: DeckFaction;
}) {
  // The lobby itself is not read here; a confirmed challenge refreshes it if loaded.
  const { createChallenge, isChallenging } = useKessenPvpLobby(false);
  const choice = useDeckChoice(decks, defaultDeckId, loanerFaction);
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);
  const send = async () => {
    setFeedback(null);
    const outcome = await createChallenge({
      targetId: opponent.userId,
      deck: choice.source,
      conversationId: conversationId ?? undefined,
    });
    setFeedback({ success: outcome.ok, message: outcome.message });
  };
  return (
    <ChallengeOption
      {...props}
      isSending={isChallenging}
      onSend={() => void send()}
      feedback={feedback}
      followUp={{ href: "/kessen?tab=duels", label: "Open your duels" }}
    >
      <DeckSelect decks={decks} choice={choice} />
    </ChallengeOption>
  );
}

/** The duel deck as one select: playable saved decks, then a borrowed deck per faction. */
function DeckSelect({
  decks,
  choice,
}: {
  decks: readonly KessenDeckSummary[];
  choice: DeckChoice;
}) {
  const value = choice.deck ? choice.deck.id : `${BORROWED}${choice.borrowFaction}`;
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next.startsWith(BORROWED))
          choice.borrow(next.slice(BORROWED.length) as DeckFaction);
        else choice.setValue(next);
      }}
    >
      <SelectTrigger className="h-[32px] text-[12px]" aria-label="Deck for the duel">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {decks.length > 0 && (
          <SelectGroup>
            <SelectLabel>Your decks</SelectLabel>
            {decks.map((deck) => (
              <SelectItem
                key={deck.id}
                value={deck.id}
                disabled={!deck.ready && !deck.fillable}
              >
                {deck.name}
                {deck.ready
                  ? ""
                  : deck.fillable
                    ? " + borrowed copies"
                    : " (not legal)"}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        <SelectGroup>
          <SelectLabel>Borrow a deck for today</SelectLabel>
          {KESSEN_DECK_FACTIONS.map((faction) => (
            <SelectItem key={faction} value={`${BORROWED}${faction}`}>
              Borrowed {KESSEN_FACTION_NAMES[faction]} deck
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/**
 * One kind of challenge: icon, name, terms and its send button, the option's own
 * controls below, and the server's answer with a link to where the challenge is answered.
 */
function ChallengeOption({
  icon,
  title,
  description,
  sendLabel,
  isSending = false,
  disabled = false,
  onSend,
  feedback,
  followUp,
  children,
}: ChallengeOptionProps) {
  return (
    <section
      aria-label={title}
      className="bg-card flex flex-col gap-[8px] rounded-lg border p-[8px]"
    >
      <div className="flex items-start gap-[8px]">
        <span className="bg-muted grid h-[32px] w-[32px] shrink-0 place-items-center rounded-md">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-tight font-bold">{title}</p>
          <p className="text-muted-foreground text-[12px] leading-snug">
            {description}
          </p>
        </div>
        <Button
          className="h-[32px] shrink-0 px-[12px] text-[12px]"
          disabled={disabled || isSending}
          aria-label={sendLabel}
          onClick={onSend}
        >
          {isSending ? (
            <Loader2 className="h-[14px] w-[14px] animate-spin" aria-hidden />
          ) : (
            "Send"
          )}
        </Button>
      </div>
      {children}
      {feedback && (
        <p
          role={feedback.success ? "status" : "alert"}
          className={cn(
            "text-[12px]",
            feedback.success
              ? "text-green-700 dark:text-green-400"
              : "text-destructive",
          )}
        >
          {feedback.message}{" "}
          {feedback.success && followUp && (
            <Link
              href={followUp.href}
              className="font-semibold text-orange-600 hover:underline"
            >
              {followUp.label}
            </Link>
          )}
        </p>
      )}
    </section>
  );
}

/** A challenge setting; ids are per instance since every message can open the panel. */
function OptionCheckbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-[6px] text-[12px]">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <label htmlFor={id} className="cursor-pointer">
        {label}
        {hint && <span className="text-muted-foreground"> · {hint}</span>}
      </label>
    </div>
  );
}

/** Select values of the borrowed decks, followed by the faction. */
const BORROWED = "borrowed:";

/** Who a challenge goes to, and the public conversation it is sent from, if any. */
interface ChallengePanelProps {
  opponent: ChallengeOpponent;
  /** Announces the match there when it starts. */
  conversationId?: string | null;
}

/** The player a challenge goes to. */
export interface ChallengeOpponent {
  userId: string;
  username: string;
}

interface ChallengeOptionProps {
  icon: ReactNode;
  title: string;
  description: string;
  sendLabel: string;
  isSending?: boolean;
  disabled?: boolean;
  onSend?: () => void;
  feedback?: MutationFeedback | null;
  followUp?: { href: string; label: string };
  children?: ReactNode;
}
