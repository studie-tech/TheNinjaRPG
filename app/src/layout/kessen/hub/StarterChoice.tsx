"use client";

import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import "../kessen.css";
import "./hub.css";
import "./packs.css";
import "./builder.css";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FeedbackAlert } from "@/layout/FeedbackAlert";
import {
  type DeckFaction,
  deckSize,
  KESSEN_DECK_FACTIONS,
  KESSEN_STARTER_LEADERS,
  starterDeck,
} from "@/libs/kessen/deck";
import { ROW_LABELS } from "@/libs/kessen/text";
import { cn } from "@/libs/shadui";
import type { KessenCatalogEntry } from "@/validators/kessen";
import { FactionSigil } from "../FactionSigil";
import { RowGlyph, TacticGlyph } from "../glyphs";
import { KeywordText } from "../KeywordText";
import { kessenRarityTier } from "../kessenArt";
import { LeaderPlate } from "../LeaderPlate";
import { RarityGem } from "../RarityGem";
import { catalogLookup, KESSEN_FACTION_INFO } from "./hubData";

/**
 * The one-time starter choice after Lemu's lesson: six faction tiles, each with its
 * region, perk and starter leader, followed by confirmation and the chosen faction's
 * starter deck in full (leader and every card with its copies and rules text). The
 * player's village faction leads the grid and is preselected.
 */
export const StarterChoice = ({
  homeFaction,
  cards = [],
  onChoose,
  pending = false,
  error,
  className,
}: {
  homeFaction: DeckFaction | null;
  /** Catalog cards, for the starter leaders' names. */
  cards?: readonly KessenCatalogEntry[];
  onChoose: (faction: DeckFaction) => void;
  pending?: boolean;
  /** The server's rejection message, shown next to the button. */
  error?: string | null;
  className?: string;
}) => {
  const [faction, setFaction] = useState<DeckFaction | null>(homeFaction);
  const order =
    homeFaction && KESSEN_DECK_FACTIONS.includes(homeFaction)
      ? [
          homeFaction,
          ...KESSEN_DECK_FACTIONS.filter((option) => option !== homeFaction),
        ]
      : KESSEN_DECK_FACTIONS;
  return (
    <section className={cn("kh-starter", className)} aria-labelledby="kh-starter-title">
      <div className="kh-starter-head">
        <p className="kh-starter-eyebrow">Lesson complete</p>
        <h2 id="kh-starter-title" className="kh-starter-title">
          Choose your faction
        </h2>
        <p className="kh-starter-lede">
          Your starter deck and its leader are yours to keep, and your First Bundle
          opens at once. Other factions stay open through packs and borrowed decks.
          Choose a faction to see its starter deck card by card.
        </p>
      </div>
      <fieldset className="kh-starter-grid">
        <legend className="sr-only">Starter faction</legend>
        {order.map((option) => {
          const info = KESSEN_FACTION_INFO[option];
          const leader = cards.find(
            (card) => card.id === KESSEN_STARTER_LEADERS[option],
          );
          const checked = faction === option;
          return (
            <label
              key={option}
              className="kh-starter-tile"
              data-faction={option}
              data-checked={checked ? "" : undefined}
            >
              <input
                type="radio"
                name="kessen-starter"
                className="kh-starter-radio"
                value={option}
                checked={checked}
                onChange={() => setFaction(option)}
              />
              <FactionSigil
                faction={option}
                renderSize={56}
                className="kh-starter-sigil w-[44px]"
                decorative
              />
              <span className="kh-starter-name">{KESSEN_FACTION_NAMES[option]}</span>
              <span className="kh-starter-region">{info.region}</span>
              {homeFaction === option ? (
                <span className="kh-starter-home">Your village</span>
              ) : null}
              <span className="kh-starter-perk">
                <span className="kh-starter-perk-name">
                  {info.perk ?? "No passive perk"}
                </span>{" "}
                {info.perkText ?? info.identity}
              </span>
              {leader ? (
                <span className="kh-starter-leader">Leader: {leader.name}</span>
              ) : null}
            </label>
          );
        })}
      </fieldset>
      <div className="kh-starter-confirm">
        {error ? (
          <FeedbackAlert feedback={{ success: false, message: error }} foreground />
        ) : null}
        <div className="kh-starter-confirm-row">
          <p className="kh-starter-confirm-perk">
            {faction
              ? `${KESSEN_FACTION_NAMES[faction]}${
                  KESSEN_FACTION_INFO[faction].perk
                    ? ` · ${KESSEN_FACTION_INFO[faction].perk}`
                    : ""
                }`
              : "Choose a faction above."}
          </p>
          <Button
            size="lg"
            className="w-full sm:w-auto"
            disabled={!faction}
            loading={pending}
            onClick={() => faction && onChoose(faction)}
          >
            {faction
              ? pending
                ? "Dealing your deck…"
                : `Take the ${KESSEN_FACTION_NAMES[faction]} starter deck`
              : "Choose a faction"}
          </Button>
        </div>
      </div>
      {faction ? <StarterDeckList faction={faction} cards={cards} /> : null}
    </section>
  );
};

/**
 * A faction's starter deck card by card: its leader plate, then every card with its
 * copies, provision, rarity, row and power and its rules text, the most expensive first.
 */
const StarterDeckList = ({
  faction,
  cards,
}: {
  faction: DeckFaction;
  cards: readonly KessenCatalogEntry[];
}) => {
  const titleId = useId();
  const lookup = catalogLookup(cards);
  const deck = starterDeck(faction);
  const leader = lookup[deck.leaderId];
  const rows = deck.cards
    .flatMap((entry) => {
      const card = lookup[entry.itemId];
      return card ? [{ count: entry.count, card }] : [];
    })
    .sort(
      (a, b) =>
        b.card.provision - a.card.provision || a.card.name.localeCompare(b.card.name),
    );
  if (rows.length === 0) return null;
  return (
    <section className="kh-starter-deck" aria-labelledby={titleId}>
      <div className="kh-starter-deck-head">
        <h3 id={titleId} className="kh-starter-deck-title">
          {KESSEN_FACTION_NAMES[faction]} starter deck
        </h3>
        <p className="kh-starter-deck-size">
          {deckSize(deck.cards)} cards
          {leader ? ` · led by ${leader.name}` : ""}
        </p>
      </div>
      {leader ? (
        <LeaderPlate leader={leader} className="kh-starter-deck-leader" />
      ) : null}
      <ul className="kh-starter-deck-list" aria-label="Cards">
        {rows.map(({ count, card }) => (
          <li key={card.id} className="kh-starter-card">
            <span className="kh-dl-prov" title={`Provision ${card.provision}`}>
              <span className="sr-only">Provision </span>
              {card.provision}
            </span>
            <span className="kh-starter-card-main">
              <span className="kh-starter-card-name">
                {card.name}
                <RarityGem tier={kessenRarityTier(card)} className="text-[12px]" />
              </span>
              <span className="kh-starter-card-kind">
                {card.kind === "TACTIC" ? (
                  <>
                    <TacticGlyph />
                    Tactic
                  </>
                ) : (
                  <>
                    {card.row ? <RowGlyph row={card.row} decorative /> : null}
                    {card.row && card.row !== "ANY" ? ROW_LABELS[card.row] : "Any row"}{" "}
                    · {card.power} power
                  </>
                )}
              </span>
              {card.abilities.length > 0 ? (
                <KeywordText
                  abilities={card.abilities}
                  interactive
                  className="kh-starter-card-text"
                />
              ) : (
                <span className="kh-starter-card-flavor">
                  {card.flavor || "No ability."}
                </span>
              )}
            </span>
            <span className="kh-starter-card-count">
              <span className="sr-only">Copies: </span>×{count}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
};
