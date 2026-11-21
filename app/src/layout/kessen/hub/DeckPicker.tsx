"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type DeckFaction, KESSEN_DECK_FACTIONS } from "@/libs/kessen/deck";
import { KESSEN_FACTION_NAMES } from "@/libs/kessen/packs";
import { cn } from "@/libs/shadui";
import type { KessenDeckSource } from "@/validators/kessen";
import { FactionSigil } from "../FactionSigil";
import type { KessenDeckSummary } from "./hubData";

/**
 * The deck a match is played with, as radio choices: each saved deck (ready, completed
 * with borrowed copies, or closed with the rule it breaks) and today's borrowed deck of a
 * chosen faction. Pair it with `useDeckChoice`.
 */
export const DeckPicker = ({
  decks,
  idPrefix,
  choice,
  legend = "Your deck",
}: {
  decks: readonly KessenDeckSummary[];
  /** Unique per picker on the page, for the radio ids. */
  idPrefix: string;
  choice: DeckChoice;
  legend?: string;
}) => (
  <fieldset className="min-w-0">
    <legend className="mb-1.5 font-semibold text-muted-foreground text-[12px] uppercase tracking-wider">
      {legend}
    </legend>
    <RadioGroup
      value={choice.value}
      onValueChange={choice.setValue}
      aria-label={legend}
      className="gap-1.5"
    >
      {decks.map((deck) => {
        const playable = deck.ready || deck.fillable;
        return (
          <Label
            key={deck.id}
            htmlFor={`deck-${idPrefix}-${deck.id}`}
            className={cn(DECK_OPTION, !playable && "cursor-not-allowed opacity-60")}
          >
            <RadioGroupItem
              id={`deck-${idPrefix}-${deck.id}`}
              value={deck.id}
              disabled={!playable}
            />
            {deck.faction ? (
              <FactionSigil
                faction={deck.faction}
                renderSize={22}
                className="w-[20px] shrink-0"
                decorative
              />
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{deck.name}</span>
              <span className="block font-normal text-muted-foreground text-[12px]">
                Provision {deck.provision}/{deck.budget} · {deck.cards} cards ·{" "}
                {deck.ready
                  ? "ready"
                  : deck.fillable
                    ? "missing copies are filled with borrowed cards"
                    : deck.problem}
              </span>
            </span>
          </Label>
        );
      })}
      <div className={DECK_OPTION}>
        <RadioGroupItem id={`deck-${idPrefix}-borrow`} value={BORROW} />
        <FactionSigil
          faction={choice.borrowFaction}
          renderSize={22}
          className="w-[20px] shrink-0"
          decorative
        />
        <Label
          htmlFor={`deck-${idPrefix}-borrow`}
          className="min-w-0 flex-1 cursor-pointer"
        >
          <span className="block font-semibold">Borrow a deck</span>
          <span className="block font-normal text-muted-foreground text-[12px]">
            A ready-made deck for today, with the same rewards as your own.
          </span>
        </Label>
        <Select
          value={choice.borrowFaction}
          onValueChange={(value) => {
            choice.setBorrowFaction(value as DeckFaction);
            choice.setValue(BORROW);
          }}
        >
          <SelectTrigger
            className="h-8 w-[130px] shrink-0"
            aria-label="Faction of the borrowed deck"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KESSEN_DECK_FACTIONS.map((faction) => (
              <SelectItem key={faction} value={faction}>
                {KESSEN_FACTION_NAMES[faction]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </RadioGroup>
  </fieldset>
);

/**
 * The picker's state: the chosen saved deck (the preferred one when it can be played,
 * else the first ready deck) or the borrowed deck, the source it sends and a short label.
 */
export const useDeckChoice = (
  decks: readonly KessenDeckSummary[],
  preferredDeckId: string | null | undefined,
  loanerFaction: DeckFaction,
): DeckChoice => {
  const startingDeck =
    decks.find(
      (deck) => deck.id === preferredDeckId && (deck.ready || deck.fillable),
    ) ??
    decks.find((deck) => deck.ready) ??
    null;
  const [value, setValue] = useState<string>(startingDeck?.id ?? BORROW);
  const [borrowFaction, setBorrowFaction] = useState<DeckFaction>(loanerFaction);
  const deck = decks.find((entry) => entry.id === value) ?? null;
  const source: KessenDeckSource = deck
    ? deck.ready
      ? { source: "saved", deckId: deck.id }
      : { source: "fill", deckId: deck.id }
    : { source: "loaner", faction: borrowFaction };
  const label = deck
    ? `${deck.name}${deck.ready ? "" : " + borrowed copies"}`
    : `Borrowed ${KESSEN_FACTION_NAMES[borrowFaction]} deck`;
  return { value, setValue, borrowFaction, setBorrowFaction, deck, source, label };
};

export interface DeckChoice {
  /** A saved deck id, or the borrowed deck. */
  value: string;
  setValue: (value: string) => void;
  borrowFaction: DeckFaction;
  setBorrowFaction: (faction: DeckFaction) => void;
  /** The chosen saved deck; null for the borrowed deck. */
  deck: KessenDeckSummary | null;
  source: KessenDeckSource;
  /** "Fire Lotus", "Fire Lotus + borrowed copies" or "Borrowed Hyorin deck". */
  label: string;
}

const DECK_OPTION =
  "flex cursor-pointer items-center gap-2 rounded-md border bg-card p-2 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary/40";

const BORROW = "__borrow__";
