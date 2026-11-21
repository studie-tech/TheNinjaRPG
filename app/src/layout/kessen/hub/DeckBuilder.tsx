"use client";

import "../kessen.css";
import "./hub.css";
import "./builder.css";
import {
  Check,
  ChevronDown,
  Minus,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KESSEN_DECK_NAME_MAX_LENGTH, KESSEN_MAX_DECKS } from "@/drizzle/constants";
import type { KessenDeckCard } from "@/drizzle/schema";
import Confirm from "@/layout/Confirm";
import { EmptyState } from "@/layout/EmptyState";
import { FeedbackAlert } from "@/layout/FeedbackAlert";
import Link from "@/layout/Link";
import Modal from "@/layout/Modal";
import {
  autoBuild,
  type DeckFaction,
  deckSize,
  fillWithBorrowed,
  KESSEN_ALT_LEADERS,
  KESSEN_DECK_FACTIONS,
  KESSEN_DECK_RULES,
  KESSEN_RARITY_ORDER,
  KESSEN_STARTER_LEADERS,
  normalizeDeckCards,
  validateDeck,
} from "@/libs/kessen/deck";
import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import { cardKeywords, KESSEN_KEYWORDS, ROW_LABELS } from "@/libs/kessen/text";
import { cn } from "@/libs/shadui";
import type { KessenFaction } from "@/validators/itemCard";
import type { KessenCatalogEntry, KessenDeckRow } from "@/validators/kessen";
import { CardFace } from "../CardFace";
import { FactionSigil } from "../FactionSigil";
import { RowGlyph, TacticGlyph } from "../glyphs";
import {
  KESSEN_RARITY_LABELS,
  type KessenRarityTier,
  kessenRarityTier,
} from "../kessenArt";
import { LeaderPlate } from "../LeaderPlate";
import { RarityGem } from "../RarityGem";
import {
  catalogLookup,
  copyLimitOf,
  type KessenFindContext,
  whereToFind,
} from "./hubData";

/** What a save sends; resolve with the saved deck's id to keep editing it. */
export type KessenDeckSaveInput = {
  id?: string;
  name: string;
  leaderItemId: string;
  cards: KessenDeckCard[];
};

/**
 * Deck builder: leader plate, provision meter, counters and row split on
 * top of the deck list; the owned collection as a filterable card grid with copy counts,
 * unowned cards greyed with where to get them. Auto-build assembles a deck from owned
 * cards; Fill with borrowed completes a short deck with loaner copies (shown with a LOAN
 * stamp). A saved deck holds owned cards only: one that is merely short is saved as is
 * and every match fills it with borrowed copies again. Inline validation
 * explains every broken rule; a tap that cannot add a card says why over the card. Copies
 * listed at the auction house keep a card in the owned pool with a "listed" mark, but
 * only free copies join a deck. Narrow containers and short
 * landscape screens switch to Collection | Deck tabs with a deck bar pinned to the bottom
 * of the screen. Unsaved edits are marked, survive leaving
 * the tab (session storage) and are confirmed before another deck replaces them; a
 * leader switch that drops cards and a deletion are confirmed in the game's dialogs.
 */
export const DeckBuilder = ({
  cards,
  owned,
  listed: auctionListed = NO_LISTINGS,
  decks,
  userId,
  dayKey,
  defaultFaction,
  initialDeckId,
  findContext,
  onSave,
  onDelete,
  pending = false,
  error,
  className,
}: {
  cards: readonly KessenCatalogEntry[];
  /** Owned copies per item id (copies listed in the auction house excluded). */
  owned: Readonly<Record<string, number>>;
  /** Copies listed in the auction house per item id; they cannot join a deck. */
  listed?: Readonly<Record<string, number>>;
  decks: readonly KessenDeckRow[];
  /** Seeds auto-build and borrowed fills like the server does. */
  userId: string;
  /** Server day key (`YYYY-MM-DD`), the loaner seed of borrowed fills. */
  dayKey: string;
  /** Faction of a new deck: the home faction, else today's loaner faction. */
  defaultFaction: DeckFaction;
  initialDeckId?: string | null;
  /** Sources for "where to get" captions of unowned cards. */
  findContext?: KessenFindContext;
  onSave: (
    input: KessenDeckSaveInput,
  ) => Promise<{ ok: boolean; deckId?: string } | undefined> | undefined;
  /** Resolves true once the deck is deleted; the builder then moves to another deck. */
  onDelete: (deckId: string) => Promise<boolean>;
  pending?: boolean;
  /** The server's rejection message, shown next to Save. */
  error?: string | null;
  className?: string;
}) => {
  const lookup = catalogLookup(cards);
  // Unsaved edits kept from an earlier visit open first; when another deck was asked
  // for, the discard prompt asks before it replaces them.
  const [opening] = useState(() =>
    openingDraft({ userId, initialDeckId, decks, defaultFaction, owned }),
  );
  const [draft, setDraft] = useState<Draft>(opening.draft);
  const [tab, setTab] = useState<"collection" | "deck">("collection");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [notice, setNotice] = useState<string | null>(null);
  /** A deck the player asked to open while the draft has unsaved changes. */
  const [pendingSwitch, setPendingSwitch] = useState<{
    deck: KessenDeckRow | null;
  } | null>(opening.pendingSwitch);
  /** Why the last tapped collection card could not be added. */
  const [blocked, setBlocked] = useState<{ id: string; text: string } | null>(null);
  /** A leader change that would drop cards of another faction, awaiting confirmation. */
  const [pendingLeader, setPendingLeader] = useState<{
    leaderId: string;
    removed: number;
  } | null>(null);
  /** Whether short side-by-side panels write the leader ability out. */
  const [abilityOpen, setAbilityOpen] = useState(false);
  const saveHintId = useId();
  const builderRef = useRef<HTMLElement>(null);
  const deckPanelRef = useRef<HTMLElement>(null);
  const leaderRef = useRef<HTMLButtonElement>(null);
  /** The control that asked for another deck; the discard prompt returns focus to it. */
  const switchOpenerRef = useRef<HTMLElement | null>(null);
  useScrollIntoViewWhenWide(builderRef);
  const inDialog = useInDialog(builderRef);

  const leader = lookup[draft.leaderId] ?? null;
  const faction: DeckFaction | null =
    leader && leader.faction !== "NEUTRAL" ? (leader.faction as DeckFaction) : null;
  const deckCards = toDeckCards(draft.counts);
  const borrowedCards = toDeckCards(draft.borrowed);
  const validation = validateDeck(
    { leaderId: draft.leaderId, cards: deckCards },
    lookup,
    {
      owned,
      borrowed: borrowedCards,
    },
  );
  const { stats } = validation;
  // What Save stores: the owned part of the deck, without the borrowed preview.
  const ownedCards = toDeckCards(subtractCounts(draft.counts, draft.borrowed));
  const savedValidation = validateDeck(
    { leaderId: draft.leaderId, cards: ownedCards },
    lookup,
    { owned },
  );
  // A deck short of cards or owned copies only is saved; matches fill the rest.
  const savedFill =
    !savedValidation.ok &&
    savedValidation.errors.every(
      (error) => error.code === "size" || error.code === "notOwned",
    )
      ? fillWithBorrowed({
          userId,
          dayKey,
          deck: { leaderId: draft.leaderId, cards: ownedCards },
          owned,
          cards,
        })
      : null;
  const ownedSize = deckSize(ownedCards);
  // A saved deck holds at least one owned card; matches lend the rest.
  const savable = ownedSize > 0 && (savedValidation.ok || savedFill !== null);
  const hasBorrowed = borrowedCards.length > 0;
  const atDeckCap = decks.length >= KESSEN_MAX_DECKS;
  const savedDeck = draft.id
    ? (decks.find((deck) => deck.id === draft.id) ?? null)
    : null;
  const dirty = savedDeck
    ? savedDeck.name !== draft.name.trim() ||
      savedDeck.leaderItemId !== draft.leaderId ||
      !sameCards(savedDeck.cards, ownedCards)
    : deckCards.length > 0;
  const canSave =
    savable &&
    draft.name.trim().length > 0 &&
    !pending &&
    (draft.id === null ? !atDeckCap : dirty);
  const deckFull = stats.cards >= KESSEN_DECK_RULES.maxCards;
  // Ready means playable and saveable; an all-borrowed preview plays but cannot be saved.
  const readiness = validation.ok ? (savable ? "ready" : "unsaveable") : "fix";
  const leaders = cards
    .filter((card) => card.kind === "LEADER" && card.isCollectible)
    .sort(
      (a, b) =>
        factionOrder(a.faction) - factionOrder(b.faction) ||
        a.name.localeCompare(b.name),
    );

  // Listed copies are still the player's: they keep a card in the owned pool, but only
  // free copies join a deck.
  const heldOf = (id: string) => (owned[id] ?? 0) + (auctionListed[id] ?? 0);
  const pool = cards
    .filter((card) => card.kind !== "LEADER" && card.isCollectible)
    .filter((card) => matchesFilters(card, filters, faction, heldOf))
    .sort(
      (a, b) =>
        a.provision - b.provision ||
        KESSEN_RARITY_ORDER.indexOf(a.rarity) - KESSEN_RARITY_ORDER.indexOf(b.rarity) ||
        a.name.localeCompare(b.name),
    );

  const inDeck = (id: string) => draft.counts[id] ?? 0;
  const ownedFree = (card: KessenCatalogEntry) =>
    Math.min(copyLimitOf(card), owned[card.id] ?? 0) -
    (inDeck(card.id) - (draft.borrowed[card.id] ?? 0));

  // A switch prompt only stands while there is something to discard.
  if (pendingSwitch && !dirty) setPendingSwitch(null);

  const update = (change: (current: Draft) => Draft) => {
    setNotice(null);
    setBlocked(null);
    setPendingLeader(null);
    setDraft(change);
  };

  /** Why `card` cannot be added right now; null when it can. */
  const addBlockReason = (card: KessenCatalogEntry, borrowable: boolean) => {
    const ownedCount = owned[card.id] ?? 0;
    const limit = copyLimitOf(card);
    if (ownedCount === 0)
      return (auctionListed[card.id] ?? 0) > 0
        ? "Your copies are listed at the auction house."
        : borrowable
          ? "Not owned. Borrowed fills lend random copies, so this one cannot be picked."
          : "Not owned yet.";
    if (inDeck(card.id) >= limit) return `Copy limit reached (${limit}/${limit}).`;
    if (ownedFree(card) <= 0)
      return `All ${ownedCount} of your ${ownedCount === 1 ? "copy is" : "copies are"} in the deck.`;
    if (deckFull) return `The deck is full at ${KESSEN_DECK_RULES.maxCards} cards.`;
    return null;
  };

  const addCard = (card: KessenCatalogEntry) => {
    if (ownedFree(card) <= 0 || inDeck(card.id) >= copyLimitOf(card) || deckFull)
      return;
    // Checked again against the latest draft, so taps faster than a render add no more
    // than the limits allow.
    update((current) => {
      const count = current.counts[card.id] ?? 0;
      const ownedInDeck = count - (current.borrowed[card.id] ?? 0);
      if (
        count >= copyLimitOf(card) ||
        ownedInDeck >= (owned[card.id] ?? 0) ||
        deckSize(toDeckCards(current.counts)) >= KESSEN_DECK_RULES.maxCards
      )
        return current;
      return { ...current, counts: { ...current.counts, [card.id]: count + 1 } };
    });
  };

  const removeCard = (id: string) =>
    update((current) => {
      const counts = { ...current.counts, [id]: (current.counts[id] ?? 0) - 1 };
      const borrowed = { ...current.borrowed };
      if ((borrowed[id] ?? 0) > 0) borrowed[id] = (borrowed[id] ?? 0) - 1;
      return { ...current, counts: prune(counts), borrowed: prune(borrowed) };
    });

  /** Cards of `leaderId`'s deck after the switch, and how many copies leave. */
  const leaderSwitch = (leaderId: string) => {
    const next = lookup[leaderId];
    let removed = 0;
    const counts: Record<string, number> = {};
    for (const [id, count] of Object.entries(draft.counts)) {
      const card = lookup[id];
      if (next && card && card.faction !== "NEUTRAL" && card.faction !== next.faction) {
        removed += count;
        continue;
      }
      counts[id] = count;
    }
    return { counts, removed };
  };

  /** Changes the leader; one that drops other-faction cards asks first. */
  const chooseLeader = (leaderId: string, confirmed = false) => {
    if (!lookup[leaderId]) return;
    const { counts, removed } = leaderSwitch(leaderId);
    if (removed > 0 && !confirmed) {
      setPendingLeader({ leaderId, removed });
      return;
    }
    update((current) => ({ ...current, leaderId, counts, borrowed: {} }));
    if (removed > 0)
      setNotice(
        `${removed} ${removed === 1 ? "card" : "cards"} of another faction left the deck.`,
      );
  };

  const loadDeck = (deck: KessenDeckRow | null) => {
    setDraft(
      deck ? draftOf(deck) : newDraft(faction ?? defaultFaction, owned, decks.length),
    );
    setNotice(null);
    setBlocked(null);
    setPendingSwitch(null);
    setPendingLeader(null);
  };

  /** Opens another deck (or a new one), asking first when edits would be lost. */
  const requestDeck = (deck: KessenDeckRow | null) => {
    if (deck && deck.id === draft.id) return;
    if (dirty) {
      switchOpenerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingSwitch({ deck });
    } else loadDeck(deck);
  };

  /** Deletes the open deck, then opens the next saved deck (or a new draft). */
  const deleteDraft = async (deckId: string) => {
    if (!(await onDelete(deckId))) return;
    const remaining = decks.filter((deck) => deck.id !== deckId);
    setDraft(
      remaining[0]
        ? draftOf(remaining[0])
        : newDraft(faction ?? defaultFaction, owned, remaining.length),
    );
    setNotice(null);
    setPendingSwitch(null);
    setPendingLeader(null);
  };

  const runAutoBuild = () => {
    const target = faction ?? defaultFaction;
    const built = autoBuild({
      userId,
      faction: target,
      owned,
      cards,
      leaderId:
        leader?.kind === "LEADER" && (owned[leader.id] ?? 0) > 0
          ? leader.id
          : undefined,
    });
    if (!built) {
      setNotice(
        "Your cards cannot form a full deck for this leader yet. Fill with borrowed shows what a match would lend you.",
      );
      return;
    }
    update((current) => ({
      ...current,
      leaderId: built.leaderId,
      counts: countsOf(built.cards),
      borrowed: {},
    }));
    setNotice("Auto-built from your best owned cards.");
  };

  const runFill = () => {
    const filled = fillWithBorrowed({
      userId,
      dayKey,
      deck: { leaderId: draft.leaderId, cards: deckCards },
      owned,
      cards,
    });
    if (!filled) {
      setNotice(
        `This deck cannot be filled yet: ${lowerFirst(fillRule ?? "fix the deck rules above first.")}`,
      );
      return;
    }
    update((current) => ({
      ...current,
      counts: countsOf(filled.cards),
      borrowed: countsOf(filled.borrowed),
    }));
    // The fill completes a deck with spare owned copies first, then borrowed ones.
    setNotice(
      filled.borrowed.length > 0
        ? "Filled with borrowed copies (LOAN)."
        : deckSize(filled.cards) > deckSize(deckCards)
          ? "Filled with your own spare copies."
          : "Nothing to fill: the deck is complete.",
    );
  };

  const save = async () => {
    if (!canSave) return;
    const result = await onSave({
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name.trim(),
      leaderItemId: draft.leaderId,
      cards: ownedCards,
    });
    if (!result?.ok) return;
    if (result.deckId)
      setDraft((current) => ({ ...current, id: result.deckId ?? current.id }));
    // Saved: nothing is left to discard and earlier notes describe the old draft.
    setNotice(null);
    setPendingSwitch(null);
  };

  const listed = deckCards
    .map((entry) => ({ entry, card: lookup[entry.itemId] }))
    .filter((row): row is { entry: KessenDeckCard; card: KessenCatalogEntry } =>
      Boolean(row.card),
    )
    .sort(
      (a, b) =>
        b.card.provision - a.card.provision || a.card.name.localeCompare(b.card.name),
    );
  const rows = rowSplit(listed);
  const over = stats.budget > 0 ? stats.provision - stats.budget : 0;
  const messages = validationMessages(validation.errors, listed, over);
  // The first rule Fill cannot fix (anything but size and ownership).
  const fillRule =
    validationMessages(
      validation.errors.filter(
        (error) => error.code !== "size" && error.code !== "notOwned",
      ),
      listed,
      over,
    )[0] ?? null;
  const fillBlocked = !leader
    ? "Choose a leader first."
    : validation.ok
      ? "The deck is complete: Fill with borrowed only tops up a short deck."
      : deckFull
        ? `The deck is full: Fill with borrowed only tops up a short deck.${fillRule ? ` ${fillRule}` : ""}`
        : null;
  const keepNote =
    ownedSize > 0 && savedFill && savedFill.borrowed.length > 0
      ? `Save keeps the ${ownedSize} ${ownedSize === 1 ? "card" : "cards"} you own; matches lend the other ${deckSize(savedFill.borrowed)} as borrowed copies.`
      : null;
  const note = [notice, keepNote].filter(Boolean).join(" ");
  const saveReason = saveBlockReason({
    pending,
    isNew: draft.id === null,
    atDeckCap,
    named: draft.name.trim().length > 0,
    ownedSize,
    hasBorrowed,
    savable,
    dirty,
    blocking: savedBlockingMessage(savedValidation, ownedCards, lookup),
  });

  // Keep unsaved edits for this session, so leaving the Decks tab does not lose them.
  useEffect(() => {
    writeStoredDraft(
      userId,
      dirty ? { draft, base: savedDeck ? deckPrint(savedDeck) : null } : null,
    );
  }, [userId, draft, dirty, savedDeck]);

  const pendingLeaderCard = pendingLeader ? lookup[pendingLeader.leaderId] : undefined;

  return (
    <section
      ref={builderRef}
      className={cn("kh-builder text-card-foreground", className)}
      data-tab={tab}
      data-host={inDialog ? "dialog" : undefined}
      aria-label="Deck builder"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as typeof tab)}
        className="kh-builder-tabs"
      >
        <TabsList aria-label="Deck builder view" className="grid grid-cols-2">
          <TabsTrigger value="collection">Collection</TabsTrigger>
          <TabsTrigger value="deck">
            Deck · {deckSizeShort(stats.cards)}
            {dirty ? <DirtyDot label="unsaved changes" /> : null}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="kh-builder-grid">
        <div className="kh-builder-pool kh-panel-chrome">
          {/* Every pool tile holds three stops; keyboard users can jump past them. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="kh-skip"
            onClick={() => {
              setTab("deck");
              window.requestAnimationFrame(() =>
                deckPanelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus(),
              );
            }}
          >
            Skip to the deck
          </Button>
          <FilterBar filters={filters} onChange={setFilters} faction={faction} />
          {pool.length === 0 ? (
            <EmptyState
              title="No cards match these filters."
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                >
                  <X className="mr-1 h-[14px] w-[14px]" aria-hidden />
                  Clear filters
                </Button>
              }
            />
          ) : (
            <ul className="kh-bgrid">
              {pool.map((card) => {
                const ownedCount = owned[card.id] ?? 0;
                const count = inDeck(card.id);
                const loan = draft.borrowed[card.id] ?? 0;
                const limit = copyLimitOf(card);
                const borrowable =
                  faction !== null &&
                  (card.faction === faction || card.faction === "NEUTRAL") &&
                  card.variant === "STANDARD";
                const reason = addBlockReason(card, borrowable);
                const explained = blocked?.id === card.id ? blocked.text : null;
                const tryAdd = () =>
                  reason ? setBlocked({ id: card.id, text: reason }) : addCard(card);
                const listedCount = auctionListed[card.id] ?? 0;
                const caption: ReactNode =
                  ownedCount > 0 ? null : listedCount > 0 ? (
                    <Link href="/auctionhouse">Listed at the auction house</Link>
                  ) : borrowable ? (
                    "Not owned · may appear in borrowed fills"
                  ) : findContext ? (
                    (whereToFind(card, findContext)[0] ?? "Not owned")
                  ) : (
                    "Not owned"
                  );
                return (
                  <li
                    key={card.id}
                    className="kh-bcard"
                    data-in-deck={count > 0 ? "" : undefined}
                  >
                    <button
                      type="button"
                      className="kh-bcard-add"
                      aria-disabled={reason ? true : undefined}
                      onClick={tryAdd}
                      aria-label={`Add ${card.name}. ${count} of ${limit} in deck, ${ownedCount} owned${listedCount > 0 ? `, ${listedCount} listed` : ""}${reason ? `. ${reason}` : ""}`}
                      data-button-sfx="off"
                    >
                      {/* The tile prints its own counts, so the face shows no copy pips. */}
                      <CardFace
                        card={card}
                        renderSize={170}
                        copies={{ owned: Math.min(ownedCount, limit), max: limit }}
                        showCopyPips={false}
                        disabled={ownedCount === 0 && listedCount === 0}
                        aria-hidden
                      />
                      {ownedCount > 0 || listedCount > 0 ? (
                        <span className="kh-bcard-marks" aria-hidden>
                          {ownedCount > 0 ? (
                            <Badge variant="secondary" className="kh-bcard-mark">
                              ×{ownedCount}
                            </Badge>
                          ) : null}
                          {listedCount > 0 ? (
                            <Badge
                              variant="secondary"
                              className="kh-bcard-mark"
                              data-listed
                            >
                              {listedCount} listed
                            </Badge>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                    {explained ? (
                      <span className="kh-bcard-blocked" role="status">
                        {explained}
                      </span>
                    ) : null}
                    {/* One stepper on every owned card, the owned count on the art's
                        corner; a caption shows only for a loan or where an unowned card
                        comes from. */}
                    {ownedCount > 0 || count > 0 ? (
                      <span className="kh-bcard-foot">
                        <StepButton
                          disabled={count === 0}
                          onClick={() => removeCard(card.id)}
                          label={`Remove one ${card.name}`}
                        >
                          <Minus aria-hidden />
                        </StepButton>
                        <span
                          className="kh-bcard-count"
                          data-zero={count === 0 ? "" : undefined}
                        >
                          {count}
                          <span className="kh-copy-limit">/{limit}</span>
                          <span className="sr-only"> in deck</span>
                        </span>
                        <StepButton
                          softDisabled={reason !== null}
                          onClick={tryAdd}
                          label={`Add one ${card.name}${reason ? ` (${reason})` : ""}`}
                        >
                          <Plus aria-hidden />
                        </StepButton>
                      </span>
                    ) : null}
                    {caption || loan > 0 ? (
                      <span className="kh-bcard-caption text-muted-foreground">
                        {caption ?? `${loan} on loan`}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {/* Side by side, the column scrolls: cards passing its lower edge fade out. */}
          <span className="kh-scroll-fade" aria-hidden />
        </div>

        <aside
          ref={deckPanelRef}
          className="kh-builder-deck kh-panel-chrome"
          aria-label="Deck"
        >
          <fieldset className="kh-decktabs">
            <legend className="sr-only">Saved decks</legend>
            {decks.map((deck) => (
              <Button
                key={deck.id}
                type="button"
                size="sm"
                variant="outline"
                className="kh-decktab"
                aria-pressed={draft.id === deck.id}
                title={deck.name}
                onClick={() => requestDeck(deck)}
              >
                {lookup[deck.leaderItemId] ? (
                  <FactionSigil
                    faction={lookup[deck.leaderItemId]?.faction ?? "NEUTRAL"}
                    renderSize={16}
                    className="w-[16px] shrink-0"
                    decorative
                  />
                ) : null}
                <span className="min-w-0 truncate">{deck.name}</span>
                {draft.id === deck.id && dirty ? (
                  <DirtyDot label="unsaved changes" />
                ) : null}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="kh-decktab"
              data-new
              aria-pressed={draft.id === null}
              disabled={atDeckCap && draft.id !== null}
              title={atDeckCap ? `Up to ${KESSEN_MAX_DECKS} decks` : undefined}
              onClick={() => requestDeck(null)}
            >
              <Plus className="h-[13px] w-[13px]" aria-hidden />
              New
              {draft.id === null && dirty ? <DirtyDot label="unsaved changes" /> : null}
            </Button>
          </fieldset>

          {leader ? (
            // Short side-by-side panels fold the ability to its name; the toggle (hidden
            // elsewhere) writes it out, so the deck's cards keep the first screen.
            <div
              className="kh-builder-leaderbox"
              data-open={abilityOpen ? "" : undefined}
            >
              <LeaderPlate leader={leader} className="kh-builder-leader" />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="kh-leader-toggle"
                aria-expanded={abilityOpen}
                onClick={() => setAbilityOpen((open) => !open)}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {abilityOpen ? null : (leader.abilityName ?? "Leader ability")}
                </span>
                <span className="shrink-0 text-[11px]">
                  {abilityOpen ? "Hide" : "Show"}
                  <span className="sr-only"> ability text</span>
                </span>
                <ChevronDown
                  className={cn(
                    "h-[14px] w-[14px] shrink-0",
                    abilityOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </Button>
            </div>
          ) : null}
          <div className="kh-field-row">
            <div className="kh-field">
              <Label htmlFor={`${saveHintId}-leader`} className="kh-field-label">
                Leader
              </Label>
              <Select value={draft.leaderId} onValueChange={(id) => chooseLeader(id)}>
                <SelectTrigger
                  id={`${saveHintId}-leader`}
                  ref={leaderRef}
                  aria-label="Leader"
                  className="kh-field-input min-w-0"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="kessen-ui kh-builder-listbox">
                  {leaders.map((option) => (
                    <SelectItem
                      key={option.id}
                      value={option.id}
                      className="kh-builder-option"
                      disabled={
                        (owned[option.id] ?? 0) < 1 && option.id !== draft.leaderId
                      }
                    >
                      {option.name} · {KESSEN_FACTION_NAMES[option.faction]}
                      {(owned[option.id] ?? 0) < 1 ? " (not owned)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="kh-field">
              <Label htmlFor={`${saveHintId}-name`} className="kh-field-label">
                Name
              </Label>
              <Input
                id={`${saveHintId}-name`}
                className="kh-field-input min-w-0"
                value={draft.name}
                title={draft.name}
                maxLength={KESSEN_DECK_NAME_MAX_LENGTH}
                onChange={(event) => {
                  const name = event.target.value;
                  setNotice(null);
                  setDraft((current) => ({ ...current, name }));
                }}
              />
            </div>
          </div>
          <ProvisionMeter provision={stats.provision} budget={stats.budget} />
          <p className="kh-counters text-muted-foreground">
            <span>{stats.units} units</span>
            <span>{stats.tactics} tactics</span>
            <Counter
              bad={
                stats.cards < KESSEN_DECK_RULES.minCards ||
                stats.cards > KESSEN_DECK_RULES.maxCards
              }
            >
              {stats.cards} cards
            </Counter>
            <Counter bad={stats.legendaries > KESSEN_DECK_RULES.maxLegendaries}>
              {stats.legendaries}/{KESSEN_DECK_RULES.maxLegendaries} legendaries
            </Counter>
            <Counter bad={stats.infiltrators > KESSEN_DECK_RULES.maxInfiltrators}>
              {stats.infiltrators}/{KESSEN_DECK_RULES.maxInfiltrators} infiltrators
            </Counter>
          </p>
          <RowSplit rows={rows} />

          {messages.length > 0 ? (
            <Alert variant="destructive" className="kh-valid-bad" aria-live="polite">
              <AlertDescription>
                <ul className="list-disc space-y-1 pl-4 text-[13px]">
                  {messages.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : readiness === "ready" ? (
            <p className="kh-valid-ok">
              <Check className="h-[14px] w-[14px] shrink-0" aria-hidden />
              Ready to play.
            </p>
          ) : (
            <p className="kh-valid-ok" data-state="unsaveable">
              Playable, but not saveable yet
              {ownedSize === 0 ? ": it holds no card you own." : "."}
            </p>
          )}
          {note ? <p className="kh-deck-note">{note}</p> : null}

          <div className="kh-deck-actions">
            <Button type="button" variant="secondary" size="sm" onClick={runAutoBuild}>
              <Wand2 className="mr-1 h-[15px] w-[15px]" aria-hidden />
              Auto-build
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={cn(fillBlocked && "opacity-50")}
              onClick={() => (fillBlocked ? setNotice(fillBlocked) : runFill())}
              aria-disabled={fillBlocked ? true : undefined}
              title={fillBlocked ?? undefined}
            >
              <Sparkles className="mr-1 h-[15px] w-[15px]" aria-hidden />
              Fill with borrowed
            </Button>
            {deckCards.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="kh-deck-clear"
                title="Clear the deck"
                onClick={() =>
                  update((current) => ({ ...current, counts: {}, borrowed: {} }))
                }
              >
                <X className="h-[14px] w-[14px]" aria-hidden />
                <span className="kh-deck-clear-label ml-1">Clear</span>
              </Button>
            ) : null}
          </div>

          <ol className="kh-decklist" aria-label="Cards in the deck">
            {listed.length === 0 ? (
              <li className="kh-decklist-empty">
                Tap cards in the collection to add them.
              </li>
            ) : (
              listed.map(({ entry, card }) => {
                const loan = draft.borrowed[card.id] ?? 0;
                const tier = kessenRarityTier(card);
                const limit = copyLimitOf(card);
                const addBlocked =
                  entry.count >= limit
                    ? `copy limit ${limit} reached`
                    : ownedFree(card) <= 0
                      ? "no spare copy owned"
                      : deckFull
                        ? `the deck is at ${KESSEN_DECK_RULES.maxCards} cards`
                        : null;
                return (
                  <li key={card.id} className="kh-dl-row" data-tier={tier}>
                    <span className="kh-dl-prov" title={`Provision ${card.provision}`}>
                      <span className="sr-only">Provision </span>
                      {card.provision}
                    </span>
                    <span className="kh-dl-glyph" aria-hidden>
                      {card.kind === "TACTIC" ? (
                        <TacticGlyph />
                      ) : card.row ? (
                        <RowGlyph row={card.row} decorative />
                      ) : null}
                    </span>
                    <span className="flex min-w-0 flex-col items-start gap-[1px]">
                      <span className="kh-dl-name">{card.name}</span>
                      {loan > 0 ? (
                        <Badge variant="destructive" className="kh-dl-loan">
                          LOAN {loan}
                        </Badge>
                      ) : null}
                    </span>
                    <RarityGem tier={tier} className="text-[13px]" />
                    <span
                      className="kh-dl-count"
                      data-max={entry.count >= limit ? "" : undefined}
                    >
                      {entry.count}
                      <span className="kh-copy-limit">/{limit}</span>
                    </span>
                    <StepButton
                      onClick={() => removeCard(card.id)}
                      label={`Remove one ${card.name}`}
                    >
                      <Minus aria-hidden />
                    </StepButton>
                    <StepButton
                      disabled={addBlocked !== null}
                      onClick={() => addCard(card)}
                      label={`Add one ${card.name}${addBlocked ? ` (${addBlocked})` : ""}`}
                    >
                      <Plus aria-hidden />
                    </StepButton>
                  </li>
                );
              })
            )}
            <li className="kh-scroll-fade" aria-hidden />
          </ol>

          <div className="kh-builder-savebar">
            <div className="kh-builder-save">
              <Button
                type="button"
                className="kh-save-button"
                disabled={!canSave}
                loading={pending}
                aria-describedby={saveReason ? saveHintId : undefined}
                onClick={() => void save()}
              >
                {draft.id ? "Save deck" : "Save new deck"}
              </Button>
              {dirty && !pending ? (
                <span className="kh-dirty">
                  <DirtyDot />
                  Unsaved
                  <span className="kh-dirty-long"> changes</span>
                </span>
              ) : null}
              {draft.id ? (
                <Confirm
                  title="Delete this deck?"
                  className="kessen-ui kh-builder-dialog"
                  tone="destructive"
                  proceed_label="Delete deck"
                  proceed_loading_label="Deleting"
                  isLoading={pending}
                  triggerClassName="kh-deck-delete"
                  button={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="kh-delete-button"
                      disabled={pending}
                      aria-label="Delete"
                      title="Delete this deck"
                    >
                      <Trash2 className="h-[14px] w-[14px]" aria-hidden />
                      <span className="kh-deck-delete-label ml-1" aria-hidden>
                        Delete
                      </span>
                    </Button>
                  }
                  onAccept={() => {
                    if (draft.id) void deleteDraft(draft.id);
                  }}
                >
                  <p className="kh-builder-dialog-body">
                    Delete <strong>“{savedDeck?.name ?? draft.name}”</strong>? This
                    cannot be undone.
                  </p>
                </Confirm>
              ) : null}
            </div>
            {saveReason ? (
              <p id={saveHintId} className="kh-save-hint text-muted-foreground">
                {saveReason}
              </p>
            ) : null}
            {error ? (
              <div className="kh-save-error">
                <FeedbackAlert
                  feedback={{ success: false, message: error }}
                  foreground
                />
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      {/* Fills the strip between the fixed bars and the bottom navigation, clipped to the
          open panel so the page's end shows the panel's edge and the page beneath. */}
      <span className="kh-bar-clip" aria-hidden>
        <span className="kh-bar-backdrop" />
      </span>
      <div className="kh-deckbar-dock">
        <span className="kh-deckbar-fade" aria-hidden />
        <button
          type="button"
          className="kh-deckbar"
          onClick={() => setTab("deck")}
          aria-label={`View deck: ${deckSizeText(stats.cards)}, provision ${stats.provision} of ${stats.budget}, ${readiness === "ready" ? "ready" : readiness === "unsaveable" ? "not saveable yet" : `${messages.length} to fix`}${dirty ? ", unsaved changes" : ""}`}
        >
          <span className="kh-deckbar-count">
            {deckSizeShort(stats.cards)} cards
            {dirty ? <DirtyDot /> : null}
          </span>
          <span className="kh-deckbar-prov" data-over={over > 0 ? "" : undefined}>
            {stats.provision}/{stats.budget || "–"}
          </span>
          <span className="kh-deckbar-state" data-state={readiness}>
            {readiness === "ready" ? (
              <>
                <Check className="h-[13px] w-[13px]" aria-hidden />
                Ready
              </>
            ) : readiness === "unsaveable" ? (
              "Not saveable yet"
            ) : (
              `${messages.length} to fix`
            )}
          </span>
          <span className="kh-deckbar-go">View deck</span>
        </button>
      </div>

      <Modal
        title="Discard unsaved changes?"
        className="kessen-ui kh-builder-dialog"
        isOpen={pendingSwitch !== null && dirty}
        setIsOpen={(open) => {
          if (!(typeof open === "function" ? open(true) : open)) setPendingSwitch(null);
        }}
        returnFocusRef={switchOpenerRef}
        tone="destructive"
        proceed_label="Discard changes"
        closeButton={false}
        footerExtra={
          <Button
            type="button"
            variant="outline"
            className="order-1"
            onClick={() => setPendingSwitch(null)}
          >
            Keep editing
          </Button>
        }
        onAccept={() => {
          if (pendingSwitch) loadDeck(pendingSwitch.deck);
        }}
      >
        <p role="alert" className="kh-builder-dialog-body">
          {draft.name.trim() || "This deck"} has unsaved changes. Open{" "}
          {pendingSwitch?.deck ? pendingSwitch.deck.name : "a new deck"} and discard
          them?
        </p>
      </Modal>
      <Modal
        title="Switch leader?"
        className="kessen-ui kh-builder-dialog"
        isOpen={pendingLeader !== null}
        setIsOpen={(open) => {
          if (!(typeof open === "function" ? open(true) : open)) setPendingLeader(null);
        }}
        returnFocusRef={leaderRef}
        tone="destructive"
        proceed_label={`Switch and remove ${pendingLeader?.removed ?? ""}`}
        closeButton={false}
        footerExtra={
          <Button
            type="button"
            variant="outline"
            className="order-1"
            onClick={() => setPendingLeader(null)}
          >
            Keep {leader?.name ?? "the current leader"}
          </Button>
        }
        onAccept={() => {
          if (pendingLeader) chooseLeader(pendingLeader.leaderId, true);
        }}
      >
        <p role="alert" className="kh-builder-dialog-body">
          <strong>{pendingLeaderCard?.name ?? "This leader"}</strong> leads{" "}
          {KESSEN_FACTION_NAMES[pendingLeaderCard?.faction ?? "NEUTRAL"]}. Switching
          removes {pendingLeader?.removed}{" "}
          {faction ? `${KESSEN_FACTION_NAMES[faction]} ` : ""}
          {pendingLeader?.removed === 1 ? "card" : "cards"} from the deck.
        </p>
      </Modal>
    </section>
  );
};

/** Provision used against the budget; vermilion, with the excess named, when over. */
export const ProvisionMeter = ({
  provision,
  budget,
}: {
  provision: number;
  budget: number;
}) => {
  const fill = budget > 0 ? Math.min(100, Math.round((provision / budget) * 100)) : 0;
  const over = budget > 0 && provision > budget ? provision - budget : 0;
  return (
    <div className="kh-prov-meter" data-over={over > 0 ? "" : undefined}>
      <span className="kh-field-label">Provision</span>
      <Progress
        value={fill}
        aria-label={`Provision ${provision} of ${budget}`}
        className="kh-prov-meter-track"
        indicatorClassName="kh-prov-meter-fill"
      />
      <span className="kh-prov-meter-value">
        {provision} / {budget || "–"}
      </span>
      {over > 0 ? <span className="kh-prov-meter-over">{over} over budget</span> : null}
    </div>
  );
};

/**
 * Pool filters. Narrow containers keep the faction and row filters in view and fold the
 * rest behind a "Filters" toggle with its active count; every active filter is listed in
 * words under the bar, with a reset.
 */
const FilterBar = ({
  filters,
  onChange,
  faction,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  faction: DeckFaction | null;
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreId = useId();
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    onChange({ ...filters, [key]: value });
  const active = activeFilterLabels(filters);
  const foldedActive = [
    filters.rarity !== "ALL",
    filters.keyword !== "ALL",
    filters.provision !== "ALL",
    filters.ownedOnly,
  ].filter(Boolean).length;
  return (
    <div className="kh-filterbar">
      <fieldset className="kh-filters">
        <legend className="sr-only">Filters</legend>
        <Select
          value={filters.faction}
          onValueChange={(value) => set("faction", value as Filters["faction"])}
        >
          <SelectTrigger
            aria-label="Faction"
            className="kh-filter-select kh-filter-faction w-auto min-w-[150px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="kessen-ui kh-builder-listbox">
            <SelectItem value="DECK" className="kh-builder-option">
              {faction ? `${KESSEN_FACTION_NAMES[faction]} + Neutral` : "Deck factions"}
            </SelectItem>
            <SelectItem value="ALL" className="kh-builder-option">
              All factions
            </SelectItem>
            {[...KESSEN_DECK_FACTIONS, "NEUTRAL" as const].map((option) => (
              <SelectItem key={option} value={option} className="kh-builder-option">
                {KESSEN_FACTION_NAMES[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <fieldset className="flex min-w-0 flex-wrap gap-[4px]">
          <legend className="sr-only">Row</legend>
          {ROW_FILTERS.map((row) => (
            <ToggleChip
              key={row}
              pressed={filters.row === row}
              label={ROW_FILTER_LABELS[row]}
              onClick={() => set("row", filters.row === row ? "ALL" : row)}
            >
              {row === "TACTIC" ? <TacticGlyph /> : <RowGlyph row={row} decorative />}
            </ToggleChip>
          ))}
        </fieldset>
        <Button
          type="button"
          variant={moreOpen ? "secondary" : "outline"}
          size="sm"
          className="kh-filters-toggle"
          aria-expanded={moreOpen}
          aria-controls={moreId}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <SlidersHorizontal className="mr-1 h-[14px] w-[14px]" aria-hidden />
          Filters{foldedActive > 0 ? ` · ${foldedActive}` : ""}
        </Button>
        <div
          id={moreId}
          className="kh-filters-more"
          data-open={moreOpen ? "" : undefined}
        >
          <fieldset className="flex min-w-0 flex-wrap gap-[4px]">
            <legend className="sr-only">Rarity</legend>
            {RARITY_FILTERS.map((tier) => (
              <ToggleChip
                key={tier}
                pressed={filters.rarity === tier}
                label={KESSEN_RARITY_LABELS[tier]}
                onClick={() => set("rarity", filters.rarity === tier ? "ALL" : tier)}
              >
                <RarityGem tier={tier} decorative size={14} />
              </ToggleChip>
            ))}
          </fieldset>
          <Select
            value={filters.keyword}
            onValueChange={(value) => set("keyword", value)}
          >
            <SelectTrigger aria-label="Keyword" className="kh-filter-select w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="kessen-ui kh-builder-listbox">
              <SelectItem value="ALL" className="kh-builder-option">
                Any keyword
              </SelectItem>
              {KESSEN_KEYWORDS.map((keyword) => (
                <SelectItem key={keyword} value={keyword} className="kh-builder-option">
                  {keyword}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.provision}
            onValueChange={(value) => set("provision", value as Filters["provision"])}
          >
            <SelectTrigger aria-label="Provision" className="kh-filter-select w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="kessen-ui kh-builder-listbox">
              {PROVISION_FILTERS.map((option) => (
                <SelectItem key={option} value={option} className="kh-builder-option">
                  {PROVISION_FILTER_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="kh-owned-only">
            <Checkbox
              id={`${moreId}-owned`}
              checked={filters.ownedOnly}
              onCheckedChange={(checked) => set("ownedOnly", checked === true)}
            />
            <Label htmlFor={`${moreId}-owned`} className="text-[13px] font-medium">
              Owned only
            </Label>
          </div>
        </div>
      </fieldset>
      {active.length > 0 ? (
        <p className="kh-filter-summary">
          <span>
            <span className="sr-only">Active filters: </span>
            {active.join(" · ")}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(DEFAULT_FILTERS)}
          >
            <X className="mr-1 h-[13px] w-[13px]" aria-hidden />
            Clear filters
          </Button>
        </p>
      ) : null}
    </div>
  );
};

/** A filter toggle that shows a glyph and names it for assistive technology. */
const ToggleChip = ({
  pressed,
  label,
  onClick,
  children,
}: {
  pressed: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) => (
  <Button
    type="button"
    variant="outline"
    size="icon"
    className="kh-filter-chip"
    aria-pressed={pressed}
    aria-label={label}
    title={label}
    onClick={onClick}
  >
    {children}
  </Button>
);

/**
 * A copy stepper button. `softDisabled` keeps it focusable and pressable, so a tap can
 * say why it does nothing; `disabled` takes it out entirely.
 */
const StepButton = ({
  label,
  onClick,
  disabled = false,
  softDisabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  softDisabled?: boolean;
  children: ReactNode;
}) => (
  <Button
    type="button"
    variant="outline"
    size="icon"
    className={cn("kh-step", softDisabled && "opacity-40")}
    disabled={disabled}
    aria-disabled={softDisabled ? true : undefined}
    onClick={onClick}
    aria-label={label}
    data-button-sfx="off"
  >
    {children}
  </Button>
);

/** A deck counter, in vermilion when it breaks a rule. */
const Counter = ({ bad, children }: { bad: boolean; children: ReactNode }) => (
  <span data-bad={bad ? "" : undefined}>{children}</span>
);

/** The unsaved-changes dot; named when it stands alone. */
const DirtyDot = ({ label }: { label?: string }) => (
  <span
    className="kh-dirty-dot"
    {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
  />
);

/** Active filters in words, for the summary under the bar. */
const activeFilterLabels = (filters: Filters) => {
  const labels: string[] = [];
  if (filters.faction === "ALL") labels.push("All factions");
  else if (filters.faction !== "DECK")
    labels.push(KESSEN_FACTION_NAMES[filters.faction]);
  if (filters.rarity !== "ALL") labels.push(KESSEN_RARITY_LABELS[filters.rarity]);
  if (filters.row !== "ALL") labels.push(ROW_FILTER_LABELS[filters.row]);
  if (filters.keyword !== "ALL") labels.push(filters.keyword);
  if (filters.provision !== "ALL")
    labels.push(PROVISION_FILTER_LABELS[filters.provision]);
  if (filters.ownedOnly) labels.push("Owned only");
  return labels;
};

/** Units per row and tactics as one stacked bar. */
const RowSplit = ({ rows }: { rows: Record<RowBucket, number> }) => {
  const total = Object.values(rows).reduce((sum, value) => sum + value, 0);
  return (
    <div className="kh-split">
      <div className="kh-split-bar" aria-hidden>
        {ROW_BUCKETS.map((bucket) =>
          rows[bucket] > 0 ? (
            <span
              key={bucket}
              className="kh-split-seg"
              data-row={bucket}
              style={{ flexGrow: rows[bucket] }}
            />
          ) : null,
        )}
        {total === 0 ? (
          <span className="kh-split-seg" data-row="EMPTY" style={{ flexGrow: 1 }} />
        ) : null}
      </div>
      <ul className="kh-split-legend text-muted-foreground">
        {ROW_BUCKETS.map((bucket) => (
          <li key={bucket} data-row={bucket}>
            {bucket === "TACTIC" ? (
              <TacticGlyph />
            ) : (
              <RowGlyph row={bucket} decorative />
            )}
            <span>
              {BUCKET_LABELS[bucket]} {rows[bucket]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * Side by side, each column is one screen tall; opening the builder scrolls it to the top
 * of the screen so the deck panel and its Save bar show whole.
 */
const useScrollIntoViewWhenWide = (ref: RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const element = ref.current;
    if (
      !element ||
      element.getBoundingClientRect().width < SIDE_BY_SIDE_WIDTH ||
      window.innerHeight < SIDE_BY_SIDE_MIN_HEIGHT
    )
      return;
    const { top } = element.getBoundingClientRect();
    if (top > 24 || top < -24) element.scrollIntoView({ block: "start" });
  }, [ref]);
};

/**
 * Whether the builder sits in a dialog. A dialog scrolls itself and its translate makes it
 * the containing block of fixed elements, so the tabs layout pins its bars with sticky
 * positioning there instead of fixing them to the viewport.
 */
const useInDialog = (ref: RefObject<HTMLElement | null>) => {
  const [inDialog, setInDialog] = useState(false);
  useLayoutEffect(() => {
    setInDialog(Boolean(ref.current?.closest('[role="dialog"]')));
  }, [ref]);
  return inDialog;
};

/** Keep in step with `@container kh-builder (min-width: 620px)` in hub.css. */
const SIDE_BY_SIDE_WIDTH = 620;
/** Keep in step with `@media (min-height: 521px)` around the side-by-side layout. */
const SIDE_BY_SIDE_MIN_HEIGHT = 521;

const NO_LISTINGS: Readonly<Record<string, number>> = {};

const FOCUSABLE =
  "button:not([disabled]), select:not([disabled]), input:not([disabled])";

const draftOf = (deck: KessenDeckRow): Draft => ({
  id: deck.id,
  name: deck.name,
  leaderId: deck.leaderItemId,
  counts: countsOf(deck.cards),
  borrowed: {},
});

const newDraft = (
  faction: DeckFaction,
  owned: Readonly<Record<string, number>>,
  existing: number,
): Draft => {
  const leaderId =
    [KESSEN_STARTER_LEADERS[faction], KESSEN_ALT_LEADERS[faction]].find(
      (id) => (owned[id] ?? 0) > 0,
    ) ?? KESSEN_STARTER_LEADERS[faction];
  return {
    id: null,
    name: `${KESSEN_FACTION_NAMES[faction]} deck ${existing + 1}`,
    leaderId,
    counts: {},
    borrowed: {},
  };
};

const countsOf = (entries: readonly KessenDeckCard[]) => {
  const counts: Record<string, number> = {};
  for (const entry of entries)
    counts[entry.itemId] = (counts[entry.itemId] ?? 0) + entry.count;
  return counts;
};

const toDeckCards = (counts: Readonly<Record<string, number>>) =>
  normalizeDeckCards(
    Object.entries(counts).map(([itemId, count]) => ({ itemId, count })),
  );

/** Copies in `counts` beyond those in `minus`. */
const subtractCounts = (
  counts: Readonly<Record<string, number>>,
  minus: Readonly<Record<string, number>>,
) => {
  const out: Record<string, number> = {};
  for (const [id, count] of Object.entries(counts)) out[id] = count - (minus[id] ?? 0);
  return prune(out);
};

const prune = (counts: Record<string, number>) => {
  const out: Record<string, number> = {};
  for (const [id, count] of Object.entries(counts)) if (count > 0) out[id] = count;
  return out;
};

const factionOrder = (faction: KessenFaction) =>
  faction === "NEUTRAL" ? 99 : KESSEN_DECK_FACTIONS.indexOf(faction);

const matchesFilters = (
  card: KessenCatalogEntry,
  filters: Filters,
  faction: DeckFaction | null,
  /** Copies held per item id, listed ones included. */
  heldOf: (id: string) => number,
) => {
  if (filters.faction === "DECK") {
    if (faction && card.faction !== faction && card.faction !== "NEUTRAL") return false;
  } else if (filters.faction !== "ALL" && card.faction !== filters.faction)
    return false;
  if (filters.rarity !== "ALL" && kessenRarityTier(card) !== filters.rarity)
    return false;
  if (filters.row !== "ALL") {
    if (filters.row === "TACTIC" ? card.kind !== "TACTIC" : card.row !== filters.row)
      return false;
  }
  if (
    filters.keyword !== "ALL" &&
    !cardKeywords(card.abilities).some((keyword) => keyword === filters.keyword)
  )
    return false;
  if (filters.provision === "LOW" && card.provision > 4) return false;
  if (filters.provision === "MID" && (card.provision < 5 || card.provision > 7))
    return false;
  if (filters.provision === "HIGH" && card.provision < 8) return false;
  if (filters.ownedOnly && heldOf(card.id) < 1) return false;
  if (card.variant === "FORBIDDEN" && heldOf(card.id) < 1) return false;
  return true;
};

const rowSplit = (listed: { entry: KessenDeckCard; card: KessenCatalogEntry }[]) => {
  const rows: Record<RowBucket, number> = {
    CLOSE: 0,
    RANGED: 0,
    JUTSU: 0,
    ANY: 0,
    TACTIC: 0,
  };
  for (const { entry, card } of listed) {
    if (card.kind === "TACTIC") rows.TACTIC += entry.count;
    else if (card.row) rows[card.row] += entry.count;
  }
  return rows;
};

/** Validation lines, with a concrete fix for an over-budget deck. */
const validationMessages = (
  errors: ReturnType<typeof validateDeck>["errors"],
  listed: { entry: KessenDeckCard; card: KessenCatalogEntry }[],
  over: number,
) => {
  const lines: string[] = [];
  for (const error of errors) {
    if (error.code === "budget" && over > 0) {
      const exact = listed.find(({ card }) => card.provision === over);
      const cheapest = [...listed]
        .filter(({ card }) => card.provision >= over)
        .sort((a, b) => a.card.provision - b.card.provision)[0];
      lines.push(
        exact
          ? `Over budget by ${over}: remove ${exact.card.name} (${over}) or another card worth ${over}+ provision.`
          : cheapest
            ? `Over budget by ${over}: remove a card worth ${over}+ provision (cheapest: ${cheapest.card.name}, ${cheapest.card.provision}).`
            : `Over budget by ${over}: remove cards worth ${over} provision in total.`,
      );
      continue;
    }
    if (error.code === "size") {
      const size = deckSize(listed.map(({ entry }) => entry));
      lines.push(
        size < KESSEN_DECK_RULES.minCards
          ? `Add ${KESSEN_DECK_RULES.minCards - size} more ${KESSEN_DECK_RULES.minCards - size === 1 ? "card" : "cards"} (a deck holds ${KESSEN_DECK_RULES.minCards}–${KESSEN_DECK_RULES.maxCards}).`
          : `Remove ${size - KESSEN_DECK_RULES.maxCards} cards (a deck holds at most ${KESSEN_DECK_RULES.maxCards}).`,
      );
      continue;
    }
    lines.push(error.message);
  }
  return [...new Set(lines)];
};

/** The first rule the owned part of the deck breaks beyond size and ownership. */
const savedBlockingMessage = (
  result: ReturnType<typeof validateDeck>,
  ownedCards: readonly KessenDeckCard[],
  lookup: Readonly<Record<string, KessenCatalogEntry>>,
) => {
  const errors = result.errors.filter(
    (error) => error.code !== "size" && error.code !== "notOwned",
  );
  const listed = ownedCards.flatMap((entry) => {
    const card = lookup[entry.itemId];
    return card ? [{ entry, card }] : [];
  });
  const over =
    result.stats.budget > 0 ? result.stats.provision - result.stats.budget : 0;
  return validationMessages(errors, listed, over)[0] ?? null;
};

/** Why Save is disabled, shown next to it; null when it can save. */
const saveBlockReason = (state: {
  pending: boolean;
  isNew: boolean;
  atDeckCap: boolean;
  named: boolean;
  ownedSize: number;
  hasBorrowed: boolean;
  savable: boolean;
  dirty: boolean;
  blocking: string | null;
}) => {
  if (state.pending) return null;
  if (state.isNew && state.atDeckCap)
    return `You have ${KESSEN_MAX_DECKS} decks. Delete one to save another.`;
  if (!state.named) return "Name the deck to save it.";
  if (state.ownedSize === 0)
    return state.hasBorrowed
      ? "Only borrowed copies so far: add cards you own, or Auto-build, to save this deck."
      : "Add at least one card you own, or Auto-build, to save this deck.";
  if (!state.savable)
    return `${state.hasBorrowed ? "Borrowed copies are not saved. " : ""}To save: ${lowerFirst(state.blocking ?? "fix the deck rules above.")}`;
  if (!state.isNew && !state.dirty) return "No unsaved changes.";
  return null;
};

/** Deck size against the 25-30 rule: the gap while short, a cap marker at the top. */
const deckSizeText = (cards: number) => {
  const { minCards, maxCards } = KESSEN_DECK_RULES;
  if (cards < minCards) return `${cards}/${minCards} cards`;
  if (cards < maxCards) return `${cards} cards`;
  if (cards === maxCards) return `${cards}/${maxCards} cards (max)`;
  return `${cards}/${maxCards} cards, over the max`;
};

/** Deck size on the tab: always against the next limit, so its width stays put. */
const deckSizeShort = (cards: number) =>
  `${cards}/${cards < KESSEN_DECK_RULES.minCards ? KESSEN_DECK_RULES.minCards : KESSEN_DECK_RULES.maxCards}`;

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Whether two card lists hold the same copies. */
const sameCards = (a: readonly KessenDeckCard[], b: readonly KessenDeckCard[]) =>
  JSON.stringify(normalizeDeckCards(a)) === JSON.stringify(normalizeDeckCards(b));

/** Fingerprint of a saved deck, so a stored draft is dropped once the deck changed. */
const deckPrint = (deck: KessenDeckRow) =>
  JSON.stringify([deck.name, deck.leaderItemId, normalizeDeckCards(deck.cards)]);

const draftStorageKey = (userId: string) => `kessen:deck-draft:${userId}`;

type StoredDraft = { draft: Draft; base: string | null };

/**
 * The draft the builder opens with. Unsaved edits kept for this session come first, so
 * opening the builder never drops them; when they belong to another deck than the one
 * asked for, the discard prompt offers that deck. Without kept edits it opens the deck
 * asked for, else the first saved deck, else a new draft.
 */
const openingDraft = (input: {
  userId: string;
  initialDeckId: string | null | undefined;
  decks: readonly KessenDeckRow[];
  defaultFaction: DeckFaction;
  owned: Readonly<Record<string, number>>;
}): { draft: Draft; pendingSwitch: { deck: KessenDeckRow | null } | null } => {
  const { initialDeckId, decks } = input;
  const requested = initialDeckId
    ? (decks.find((deck) => deck.id === initialDeckId) ?? null)
    : null;
  const kept = restoreDraft(input.userId, decks);
  if (kept) {
    const other = requested !== null && kept.id !== requested.id;
    return { draft: kept, pendingSwitch: other ? { deck: requested } : null };
  }
  const deck = requested ?? decks[0] ?? null;
  return {
    draft: deck
      ? draftOf(deck)
      : newDraft(input.defaultFaction, input.owned, decks.length),
    pendingSwitch: null,
  };
};

/**
 * The unsaved draft kept for this session, when it still fits: its deck exists unchanged,
 * or it is a new deck.
 */
const restoreDraft = (
  userId: string,
  decks: readonly KessenDeckRow[],
): Draft | null => {
  let stored: StoredDraft | null = null;
  try {
    const raw = window.sessionStorage.getItem(draftStorageKey(userId));
    stored = raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    return null;
  }
  if (!stored?.draft) return null;
  const { draft, base } = stored;
  if (draft.id === null) return draft;
  const deck = decks.find((candidate) => candidate.id === draft.id);
  return deck && deckPrint(deck) === base ? draft : null;
};

const writeStoredDraft = (userId: string, stored: StoredDraft | null) => {
  try {
    const key = draftStorageKey(userId);
    if (stored) window.sessionStorage.setItem(key, JSON.stringify(stored));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage blocked: unsaved edits then last only while the builder stays open.
  }
};

type RowBucket = "CLOSE" | "RANGED" | "JUTSU" | "ANY" | "TACTIC";
const ROW_BUCKETS: readonly RowBucket[] = ["CLOSE", "RANGED", "JUTSU", "ANY", "TACTIC"];
const BUCKET_LABELS: Record<RowBucket, string> = {
  CLOSE: ROW_LABELS.CLOSE,
  RANGED: ROW_LABELS.RANGED,
  JUTSU: ROW_LABELS.JUTSU,
  ANY: "Any",
  TACTIC: "Tactics",
};
const ROW_FILTERS: readonly RowBucket[] = ROW_BUCKETS;
const ROW_FILTER_LABELS: Record<RowBucket, string> = {
  CLOSE: ROW_LABELS.CLOSE,
  RANGED: ROW_LABELS.RANGED,
  JUTSU: ROW_LABELS.JUTSU,
  ANY: "Any row",
  TACTIC: "Tactics",
};
const PROVISION_FILTERS = ["ALL", "LOW", "MID", "HIGH"] as const;
const PROVISION_FILTER_LABELS: Record<(typeof PROVISION_FILTERS)[number], string> = {
  ALL: "Any provision",
  LOW: "Provision 0–4",
  MID: "Provision 5–7",
  HIGH: "Provision 8+",
};
const RARITY_FILTERS: readonly KessenRarityTier[] = [
  "COMMON",
  "RARE",
  "EPIC",
  "LEGENDARY",
  "FORBIDDEN",
];

type Filters = {
  faction: "DECK" | "ALL" | KessenFaction;
  rarity: "ALL" | KessenRarityTier;
  row: "ALL" | RowBucket;
  keyword: string;
  provision: "ALL" | "LOW" | "MID" | "HIGH";
  ownedOnly: boolean;
};
const DEFAULT_FILTERS: Filters = {
  faction: "DECK",
  rarity: "ALL",
  row: "ALL",
  keyword: "ALL",
  provision: "ALL",
  ownedOnly: false,
};

type Draft = {
  /** Saved deck id; null for a new deck. */
  id: string | null;
  name: string;
  leaderId: string;
  counts: Record<string, number>;
  /** Copies lent by Fill with borrowed (part of `counts`). */
  borrowed: Record<string, number>;
};
