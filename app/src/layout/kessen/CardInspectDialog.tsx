"use client";

import type React from "react";
import { useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/libs/shadui";
import { CardFace } from "./CardFace";
import { useReturnFocus } from "./hub/useReturnFocus";
import {
  KESSEN_RARITY_LABELS,
  type KessenCardDisplay,
  kessenRarityTier,
} from "./kessenArt";
import { RarityGem } from "./RarityGem";

/**
 * A Kessen card at full size in the game's dialog: the name and rarity in the header,
 * the card face with its keyword glossary, the caller's facts about it (`children`) and
 * a Close button. Opening focuses the dialog itself, so no keyword starts focused under
 * a tap; closing returns the focus to the control that opened it, or to `returnFocus`
 * when that control has left the page. Short landscape screens put the facts beside a
 * card sized to the window height. It draws in the game's theme; a scene passes
 * `scene` so the dialog takes its lacquer palette.
 */
export const CardInspectDialog = ({
  card,
  onClose,
  isNew = false,
  motion,
  description,
  closeLabel = "Close",
  returnFocus,
  scene = false,
  children,
}: {
  /** The card shown; null closes the dialog. */
  card: KessenCardDisplay | null;
  onClose: () => void;
  /** The NEW ribbon of a card first held in this reveal. */
  isNew?: boolean;
  motion?: boolean;
  /** Screen-reader description; defaults to the rarity. */
  description?: string;
  closeLabel?: string;
  /** Focus target after closing when the opener is gone (e.g. a deck it opened). */
  returnFocus?: () => HTMLElement | null | undefined;
  /** Opened from a scene (the pack ceremony): the dialog takes the scene palette. */
  scene?: boolean;
  /** Details under (or beside) the card. */
  children?: React.ReactNode;
}) => {
  const open = card !== null;
  const contentRef = useRef<HTMLDivElement>(null);
  const focusReturn = useReturnFocus(returnFocus);
  const tier = card ? kessenRarityTier(card) : null;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        ref={contentRef}
        tabIndex={-1}
        className={cn(
          "kessen-ui w-[min(380px,calc(100vw-2rem))] gap-3 bg-card p-4 outline-none md:max-w-none [@media(orientation:landscape)_and_(max-height:520px)]:w-[min(720px,calc(100vw-2rem))]",
          scene && "kessen-scene border-[var(--kessen-gold-lo)]",
        )}
        onOpenAutoFocus={(event) => {
          focusReturn.onOpenAutoFocus();
          event.preventDefault();
          contentRef.current?.focus();
        }}
        onCloseAutoFocus={focusReturn.onCloseAutoFocus}
      >
        {card && tier ? (
          <>
            <DialogHeader className="pr-6">
              <DialogTitle
                className={cn(
                  "font-[family-name:var(--kessen-font-display)] font-normal text-[20px] leading-tight",
                  scene && "text-primary",
                )}
              >
                {card.name}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {description ?? `${KESSEN_RARITY_LABELS[tier]} card`}
              </DialogDescription>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="gap-1 text-[12px]">
                  <RarityGem tier={tier} decorative />
                  {KESSEN_RARITY_LABELS[tier]}
                </Badge>
                {isNew ? <Badge className="text-[12px]">New</Badge> : null}
              </div>
            </DialogHeader>
            <div className="grid min-h-0 gap-3 [@media(orientation:landscape)_and_(max-height:520px)]:grid-cols-[auto_minmax(0,1fr)] [@media(orientation:landscape)_and_(max-height:520px)]:items-start">
              <CardFace
                card={card}
                renderSize={320}
                isNew={isNew}
                motion={motion}
                interactiveKeywords
                className="w-full max-w-[320px] justify-self-center [@media(orientation:landscape)_and_(max-height:520px)]:w-[calc((100dvh-150px)*0.714)]"
              />
              {children ? (
                <div className="min-w-0 text-[13px] [@media(orientation:landscape)_and_(max-height:520px)]:max-h-[calc(100dvh-150px)] [@media(orientation:landscape)_and_(max-height:520px)]:overflow-y-auto">
                  {children}
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                className="min-h-10 w-full text-[13px] sm:w-auto pointer-coarse:min-h-11"
                onClick={onClose}
              >
                {closeLabel}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
