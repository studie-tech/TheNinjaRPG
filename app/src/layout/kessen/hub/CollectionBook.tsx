"use client";

import "../kessen.css";
import "./hub.css";
import "./builder.css";
import { Check, ChevronDown, Lock, MapPin, X } from "lucide-react";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import {
  cardKeywords,
  KESSEN_GLOSSARY,
  KESSEN_KEYWORDS,
  type KessenKeyword,
} from "@/libs/kessen/text";
import { cn } from "@/libs/shadui";
import type { KessenFaction } from "@/validators/itemCard";
import type { KessenCatalogEntry } from "@/validators/kessen";
import { CardFace } from "../CardFace";
import { FactionSigil } from "../FactionSigil";
import { WaxSealGlyph } from "../glyphs";
import {
  copyLimitOf,
  KESSEN_BOOK_FACTIONS,
  KESSEN_FACTION_INFO,
  type KessenFindContext,
  whereToFind,
} from "./hubData";

/**
 * The collection as an ink bingo book: one page per faction behind a
 * completion ring, owned cards with copy pips, unowned cards as silhouettes with where to
 * find them (a popover, one open at a time). Copies listed in the auction house are still
 * owned: they count for the book and carry a "Listed" tag. Keyword chips stay greyed
 * until the keyword was seen in a match; tapping one shows its glossary line and lists
 * every card with it. The Forbidden shelf below keeps a locked niche for every variant
 * not yet owned; an owned variant repeats its epithet under the card only while the face
 * cuts its name short. Cards first held since the viewer last opened their page carry the NEW
 * ribbon, and each faction tab counts them until that page is viewed (remembered per
 * viewer in this browser). The faction tabs are the game's tabs (one tab stop; the arrow
 * keys, Home and End move between them). Narrow books fold the keyword chips behind a
 * toggle that counts the keywords met, and fit all seven faction tabs on one row as
 * sigils with their counts (each tab keeps its full name for assistive technology), so
 * the first cards show in the first screen.
 */
export const CollectionBook = ({
  cards,
  owned,
  listed = NO_LISTINGS,
  seenKeywords,
  findContext,
  initialFaction,
  onInspect,
  viewerId,
  className,
}: {
  cards: readonly KessenCatalogEntry[];
  /** Copies free for decks per item id (auction listings excluded). */
  owned: Readonly<Record<string, number>>;
  /** Copies listed in the auction house per item id. */
  listed?: Readonly<Record<string, number>>;
  seenKeywords: readonly string[];
  findContext: KessenFindContext;
  initialFaction?: KessenFaction | null;
  /** Opens a card in an inspect view. */
  onInspect?: (card: KessenCatalogEntry) => void;
  /** Keys the browser's record of the cards this viewer has seen. */
  viewerId?: string;
  className?: string;
}) => {
  const [faction, setFaction] = useState<KessenFaction>(initialFaction ?? "SHIROHANA");
  const [keyword, setKeyword] = useState<KessenKeyword | null>(null);
  /** Cards first held since the last visit; they keep the ribbon for this visit. */
  const [fresh, setFresh] = useState<ReadonlySet<string>>(NO_IDS);
  /** Pages viewed on this visit, whose tab counts are cleared. */
  const [viewedPages, setViewedPages] = useState<ReadonlySet<string>>(NO_IDS);
  /** The card whose sources are open; one at a time. */
  const [findOpen, setFindOpen] = useState<string | null>(null);
  /** Whether narrow books show the keyword chips, folded behind their toggle. */
  const [keywordsOpen, setKeywordsOpen] = useState(false);
  const keywordsId = useId();
  const shelfRef = useRef<HTMLUListElement>(null);
  const seen = new Set(seenKeywords);
  const collectible = cards.filter(
    (card) => card.isCollectible && card.variant === "STANDARD",
  );
  const held = (id: string) => (owned[id] ?? 0) + (listed[id] ?? 0);
  const isOwned = (card: KessenCatalogEntry) => held(card.id) > 0;
  // Owned variants lead the shelf, empty niches follow.
  const forbidden = cards
    .filter((card) => card.variant === "FORBIDDEN")
    .sort(
      (a, b) => Number(isOwned(b)) - Number(isOwned(a)) || a.name.localeCompare(b.name),
    );
  const progress = (book: KessenFaction) => {
    const page = collectible.filter((card) => card.faction === book);
    return { owned: page.filter(isOwned).length, total: page.length };
  };
  const totals = {
    owned: collectible.filter(isOwned).length,
    total: collectible.length,
  };

  const pageCards = keyword
    ? collectible.filter((card) => cardKeywords(card.abilities).includes(keyword))
    : collectible.filter((card) => card.faction === faction);
  const leaders = pageCards.filter((card) => card.kind === "LEADER");
  const deckCards = pageCards
    .filter((card) => card.kind !== "LEADER")
    .sort(byBookNumber);
  const info = KESSEN_FACTION_INFO[faction];
  const pageProgress = progress(faction);
  const heldIds = cards.filter(isOwned).map((card) => card.id);
  const shelfKey = forbidden
    .filter(isOwned)
    .map((card) => card.id)
    .join(",");
  const seenKey = seenStorageKey(viewerId);
  const pageKey = keyword ? null : faction;
  const freshOn = (book: KessenFaction) =>
    viewedPages.has(book)
      ? 0
      : collectible.filter((card) => card.faction === book && fresh.has(card.id))
          .length;

  const openPage = (book: KessenFaction) => {
    setFaction(book);
    setKeyword(null);
  };
  // Once per visit: which held cards are new since the last one. A first visit records
  // the collection as seen, so it does not mark every card.
  useEffect(() => {
    const seen = readSeenCards(seenKey);
    if (seen === null) writeSeenCards(seenKey, heldIds);
    else setFresh(new Set(heldIds.filter((id) => !seen.has(id))));
  }, [seenKey]);

  // An epithet caption shows only under a face whose clamped name hides it.
  useEffect(() => {
    const shelf = shelfRef.current;
    if (!shelf || !shelfKey) return;
    const measure = () => {
      for (const niche of shelf.querySelectorAll<HTMLElement>(
        ".kh-niche[data-filled]",
      )) {
        const name = niche.querySelector<HTMLElement>(".kc-name");
        niche.toggleAttribute(
          "data-name-clipped",
          Boolean(name && name.scrollHeight > name.clientHeight + 1),
        );
      }
    };
    measure();
    void document.fonts?.ready.then(measure);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(shelf);
    return () => observer.disconnect();
  }, [shelfKey]);

  // Viewing a page (and the always-open Forbidden shelf) records its cards as seen.
  useEffect(() => {
    if (fresh.size === 0) return;
    const shown = cards.filter(
      (card) =>
        isOwned(card) &&
        (card.variant === "FORBIDDEN" ||
          (pageKey !== null && card.faction === pageKey)),
    );
    const seen = readSeenCards(seenKey);
    if (seen) writeSeenCards(seenKey, [...seen, ...shown.map((card) => card.id)]);
    if (pageKey && !viewedPages.has(pageKey))
      setViewedPages((pages) => new Set([...pages, pageKey]));
  }, [pageKey, fresh, seenKey]);

  const pageValue = keyword ? KEYWORD_PAGE : faction;

  return (
    <section
      className={cn("kh-book text-card-foreground flex flex-col gap-3", className)}
      aria-label="Collection"
    >
      <header className="kh-book-head">
        <div>
          <p className="kh-book-eyebrow">Collection</p>
          <h2 className="kh-book-title">The Bingo Book</h2>
        </div>
        <p className="kh-book-total">
          <span className="kh-book-total-n">{totals.owned}</span>
          <span> / {totals.total} collected</span>
        </p>
      </header>

      <Button
        type="button"
        variant="outline"
        className="kh-kw-toggle"
        aria-expanded={keywordsOpen}
        aria-controls={keywordsId}
        onClick={() => setKeywordsOpen((open) => !open)}
      >
        <span>Keywords</span>
        <span className="kh-kw-toggle-count">
          {KESSEN_KEYWORDS.filter((entry) => seen.has(entry)).length}/
          {KESSEN_KEYWORDS.length} met
        </span>
        <ChevronDown className="kh-kw-toggle-icon" aria-hidden />
      </Button>
      <fieldset
        id={keywordsId}
        className="kh-kwchips"
        data-open={keywordsOpen ? "" : undefined}
      >
        <legend className="sr-only">Keywords</legend>
        {KESSEN_KEYWORDS.map((entry) => {
          const isSeen = seen.has(entry);
          const pressed = keyword === entry;
          return (
            <Button
              key={entry}
              type="button"
              size="sm"
              variant="outline"
              className="kh-kwchip"
              data-seen={isSeen ? "" : undefined}
              aria-pressed={pressed}
              title={isSeen ? KESSEN_GLOSSARY[entry] : "Not seen in a match yet"}
              onClick={() => setKeyword(pressed ? null : entry)}
            >
              {pressed ? (
                <Check className="mr-1 h-[12px] w-[12px] shrink-0" aria-hidden />
              ) : null}
              {entry}
            </Button>
          );
        })}
      </fieldset>
      {keyword ? (
        <div className="kh-kwline" role="status">
          <p>
            <span className="kh-kwline-term">{keyword}</span>:{" "}
            {KESSEN_GLOSSARY[keyword]}
            {seen.has(keyword) ? null : (
              <span className="kh-kwline-unseen">
                {" "}
                You have not met it in a match yet.
              </span>
            )}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="kh-kwline-close"
            aria-label="Clear keyword filter"
            onClick={() => setKeyword(null)}
          >
            <X className="h-[14px] w-[14px]" aria-hidden />
          </Button>
        </div>
      ) : null}

      <Tabs
        value={pageValue}
        onValueChange={(value) => {
          if (value !== KEYWORD_PAGE) openPage(value as KessenFaction);
        }}
      >
        <TabsList className="kh-book-tabs" aria-label="Factions">
          {KESSEN_BOOK_FACTIONS.map((book) => {
            const { owned: have, total } = progress(book);
            const percent = total > 0 ? Math.round((have / total) * 100) : 0;
            const newCount = freshOn(book);
            return (
              <TabsTrigger
                key={book}
                value={book}
                className="kh-book-tab"
                aria-label={`${KESSEN_FACTION_NAMES[book]}: ${have} of ${total} collected${newCount > 0 ? `, ${newCount} new` : ""}`}
              >
                <CompletionRing percent={percent} />
                <FactionSigil
                  faction={book}
                  renderSize={36}
                  className="kh-book-tab-sigil w-[34px]"
                  decorative
                />
                <span className="kh-book-tab-name">{KESSEN_FACTION_NAMES[book]}</span>
                {/* New cards sit beside the count, clear of the completion ring. */}
                <span className="kh-book-tab-count">
                  {have}/{total}
                  {newCount > 0 ? (
                    <Badge
                      variant="destructive"
                      className="kh-book-tab-new"
                      title={`${newCount} new`}
                      aria-hidden
                    >
                      +{newCount}
                    </Badge>
                  ) : null}
                </span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent
          value={pageValue}
          className="kh-page"
          aria-label={keyword ?? KESSEN_FACTION_NAMES[faction]}
        >
          <div className="kh-page-head">
            {keyword ? (
              <h3 className="kh-page-title">
                Cards with <span className="kessen-kw">{keyword}</span>
              </h3>
            ) : (
              <>
                <FactionSigil faction={faction} renderSize={48} className="w-[44px]" />
                <div className="min-w-0 flex-1">
                  <h3 className="kh-page-title">{KESSEN_FACTION_NAMES[faction]}</h3>
                  <p className="kh-page-sub">
                    {info.region}
                    {info.perk ? ` · ${info.perk}` : ""}
                  </p>
                </div>
                <p className="kh-page-count">
                  {pageProgress.owned}/{pageProgress.total}
                </p>
              </>
            )}
          </div>

          {leaders.length > 0 ? (
            <>
              <h4 className="kh-page-h4">Leaders</h4>
              <ul className="kh-book-grid">
                {leaders.map((card) => (
                  <BookCard
                    key={card.id}
                    card={card}
                    owned={held(card.id)}
                    listed={listed[card.id] ?? 0}
                    isNew={fresh.has(card.id)}
                    findContext={findContext}
                    findOpen={findOpen === card.id}
                    onFindOpenChange={(open) => setFindOpen(open ? card.id : null)}
                    onInspect={onInspect}
                  />
                ))}
              </ul>
            </>
          ) : null}
          <h4 className="kh-page-h4">{keyword ? "Cards" : "Deck cards"}</h4>
          <ul className="kh-book-grid">
            {deckCards.map((card) => (
              <BookCard
                key={card.id}
                card={card}
                owned={held(card.id)}
                listed={listed[card.id] ?? 0}
                isNew={fresh.has(card.id)}
                findContext={findContext}
                findOpen={findOpen === card.id}
                onFindOpenChange={(open) => setFindOpen(open ? card.id : null)}
                onInspect={onInspect}
              />
            ))}
          </ul>
        </TabsContent>
      </Tabs>

      <section className="kh-shelf" aria-label="Forbidden shelf">
        <div className="kh-shelf-head">
          <h3 className="kh-shelf-title">The Forbidden shelf</h3>
          <span className="kh-shelf-count">
            {forbidden.filter(isOwned).length}/{forbidden.length}
          </span>
        </div>
        <ul ref={shelfRef} className="kh-shelf-row">
          {forbidden.map((card) =>
            isOwned(card) ? (
              <li key={card.id} className="kh-niche" data-filled>
                <InspectWrap card={card} onInspect={onInspect}>
                  <CardFace
                    card={card}
                    renderSize={170}
                    isNew={fresh.has(card.id)}
                    aria-hidden
                  />
                </InspectWrap>
                {forbiddenEpithet(card.name) ? (
                  <span className="kh-niche-epithet" aria-hidden>
                    {forbiddenEpithet(card.name)}
                  </span>
                ) : null}
              </li>
            ) : (
              <li
                key={card.id}
                className="kh-niche"
                aria-label="Locked niche: a Forbidden card not yet owned"
              >
                <span className="kh-niche-empty" aria-hidden>
                  <span className="kh-niche-lock">
                    <WaxSealGlyph />
                    <Lock className="kh-niche-lock-icon" />
                  </span>
                  <span className="kh-niche-label">Locked</span>
                </span>
              </li>
            ),
          )}
        </ul>
      </section>
    </section>
  );
};

/**
 * One card of the book: the face with copy pips (listed copies included), or a silhouette
 * with its sources.
 */
const BookCard = ({
  card,
  owned,
  listed,
  isNew,
  findContext,
  findOpen,
  onFindOpenChange,
  onInspect,
}: {
  card: KessenCatalogEntry;
  /** Every owned copy, listed ones included. */
  owned: number;
  listed: number;
  /** First held since the viewer's last visit. */
  isNew: boolean;
  findContext: KessenFindContext;
  findOpen: boolean;
  onFindOpenChange: (open: boolean) => void;
  onInspect?: (card: KessenCatalogEntry) => void;
}) => {
  const limit = card.kind === "LEADER" ? 1 : copyLimitOf(card);
  if (owned > 0) {
    // Surplus counts sellable copies only: listed copies show in their own tag.
    const surplus = Math.max(0, owned - listed - limit);
    return (
      <li className="kh-book-card" data-owned>
        <InspectWrap card={card} onInspect={onInspect}>
          <CardFace
            card={card}
            renderSize={160}
            isNew={isNew}
            copies={
              card.kind === "LEADER"
                ? undefined
                : { owned: Math.min(owned, limit), max: limit }
            }
            aria-hidden
          />
        </InspectWrap>
        {listed > 0 || surplus > 0 ? (
          <span className="kh-book-stamps">
            {listed > 0 ? (
              <Badge
                variant="outline"
                className="kh-book-stamp"
                data-listed
                title="Listed in the auction house"
              >
                Listed{listed > 1 ? ` ×${listed}` : ""}
              </Badge>
            ) : null}
            {surplus > 0 ? (
              <Badge variant="outline" className="kh-book-stamp">
                +{surplus} surplus
              </Badge>
            ) : null}
          </span>
        ) : null}
      </li>
    );
  }
  const sources = whereToFind(card, findContext);
  return (
    <li className="kh-book-card" data-missing>
      <InspectWrap card={card} onInspect={onInspect}>
        <span className="kh-silhouette">
          <CardFace card={card} renderSize={160} disabled aria-hidden />
        </span>
      </InspectWrap>
      <Popover open={findOpen} onOpenChange={onFindOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="kh-book-find"
            aria-label={`Where to find ${card.name}`}
          >
            <MapPin className="mr-1 h-[12px] w-[12px] shrink-0" aria-hidden />
            Where to find
          </Button>
        </PopoverTrigger>
        <PopoverContent className="kessen-ui kh-book-find-pop" collisionPadding={12}>
          <p className="kh-book-find-title">{card.name}</p>
          {sources.length > 0 ? (
            <ul>
              {sources.map((source) => (
                <li key={source}>{source}</li>
              ))}
            </ul>
          ) : (
            <p className="kh-book-find-none">No source is open right now.</p>
          )}
        </PopoverContent>
      </Popover>
    </li>
  );
};

const InspectWrap = ({
  card,
  onInspect,
  children,
}: {
  card: KessenCatalogEntry;
  onInspect?: (card: KessenCatalogEntry) => void;
  children: React.ReactNode;
}) =>
  onInspect ? (
    <button
      type="button"
      className="kh-book-inspect"
      onClick={() => onInspect(card)}
      aria-label={`Inspect ${card.name}`}
      data-button-sfx="off"
    >
      {children}
    </button>
  ) : (
    <div className="kh-book-inspect" role="img" aria-label={card.name}>
      {children}
    </div>
  );

/** Completion ring of a faction page. */
const CompletionRing = ({ percent }: { percent: number }) => {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className="kh-ring" viewBox="0 0 60 60" aria-hidden>
      <circle className="kh-ring-track" cx="30" cy="30" r={radius} />
      <circle
        className="kh-ring-fill"
        cx="30"
        cy="30"
        r={radius}
        strokeDasharray={`${(circumference * percent) / 100} ${circumference}`}
        transform="rotate(-90 30 30)"
        data-full={percent >= 100 ? "" : undefined}
      />
    </svg>
  );
};

/** The variant epithet after the dash ("The Caged Sovereign — Unbound" → "Unbound"). */
const forbiddenEpithet = (name: string) => name.split(/\s+[—–-]\s+/)[1] ?? null;

/** Book order: collection number, unnumbered cards last, then name. */
const byBookNumber = (a: KessenCatalogEntry, b: KessenCatalogEntry) =>
  (a.number ?? Number.MAX_SAFE_INTEGER) - (b.number ?? Number.MAX_SAFE_INTEGER) ||
  a.name.localeCompare(b.name);

/** The tab value of a keyword's page, which no faction tab selects. */
const KEYWORD_PAGE = "keyword";

const NO_LISTINGS: Readonly<Record<string, number>> = {};
const NO_IDS: ReadonlySet<string> = new Set();

const seenStorageKey = (viewerId: string | undefined) =>
  `kessen:seen-cards:${viewerId ?? "viewer"}`;

/** Card ids this viewer has seen in the book; null before the first visit. */
const readSeenCards = (key: string): Set<string> | null => {
  try {
    const raw = window.localStorage.getItem(key);
    const ids = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(ids)
      ? new Set(ids.filter((id) => typeof id === "string"))
      : null;
  } catch {
    return null;
  }
};

const writeSeenCards = (key: string, ids: readonly string[]) => {
  try {
    window.localStorage.setItem(key, JSON.stringify([...new Set(ids)]));
  } catch {
    // Storage blocked: every visit then starts without NEW marks.
  }
};
