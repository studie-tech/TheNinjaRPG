"use client";

import { useState } from "react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  abilitySegments,
  KESSEN_GLOSSARY,
  type KessenKeyword,
  type TextSegment,
} from "@/libs/kessen/text";
import { cn } from "@/libs/shadui";
import type { KessenAbility } from "@/validators/itemCard";

/**
 * Card ability text from the structured ability list, with keywords in vermilion.
 * Interactive keywords open their glossary line on tap, click or keyboard and report
 * the keyword through `onKeyword`, so an inspect sheet can follow along. Inside a card
 * face the line opens above the name banner, over the art, so the rules text, flavor and
 * whatever sits under the card stay readable; elsewhere it opens below the keyword.
 */
export const KeywordText = ({
  abilities,
  segments,
  interactive = false,
  onKeyword,
  empty = "",
  className,
}: {
  abilities?: readonly KessenAbility[];
  /** Pre-built segments; takes precedence over `abilities`. */
  segments?: readonly TextSegment[];
  interactive?: boolean;
  onKeyword?: (keyword: KessenKeyword) => void;
  /** Text shown when the card has no abilities. */
  empty?: string;
  className?: string;
}) => {
  const parts = segments ?? abilitySegments(abilities ?? []);
  if (parts.length === 0) {
    return empty ? <span className={cn("kessen-text", className)}>{empty}</span> : null;
  }
  return (
    <span className={cn("kessen-text", className)}>
      {parts.map((segment, index) =>
        segment.t === "text" ? (
          <span key={index}>{segment.s}</span>
        ) : interactive ? (
          <KeywordButton
            key={index}
            keyword={segment.kw}
            label={segment.s}
            onKeyword={onKeyword}
          />
        ) : (
          <span key={index} className="kessen-kw" data-kw={segment.kw}>
            {segment.s}
          </span>
        ),
      )}
    </span>
  );
};

/** Glossary line of a keyword, for chips and inspect sheets. */
export const KeywordGlossary = ({
  keyword,
  className,
}: {
  keyword: KessenKeyword;
  className?: string;
}) => (
  <span className={cn("kessen-glossary-line", className)}>
    <span className="kessen-kw" data-kw={keyword}>
      {keyword}
    </span>
    <span>: {KESSEN_GLOSSARY[keyword]}</span>
  </span>
);

const KeywordButton = ({
  keyword,
  label,
  onKeyword,
}: {
  keyword: KessenKeyword;
  label: string;
  onKeyword?: (keyword: KessenKeyword) => void;
}) => {
  const [{ virtual, attach, button }] = useState(createGlossaryAnchor);
  const [region, setRegion] = useState<Element | null>(null);
  return (
    <Popover
      onOpenChange={(open) => {
        if (open) setRegion(glossaryRegion(button()));
      }}
    >
      <PopoverAnchor virtualRef={virtual} />
      <PopoverTrigger asChild>
        <button
          ref={attach}
          type="button"
          className="kessen-kw kessen-kw-button"
          data-kw={keyword}
          data-button-sfx="off"
          aria-label={`${label}. ${KESSEN_GLOSSARY[keyword]}`}
          onClick={(event) => {
            event.stopPropagation();
            onKeyword?.(keyword);
          }}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={region ? "top" : "bottom"}
        sideOffset={6}
        collisionPadding={8}
        className="kessen-glossary w-64 p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <KeywordGlossary keyword={keyword} />
      </PopoverContent>
    </Popover>
  );
};

/** The card panel (name banner and rules box) a keyword's glossary line sits above. */
const glossaryRegion = (button: HTMLElement | null) =>
  button?.closest("[data-kessen-glossary-anchor]") ?? null;

/**
 * The popover's virtual anchor and the callback ref of its button. The anchor measures
 * the button whenever the popover positions itself.
 */
const createGlossaryAnchor = () => {
  let button: HTMLButtonElement | null = null;
  const measurable: GlossaryAnchor = {
    getBoundingClientRect: () => glossaryAnchorRect(button),
    get contextElement() {
      return button ?? undefined;
    },
  };
  return {
    virtual: { current: measurable },
    attach: (element: HTMLButtonElement | null) => {
      button = element;
    },
    button: () => button,
  };
};

/**
 * Where the glossary line is placed: the top edge of the keyword's card panel, centred on
 * the card, or the keyword itself outside a card.
 */
const glossaryAnchorRect = (button: HTMLElement | null) => {
  if (!button) return new DOMRect();
  const region = glossaryRegion(button);
  if (!region) return button.getBoundingClientRect();
  const rect = region.getBoundingClientRect();
  return new DOMRect(rect.left, rect.top, rect.width, 0);
};

type GlossaryAnchor = {
  getBoundingClientRect: () => DOMRect;
  readonly contextElement: Element | undefined;
};
