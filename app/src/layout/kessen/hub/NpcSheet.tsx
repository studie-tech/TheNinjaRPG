"use client";

import { isKessenPackId, KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import "../kessen.css";
import "./hub.css";
import { Gift, GraduationCap, HelpCircle, Lock, Swords } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { KessenStartInput } from "@/hooks/kessen/useKessenHub";
import Confirm from "@/layout/Confirm";
import { FeedbackAlert } from "@/layout/FeedbackAlert";
import { KESSEN_ACADEMY, type KessenAcademyLessonKey } from "@/libs/kessen/academy";
import { type DeckFaction, KESSEN_DECK_RULES } from "@/libs/kessen/deck";
import { kessenNpc } from "@/libs/kessen/npcs";
import { KESSEN_KEYWORDS, type KessenKeyword } from "@/libs/kessen/text";
import { cn } from "@/libs/shadui";
import type {
  KessenCatalogEntry,
  KessenCircuitEntry,
  KessenHub,
  KessenPackEntry,
} from "@/validators/kessen";
import { CardBack } from "../CardBack";
import { CardFace } from "../CardFace";
import { FactionSigil } from "../FactionSigil";
import { KeywordGlossary } from "../KeywordText";
import { AscendedMark, NpcPortrait } from "./CircuitMap";
import { DeckPicker, useDeckChoice } from "./DeckPicker";
import {
  activeMatchStateText,
  catalogLookup,
  KESSEN_TIER_LABELS,
  type KessenDeckSummary,
  kessenItemName,
  kessenWinText,
  lockProgressText,
} from "./hubData";
import { PackArt } from "./PacksPanel";
import { useReturnFocus } from "./useReturnFocus";

/** What the start controls ask the server for. */
export type KessenStartRequest = KessenStartInput;

/**
 * NPC detail and start sheet (the game's side sheet): portrait with its bark, house rule,
 * the keywords the NPC teaches, the first-win reward and the start controls (saved deck,
 * borrowed deck of a faction or a saved deck filled with borrowed copies; standard or
 * Ascended). With a mode switch the rule of the chosen mode sits right under it, in a slot
 * as tall as either mode's rule, so switching never moves the controls. With another
 * match unfinished it leads with resuming that match (with its round and score when
 * known); conceding it to start this one is confirmed in a dialog that names the match it
 * starts. A won first-win card not yet chosen leads with a button that reopens that
 * match's end screen. Opening focuses the NPC's name, so the sheet reads from the top;
 * closing returns focus to the pin or row that opened it.
 */
export const NpcSheet = ({
  open,
  onOpenChange,
  entry,
  ...detail
}: Omit<NpcDetailProps, "entry"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: KessenCircuitEntry | null;
}) => {
  const returnFocus = useReturnFocus();
  return (
    <Sheet open={open && entry !== null} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="kessen-ui w-full bg-card p-0 sm:max-w-[520px]"
        onOpenAutoFocus={(event) => {
          returnFocus.onOpenAutoFocus();
          const heading =
            event.target instanceof HTMLElement
              ? event.target.querySelector<HTMLElement>("[data-sheet-focus]")
              : null;
          if (!heading) return;
          event.preventDefault();
          heading.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={returnFocus.onCloseAutoFocus}
      >
        {entry ? (
          <>
            <SheetTitle className="sr-only">
              {entry.name}, {entry.title}
            </SheetTitle>
            <SheetDescription className="sr-only">
              Challenge {entry.name} at the {entry.location}.
            </SheetDescription>
            <NpcDetail key={entry.key} entry={entry} {...detail} />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
};

/** The sheet's content, for inline use. Reset it per NPC with `key={entry.key}`. */
export const NpcDetail = ({
  entry,
  circuit = [],
  cards,
  packs = [],
  decks,
  defaultDeckId,
  loanerFaction,
  needsLesson,
  seenKeywords,
  activeMatch,
  pendingPicks = [],
  pending = false,
  error,
  onStart,
  onStartLesson,
  onResume,
}: NpcDetailProps) => {
  const npc = kessenNpc(entry.key);
  const ascendedOpen = entry.ascendedTier !== null && entry.ascendedLockReason === null;
  const [mode, setMode] = useState<"standard" | "ascended">("standard");
  const deck = useDeckChoice(decks, defaultDeckId, loanerFaction);
  const lookup = catalogLookup(cards);
  const seen = new Set(seenKeywords);
  const teaches = entry.teaches.filter((keyword): keyword is KessenKeyword =>
    (KESSEN_KEYWORDS as readonly string[]).includes(keyword),
  );
  const isLesson = entry.key === "lemu" && needsLesson;
  const locked = isLesson ? null : lockProgressText(entry.lockReason, entry, circuit);
  const ascendedLock = lockProgressText(
    entry.ascendedLockReason,
    entry,
    circuit,
    "ascended",
  );
  const activeHere = activeMatch?.npcKey === entry.key;
  const activeElsewhere = activeMatch !== null && !activeHere;
  const activeName = activeMatch
    ? (kessenNpc(activeMatch.npcKey)?.name ?? activeMatch.npcKey)
    : null;
  const activeState = activeMatch ? activeMatchStateText(activeMatch) : null;
  const pickMatchId =
    pendingPicks.find((pick) => pick.npcKey === entry.key)?.matchId ?? null;
  const wins = kessenWinText(entry);
  const rematchPaysDrops = Boolean(npc?.standard.dropTable);
  // The rule of the match the mode switch would start; the server's `houseRule` is the
  // fallback when the NPC is missing from the bundled roster.
  const standardRule = npc ? npc.standard.houseRule : entry.houseRule;
  const ascendedRule = npc?.ascended?.houseRule ?? null;
  const houseRule = mode === "ascended" ? ascendedRule : standardRule;
  const houseRuleLabel = entry.boss
    ? "Boss rule"
    : mode === "ascended"
      ? "Ascended house rule"
      : "House rule";
  const firstWin = entry.firstWinAt ? null : (npc?.standard.firstWin ?? null);
  const hasModeSwitch =
    Boolean(entry.ascendedTier) && !(locked || activeHere || isLesson);
  const rewardChoice = firstWin?.choice ?? null;
  // The Ascended first win shows in both modes while it is open, so switching modes never
  // moves the switch itself.
  const ascendedFirstWin =
    ascendedOpen && !entry.ascendedFirstWinAt
      ? (npc?.ascended?.firstWin ?? null)
      : null;
  const ascendedRewardIds = ascendedFirstWin
    ? [
        ...ascendedFirstWin.items.map((item) => item.itemId),
        ...(ascendedFirstWin.choice?.kind === "items"
          ? ascendedFirstWin.choice.itemIds
          : []),
      ]
    : [];
  const ascendedPicksOne = ascendedFirstWin?.choice?.kind === "items";

  const challengeSummary = `${
    mode === "ascended" && entry.ascendedTier
      ? `Ascended · ${KESSEN_TIER_LABELS[entry.ascendedTier]}`
      : `Standard · ${KESSEN_TIER_LABELS[entry.tier]}`
  } · ${deck.label}`;
  // The Academy lesson that teaches this opponent's keywords, while it is unfinished.
  const recommended = entry.recommendedLesson
    ? (KESSEN_ACADEMY.find((lesson) => lesson.key === entry.recommendedLesson) ?? null)
    : null;
  const start = (replaceActive?: boolean) =>
    isLesson
      ? onStartLesson("first-blood", replaceActive === true)
      : onStart({
          npcKey: entry.key,
          mode,
          deck: deck.source,
          ...(replaceActive ? { replaceActive: true } : {}),
        });

  return (
    <div
      className="flex min-h-[calc(100dvh-48px)] flex-col text-card-foreground sm:min-h-dvh"
      data-boss={entry.boss ? "" : undefined}
    >
      <div className="flex flex-col gap-4 p-4 pt-2 sm:pt-4">
        <div className="flex items-start gap-3 pr-8">
          <span className="block h-[80px] w-[80px] shrink-0 p-[4px]">
            <NpcPortrait entry={entry} size={96} />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              className="kh-heading text-[24px] leading-tight outline-none"
              tabIndex={-1}
              data-sheet-focus
            >
              {entry.name}
            </h2>
            <p className="text-muted-foreground">{entry.title}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[13px]">
              <FactionSigil
                faction={entry.faction}
                renderSize={18}
                className="w-[16px]"
                decorative
              />
              <span>{KESSEN_FACTION_NAMES[entry.faction]}</span>
              <span className="text-muted-foreground">· {entry.location}</span>
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <Badge
                variant="secondary"
                className="font-medium text-[12px]"
                data-tier="standard"
              >
                {KESSEN_TIER_LABELS[entry.tier]}
                {wins.standard ? ` · ${wins.standard}` : ""}
              </Badge>
              {entry.ascendedTier ? (
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1 font-medium text-[12px]",
                    !ascendedOpen && "border-dashed",
                  )}
                >
                  {ascendedOpen ? (
                    <AscendedMark beaten={Boolean(entry.ascendedFirstWinAt)} />
                  ) : (
                    <Lock className="h-3 w-3" aria-hidden />
                  )}
                  Ascended · {KESSEN_TIER_LABELS[entry.ascendedTier]}
                  {wins.ascended ? ` · ${wins.ascended}` : ""}
                  {ascendedOpen ? null : <span className="sr-only"> (locked)</span>}
                </Badge>
              ) : null}
              {wins.total ? (
                <span className="text-muted-foreground text-[12px]">{wins.total}</span>
              ) : null}
            </div>
          </div>
        </div>

        {/* The bark speaks from the portrait; system lines follow it. */}
        {npc ? (
          <blockquote className="border-primary border-l-4 bg-muted/40 py-2 pr-3 pl-3 italic">
            “{npc.barks.matchStart}”
          </blockquote>
        ) : null}

        {/* A locked opponent leads with its unlock condition, above the rewards. */}
        {locked ? (
          <p className="flex items-start gap-2 rounded-md border border-dashed p-3 text-muted-foreground">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {locked}
          </p>
        ) : pickMatchId ? (
          <div className="flex flex-col gap-2 kh-callout p-3">
            <p>
              Your first-win reward from {entry.name} is waiting. Choose it on that
              match's end screen.
            </p>
            <Button
              decoration="gold"
              className="self-start"
              disabled={pending}
              onClick={() => onResume(pickMatchId)}
            >
              <Gift className="mr-2 h-4 w-4" aria-hidden />
              Choose your reward
            </Button>
          </div>
        ) : entry.firstWinAt ? (
          <p className="text-muted-foreground text-[13px]">
            {ascendedFirstWin
              ? "Standard first win claimed. Standard rematch wins still pay ryo"
              : entry.ascendedFirstWinAt
                ? "First win claimed in both modes. Rematch wins still pay ryo"
                : "First win claimed. Rematch wins still pay ryo"}
            {rematchPaysDrops ? " and can drop cards from this deck" : ""} while today's
            rewarded matches last.
          </p>
        ) : null}

        {houseRule && !hasModeSwitch ? (
          <HouseRule label={houseRuleLabel} rule={houseRule} />
        ) : null}
        {entry.boss ? (
          <p className="text-muted-foreground text-[13px]">
            Boss deck: up to {KESSEN_DECK_RULES.bossMaxLegendaries} legendaries and a
            larger leader bonus. It never sees your hand; its only edge is printed here.
          </p>
        ) : null}

        {recommended && !locked && !isLesson ? (
          <section
            className="flex flex-col gap-2 kh-callout p-3"
            aria-label="Recommended lesson"
          >
            <p className="flex items-start gap-2">
              <GraduationCap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <strong>Learn {recommended.title} first.</strong> Lesson{" "}
                {recommended.order} of the Academy: {recommended.summary}
              </span>
            </p>
            <Button
              variant="outline"
              size="sm"
              className="self-start h-9 text-[13px] pointer-coarse:min-h-11"
              disabled={pending || activeHere}
              onClick={() => onStartLesson(recommended.key, activeElsewhere)}
            >
              <GraduationCap className="mr-2 h-4 w-4" aria-hidden />
              {activeElsewhere ? "Concede and take the lesson" : "Take the lesson"}
            </Button>
          </section>
        ) : null}

        {teaches.length > 0 ? (
          <section aria-label="Keywords in this deck">
            <h3 className={SECTION_HEAD}>Keywords in this deck</h3>
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {teaches.map((keyword) => (
                <li
                  key={keyword}
                  className={cn(seen.has(keyword) && "text-muted-foreground")}
                >
                  {seen.has(keyword) ? null : (
                    <Badge className="mr-1.5 text-[12px]">New</Badge>
                  )}
                  <KeywordGlossary keyword={keyword} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {entry.firstWinPreview.length > 0 ||
        rewardChoice?.kind === "unownedLegendary" ? (
          <section aria-label="First win reward">
            <h3 className={SECTION_HEAD}>First win</h3>
            <ul className={REWARD_ROW}>
              {rewardChoice?.kind === "unownedLegendary" ? (
                <li className="kh-reward-item">
                  <span className="kh-reward-mystery">
                    <CardBack
                      telegraph="LEGENDARY"
                      renderSize={112}
                      className="w-[96px]"
                      aria-hidden
                    />
                    <HelpCircle className="kh-reward-mystery-mark" aria-hidden />
                  </span>
                  <span className={REWARD_NAME}>
                    Choose any legendary you don't own
                  </span>
                </li>
              ) : null}
              {entry.firstWinPreview.map((itemId) => (
                <RewardItem
                  key={itemId}
                  itemId={itemId}
                  lookup={lookup}
                  packs={packs}
                />
              ))}
            </ul>
            {firstWin?.title ? (
              <p className="mt-1 text-[13px]">
                Also the title <strong>{firstWin.title}</strong>.
              </p>
            ) : null}
          </section>
        ) : null}

        {ascendedRewardIds.length > 0 ? (
          <section aria-label="Ascended first win reward">
            <h3 className={SECTION_HEAD}>
              Ascended first win{ascendedPicksOne ? " · choose one" : ""}
            </h3>
            <ul className={REWARD_ROW}>
              {ascendedRewardIds.map((itemId) => (
                <RewardItem
                  key={itemId}
                  itemId={itemId}
                  lookup={lookup}
                  packs={packs}
                />
              ))}
            </ul>
            {ascendedFirstWin?.title ? (
              <p className="mt-1 text-[13px]">
                Also the title <strong>{ascendedFirstWin.title}</strong>.
              </p>
            ) : null}
          </section>
        ) : null}

        {locked && !error ? null : (
          <section className="flex flex-col gap-3" aria-label="Start a match">
            {activeElsewhere && activeName && !locked ? (
              <p className={ACTIVE_NOTE} role="status">
                Your match against {activeName} is unfinished. Resume it, or concede it
                to challenge {entry.name}.
                <span className="block font-semibold tabular-nums">{activeState}</span>
              </p>
            ) : activeHere ? (
              <p className={ACTIVE_NOTE} role="status">
                Your match against {entry.name} is still open.
                <span className="block font-semibold tabular-nums">{activeState}</span>
              </p>
            ) : null}

            {locked || activeHere || isLesson ? null : (
              <>
                {entry.ascendedTier ? (
                  <Tabs
                    value={mode}
                    onValueChange={(value) =>
                      setMode(value === "ascended" ? "ascended" : "standard")
                    }
                  >
                    <TabsList
                      className="grid w-full grid-cols-2"
                      aria-label="Difficulty"
                    >
                      <TabsTrigger value="standard">
                        Standard · {KESSEN_TIER_LABELS[entry.tier]}
                      </TabsTrigger>
                      <TabsTrigger
                        value="ascended"
                        disabled={!ascendedOpen}
                        title={ascendedLock ?? undefined}
                      >
                        Ascended · {KESSEN_TIER_LABELS[entry.ascendedTier]}
                      </TabsTrigger>
                    </TabsList>
                    {!ascendedOpen && ascendedLock ? (
                      <p className="mt-1 text-muted-foreground text-[12px]">
                        {ascendedLock}
                      </p>
                    ) : null}
                  </Tabs>
                ) : null}
                {hasModeSwitch ? (
                  // Both modes' rules share one cell; the hidden one keeps its height.
                  <div className="kh-rule-slot">
                    <div
                      className="kh-rule-slot-mode"
                      data-active={mode === "standard" ? "" : undefined}
                      aria-hidden={mode === "standard" ? undefined : true}
                      inert={mode === "standard" ? undefined : true}
                    >
                      {standardRule ? (
                        <HouseRule
                          label={entry.boss ? "Boss rule" : "House rule"}
                          rule={standardRule}
                        />
                      ) : null}
                      {ascendedRule && !entry.boss ? (
                        <p className="text-muted-foreground text-[13px]">
                          <span className="font-semibold">
                            The Ascended rematch {standardRule ? "uses" : "adds"}
                          </span>{" "}
                          <strong>{ascendedRule.name}</strong>: {ascendedRule.text}
                        </p>
                      ) : null}
                    </div>
                    <div
                      className="kh-rule-slot-mode"
                      data-active={mode === "ascended" ? "" : undefined}
                      aria-hidden={mode === "ascended" ? undefined : true}
                      inert={mode === "ascended" ? undefined : true}
                    >
                      {ascendedRule ? (
                        <HouseRule
                          label={entry.boss ? "Boss rule" : "Ascended house rule"}
                          rule={ascendedRule}
                        />
                      ) : (
                        <p className="text-muted-foreground text-[13px]">
                          The Ascended rematch plays without a house rule.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}

                <DeckPicker decks={decks} idPrefix={entry.key} choice={deck} />
              </>
            )}
            {locked && error ? (
              <FeedbackAlert feedback={{ success: false, message: error }} foreground />
            ) : null}
          </section>
        )}
      </div>

      {locked ? null : (
        // Pinned to the bottom of the scrolling sheet, so the main action shows first.
        <div className="sticky bottom-0 mt-auto flex flex-col gap-2 border-t bg-background p-4">
          {/* The summary names the match the main button starts; with another match
              open it belongs to the concede step instead. */}
          {activeHere || isLesson || activeElsewhere ? null : (
            <p className="text-center text-muted-foreground text-[12px]">
              {challengeSummary}
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
            {activeHere && activeMatch ? (
              <Button
                size="lg"
                disabled={pending}
                onClick={() => onResume(activeMatch.id)}
              >
                <Swords className="mr-2 h-4 w-4" aria-hidden />
                Resume your match
              </Button>
            ) : isLesson ? (
              <Button
                size="lg"
                className="w-full sm:w-auto"
                loading={pending}
                onClick={() => start(activeElsewhere)}
              >
                Learn in 2 minutes with Lemu
              </Button>
            ) : activeElsewhere && activeMatch ? (
              <>
                <Button
                  size="lg"
                  className="w-full sm:w-auto"
                  disabled={pending}
                  onClick={() => onResume(activeMatch.id)}
                >
                  <Swords className="mr-2 h-4 w-4" aria-hidden />
                  Resume vs {activeName}
                </Button>
                <Confirm
                  title={`Concede against ${activeName}?`}
                  tone="destructive"
                  proceed_label={`Concede and challenge ${entry.name}`}
                  proceed_loading_label="Setting the table…"
                  isLoading={pending}
                  button={
                    <Button
                      size="lg"
                      variant="outline"
                      disabled={pending}
                      className="h-auto min-h-10 w-full flex-col gap-0 whitespace-normal py-1.5 sm:w-auto"
                    >
                      {/* The name may wrap; it says who the concede is for. */}
                      <span>Concede it to challenge {entry.name}…</span>
                      <span className="font-normal text-muted-foreground text-[12px]">
                        {challengeSummary}
                      </span>
                    </Button>
                  }
                  onAccept={() => start(true)}
                >
                  <p>
                    Your match against {activeName} ends as a loss with no rewards, and
                    the match against {entry.name} starts.
                  </p>
                  <p className="text-muted-foreground">Then: {challengeSummary}</p>
                </Confirm>
              </>
            ) : (
              <Button
                size="lg"
                className="w-full sm:w-auto"
                loading={pending}
                onClick={() => start()}
              >
                <Swords className="mr-2 h-4 w-4" aria-hidden />
                {pending ? "Setting the table…" : `Challenge ${entry.name}`}
              </Button>
            )}
          </div>
          {error ? (
            <FeedbackAlert feedback={{ success: false, message: error }} foreground />
          ) : null}
        </div>
      )}
    </div>
  );
};

/** One first-win reward: the card face, or a pack's art with its name. */
const RewardItem = ({
  itemId,
  lookup,
  packs,
}: {
  itemId: string;
  lookup: ReturnType<typeof catalogLookup>;
  packs: readonly KessenPackEntry[];
}) => {
  const card = lookup[itemId];
  return (
    <li className="kh-reward-item">
      {card ? (
        <CardFace card={card} renderSize={112} className="w-[96px]" />
      ) : isKessenPackId(itemId) ? (
        <PackArt itemId={itemId} size={88} />
      ) : null}
      {card ? null : (
        <span className={REWARD_NAME}>{kessenItemName(itemId, lookup, packs)}</span>
      )}
    </li>
  );
};

/** A house or boss rule: its name over its text. */
const HouseRule = ({
  label,
  rule,
}: {
  label: string;
  rule: { name: string; text: string };
}) => (
  <div className="rounded-md border bg-muted/40 p-3 text-[13px]">
    <span className="block font-semibold">
      {label}: {rule.name}
    </span>
    <span>{rule.text}</span>
  </div>
);

const SECTION_HEAD = "kh-eyebrow mb-1.5";
const REWARD_ROW = "flex gap-2 overflow-x-auto pb-1";
const REWARD_NAME = "text-center text-[12px] leading-tight";
const ACTIVE_NOTE = "kh-callout p-3 text-[13px]";

type NpcDetailProps = {
  entry: KessenCircuitEntry;
  /** The whole Circuit, for unlock progress ("· 2/3") on locked opponents. */
  circuit?: readonly KessenCircuitEntry[];
  cards: readonly KessenCatalogEntry[];
  packs?: readonly KessenPackEntry[];
  /** Saved decks (see `summarizeDeck`). */
  decks: readonly KessenDeckSummary[];
  /** Deck preselected when it can be played; else the first ready deck. */
  defaultDeckId?: string | null;
  loanerFaction: DeckFaction;
  /** Lemu offers the lesson instead of the ladder match. */
  needsLesson: boolean;
  seenKeywords: readonly string[];
  activeMatch: KessenHub["activeMatch"];
  /** Won matches whose first-win card is still to be chosen. */
  pendingPicks?: KessenHub["pendingPicks"];
  pending?: boolean;
  /** The server's rejection message, shown next to the start button. */
  error?: string | null;
  onStart: (request: KessenStartRequest) => void;
  /** Starts an Academy lesson; `replaceActive` concedes the unfinished match first. */
  onStartLesson: (lessonKey: KessenAcademyLessonKey, replaceActive: boolean) => void;
  /** Opens a match: the unfinished one, or a won one whose first-win card is open. */
  onResume: (matchId: string) => void;
};
