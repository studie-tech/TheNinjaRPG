"use client";

import { Minus, Plus } from "lucide-react";
import { type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import {
  cardKeywords,
  KESSEN_KEYWORDS,
  KESSEN_TERMS,
  type KessenKeyword,
  keywordGlossary,
  type TerrainReach,
} from "@/libs/kessen/text";
import { cn } from "@/libs/shadui";
import type { KessenCatalogEntry } from "@/validators/kessen";
import { CardFace } from "../CardFace";
import { KeywordText } from "../KeywordText";

/**
 * One card of the deck builder in full: the face at reading size, its copies in the deck
 * with a stepper, the sets Bonds and Summons count it in, what the player holds and why
 * a copy cannot be added. Wide enough (a bottom sheet) it sets the face beside the written-out rules text and the glossary
 * lines of the card's keywords; narrow (the builder's detail column) the face prints the
 * text itself and the keyword key under it explains the terms.
 */
export const BuilderCardDetail = ({
  card,
  inDeck,
  limit,
  facts,
  reason,
  reach,
  onAdd,
  onRemove,
  className,
}: {
  card: KessenCatalogEntry;
  inDeck: number;
  limit: number;
  /** What the player holds of the card, or where to get it. */
  facts?: ReactNode;
  /** Why a copy cannot be added now; null when it can. */
  reason: string | null;
  /** Terrain reach of the deck's faction, for the Terrain glossary line. */
  reach: TerrainReach;
  onAdd: () => void;
  onRemove: () => void;
  className?: string;
}) => {
  const keywords = uniqueKeywords(card);
  return (
    <div className={cn("kh-detail", className)}>
      <div className="kh-detail-body">
        <CardFace
          card={card}
          renderSize={320}
          interactiveKeywords
          showCopyPips={false}
          className="kh-detail-face"
        />
        <div className="kh-detail-info">
          <div className="kh-detail-rules">
            <KeywordText abilities={card.abilities} empty="No ability." />
            {keywords.length > 0 ? (
              <ul className="kh-detail-kws">
                {keywords.map((keyword) => (
                  <li key={keyword} className="kessen-glossary-line">
                    <span className="kessen-kw" data-kw={keyword}>
                      {keyword}
                    </span>
                    <span>: {keywordGlossary(keyword, reach)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="kh-detail-copies">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="kh-step"
              disabled={inDeck === 0}
              onClick={onRemove}
              aria-label={`Remove one ${card.name}`}
              data-button-sfx="off"
            >
              <Minus aria-hidden />
            </Button>
            <span className="kh-detail-count">
              {inDeck}
              <span className="kh-copy-limit">/{limit}</span>
              <span className="kh-detail-count-label"> in deck</span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={cn("kh-step", reason && "opacity-40")}
              aria-disabled={reason ? true : undefined}
              onClick={onAdd}
              aria-label={`Add one ${card.name}${reason ? ` (${reason})` : ""}`}
              data-button-sfx="off"
            >
              <Plus aria-hidden />
            </Button>
          </div>
          {card.sets.length > 0 ? (
            <p className="kh-detail-facts">
              <span className="text-muted-foreground">
                {card.sets.length === 1 ? "Set: " : "Sets: "}
              </span>
              {card.sets.join(", ")}
            </p>
          ) : null}
          {facts ? (
            <p className="kh-detail-facts text-muted-foreground">{facts}</p>
          ) : null}
          {reason ? <p className="kh-detail-reason">{reason}</p> : null}
        </div>
      </div>
    </div>
  );
};

/**
 * The builder's key to card text: every keyword with its glossary line, then the rules
 * terms the lines use. The keywords of the card in view are marked, so its text is
 * explained where the player is looking.
 */
export const KeywordKey = ({
  active = [],
  reach,
  heading = true,
  className,
}: {
  /** Keywords of the card in view. */
  active?: readonly KessenKeyword[];
  reach: TerrainReach;
  /** Off where a sheet title already names the key. */
  heading?: boolean;
  className?: string;
}) => {
  const titleId = useId();
  return (
    <section
      className={cn("kh-key", className)}
      {...(heading ? { "aria-labelledby": titleId } : { "aria-label": "Keyword key" })}
    >
      {heading ? (
        <h3 id={titleId} className="kh-key-title">
          Keyword key
        </h3>
      ) : null}
      <dl className="kh-key-list">
        {KESSEN_KEYWORDS.map((keyword) => (
          <div
            key={keyword}
            className="kh-key-entry"
            data-active={active.includes(keyword) ? "" : undefined}
          >
            <dt className="kessen-kw" data-kw={keyword}>
              {keyword}
            </dt>
            <dd>{keywordGlossary(keyword, reach)}</dd>
          </div>
        ))}
        {TERM_ENTRIES.map(([term, text]) => (
          <div key={term} className="kh-key-entry" data-term>
            <dt>{term}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
};

/** The card's keywords, each once, in glossary order. */
export const uniqueKeywords = (card: Pick<KessenCatalogEntry, "abilities">) => {
  const own = new Set(cardKeywords(card.abilities));
  return KESSEN_KEYWORDS.filter((keyword) => own.has(keyword));
};

const TERM_ENTRIES = Object.entries(KESSEN_TERMS);
