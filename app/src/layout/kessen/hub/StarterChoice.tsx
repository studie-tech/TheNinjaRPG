"use client";

import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import "../kessen.css";
import "./hub.css";
import "./packs.css";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FeedbackAlert } from "@/layout/FeedbackAlert";
import {
  type DeckFaction,
  KESSEN_DECK_FACTIONS,
  KESSEN_STARTER_LEADERS,
} from "@/libs/kessen/deck";
import { cn } from "@/libs/shadui";
import type { KessenCatalogEntry } from "@/validators/kessen";
import { FactionSigil } from "../FactionSigil";
import { KESSEN_FACTION_INFO } from "./hubData";

/**
 * The one-time starter choice after Lemu's lesson: six faction tiles, each with its
 * region, perk and starter leader, and the confirm button below them. The player's village
 * faction leads the grid and is preselected.
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
    </section>
  );
};
