"use client";

import { ChevronDown, Loader2, MousePointerClick, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getSpotlightKeepRects } from "@/layout/tutorial/Spotlight";
import { cn } from "@/libs/shadui";

/**
 * A tutorial lesson card: an eyebrow and title, a step progress bar, scrolling text
 * above the call to action and the controls that answer it, beside an optional
 * portrait column for the coach. The Activity dock shows every tutorial step in it,
 * the main tutorial's and a guided lesson's alike. On a narrow dock the text folds to two
 * lines when the player turns to the page while the open lesson stands in its way (see
 * `isLeadInTheWay`), leaving the call to action and more of the page in view; "Show all"
 * opens it again.
 */
export const CoachCard = ({
  title,
  eyebrow,
  progress,
  action,
  lead,
  children,
  footer,
  onDismiss,
  dismissLabel = "Skip tutorial",
  portrait,
  isBusy = false,
  errorMessage,
  foldKey,
  startFolded = false,
}: {
  title: string;
  eyebrow?: string;
  progress?: { position: number; total: number };
  /** The call to action, in the amber callout. */
  action?: string;
  /** What the coach says, shown above the call to action. */
  lead?: ReactNode;
  children?: ReactNode;
  /** Controls that answer the step, kept in view under the scrolling text. */
  footer?: ReactNode;
  /** Shows the header's close button. */
  onDismiss?: () => void;
  /** Accessible name of the close button. */
  dismissLabel?: string;
  /** The coach's column down the card's left side; the text stays above it. */
  portrait?: ReactNode;
  isBusy?: boolean;
  errorMessage?: string;
  /**
   * The lesson's key. When the player taps the page outside the dock while the open lesson
   * stands in the page's way, its lead folds to two lines on a narrow dock until the key
   * changes. Omit it to keep the lead open.
   */
  foldKey?: string;
  /** Opens with the lead folded, for a target the open lesson would cover. */
  startFolded?: boolean;
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLDivElement>(null);
  const [foldedKey, setFoldedKey] = useState<string | null>(null);
  // Only a card whose callout keeps the instruction in view may fold its text.
  const canFold = foldKey !== undefined && !!action && !!lead;
  // The lesson whose lead the player unfolded again.
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  const isFolded =
    canFold && (foldedKey === foldKey || (startFolded && openedKey !== foldKey));
  useEffect(() => {
    if (!canFold || isFolded) return;
    const fold = (event: Event) => {
      const dock = cardRef.current?.closest("[data-activity-dock]") ?? cardRef.current;
      if (!dock || !leadRef.current) return;
      if (event.target instanceof Node && dock.contains(event.target)) return;
      if (!isLeadInTheWay(dock, leadRef.current)) return;
      setFoldedKey(foldKey);
    };
    document.addEventListener("pointerdown", fold, true);
    return () => document.removeEventListener("pointerdown", fold, true);
  }, [canFold, foldKey, isFolded]);
  return (
    <div
      ref={cardRef}
      className="bg-card relative z-10 flex rounded-b-xl"
      aria-busy={isBusy}
    >
      {portrait}
      {/* Above the portrait, whose hand reaches under the lesson text. */}
      <div data-coach-body="" className="relative z-[1] min-w-0 flex-1">
        <header className="flex items-start gap-2 px-4 pt-3 md:px-5 @max-[34rem]/dock:pt-2">
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <p
                className={cn(
                  "text-muted-foreground truncate text-xs font-semibold tracking-wider uppercase @max-[34rem]/dock:text-sm @max-[34rem]/dock:tracking-normal @max-[34rem]/dock:whitespace-normal @max-[18rem]/dock:hidden",
                  isFolded && "@max-[34rem]/dock:hidden",
                )}
              >
                {eyebrow}
              </p>
            )}
            {/* The dark theme's primary is a deep brown meant for filled buttons; as text on its
            navy card it falls below AA contrast, so dark mode lights it to amber. */}
            <h2 className="text-primary text-lg leading-tight font-bold @max-[34rem]/dock:text-xl dark:text-amber-300">
              {title}
            </h2>
          </div>
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDismiss();
              }}
              disabled={isBusy}
              className="-mr-2 h-8 w-8 shrink-0 opacity-60 hover:opacity-100"
              title={isBusy ? "Disabling" : dismissLabel}
              aria-label={isBusy ? "Disabling" : dismissLabel}
            >
              {isBusy ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <X className="h-5 w-5" aria-hidden="true" />
              )}
            </Button>
          )}
        </header>
        {progress && (
          <div
            className="flex gap-1 px-4 pt-2 md:px-5 @max-[34rem]/dock:pt-1.5"
            role="progressbar"
            aria-label="Chapter progress"
            aria-valuemin={1}
            aria-valuemax={progress.total}
            aria-valuenow={progress.position}
          >
            {Array.from({ length: progress.total }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  i < progress.position
                    ? "bg-primary dark:bg-amber-400"
                    : "bg-primary/20 dark:bg-amber-400/25",
                )}
              />
            ))}
          </div>
        )}
        {/* A strip along the foot of the screen (from 44rem, 528px) keeps the controls
        beside the text, so it stays low. */}
        <div className="@min-[44rem]/dock:flex">
          {/* Lesson text arrives styled for the wide dock (text-base, text-sm); a narrow
        dock is a phone held at reading distance, where it reads a step larger. */}
          <div
            className={cn(
              "min-w-0 flex-1 max-h-[min(40dvh,420px,calc(100dvh-22rem))] space-y-3 overflow-y-auto overscroll-contain px-4 py-3 md:px-5 @max-[34rem]/dock:max-h-[min(30dvh,420px,calc(100dvh-22rem))] @max-[34rem]/dock:space-y-2 @max-[34rem]/dock:py-2",
              "@max-[34rem]/dock:[&_.text-base]:text-lg @max-[34rem]/dock:[&_.text-base]:leading-normal @max-[34rem]/dock:[&_.text-sm]:text-base",
            )}
          >
            {isBusy && (
              <div
                role="status"
                aria-live="polite"
                className="text-muted-foreground flex items-center gap-2 text-base font-medium"
              >
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Disabling
              </div>
            )}
            {errorMessage && !isBusy && (
              <p role="alert" className="text-destructive text-base">
                {errorMessage}
              </p>
            )}
            <fieldset disabled={isBusy} className="contents">
              {lead && (
                <div
                  ref={leadRef}
                  data-lead-folded={isFolded || undefined}
                  className={cn(
                    // Two lines of the narrow dock's text-lg leading-normal lead, fading out
                    // (FOLDED_LEAD_REM).
                    isFolded &&
                      "@max-[34rem]/dock:max-h-[3.375rem] @max-[34rem]/dock:overflow-hidden @max-[34rem]/dock:[mask-image:linear-gradient(to_bottom,black_55%,transparent)]",
                  )}
                >
                  {lead}
                </div>
              )}
              {isFolded && (
                <button
                  type="button"
                  aria-expanded={false}
                  onClick={() => {
                    setFoldedKey(null);
                    setOpenedKey(foldKey ?? null);
                  }}
                  className="text-primary hidden items-center gap-1 text-sm font-semibold @max-[34rem]/dock:inline-flex dark:text-amber-300"
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                  Show all
                </button>
              )}
              {children}
            </fieldset>
          </div>
          {(action || footer) && (
            <fieldset
              disabled={isBusy}
              className="border-border bg-card space-y-3 rounded-b-xl border-t px-4 py-3 md:px-5 @max-[34rem]/dock:space-y-2 @max-[34rem]/dock:py-2 @min-[44rem]/dock:max-w-72 @min-[44rem]/dock:shrink-0 @min-[44rem]/dock:self-end @min-[44rem]/dock:border-t-0"
            >
              {action && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-500/70 bg-amber-500/15 px-3 py-2 text-base font-semibold @max-[34rem]/dock:py-1.5 @max-[34rem]/dock:text-lg @max-[34rem]/dock:leading-snug">
                  <MousePointerClick
                    className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <span>{action}</span>
                </p>
              )}
              {footer}
            </fieldset>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Whether the open lesson stands in the page's way, so a tap on the page folds its lead:
 * the lead runs past the two lines it folds to, and the dock either covers what the
 * spotlight keeps in view (the highlighted control, its pointer, marked elements) or takes
 * more than half the screen's height. A dock beside the page with room for its text, as on
 * a desktop, keeps it open.
 */
export const isLeadInTheWay = (dock: Element, lead: HTMLElement) => {
  const rootFontPx =
    Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 12;
  if (lead.scrollHeight <= FOLDED_LEAD_REM * rootFontPx + 1) return false;
  const area = dock.getBoundingClientRect();
  if (area.height > window.innerHeight * MAX_OPEN_DOCK_SHARE) return true;
  return getSpotlightKeepRects().some(
    (rect) =>
      rect.left < area.right &&
      rect.right > area.left &&
      rect.top < area.bottom &&
      rect.bottom > area.top,
  );
};

/** Height of a folded lead, in rem: the `max-h` of its folded class. */
const FOLDED_LEAD_REM = 3.375;
/** Share of the screen's height an open lesson may take before a tap on the page folds it. */
const MAX_OPEN_DOCK_SHARE = 0.5;
