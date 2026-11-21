"use client";

import { Loader2, MousePointerClick, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/libs/shadui";

/**
 * A tutorial lesson card: an eyebrow and title, a step progress bar, scrolling text
 * above the call to action and the controls that answer it. The Activity dock shows
 * every tutorial step in it, the main tutorial's and a guided lesson's alike.
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
  isBusy = false,
  errorMessage,
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
  /** Shows the header's "Skip tutorial" button. */
  onDismiss?: () => void;
  isBusy?: boolean;
  errorMessage?: string;
}) => (
  <div className="relative z-10 rounded-b-xl bg-card" aria-busy={isBusy}>
    <header className="flex items-start gap-2 px-4 pt-3 md:px-5">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <p className="truncate font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            {eyebrow}
          </p>
        )}
        {/* The dark theme's primary is a deep brown meant for filled buttons; as text on its
            navy card it falls below AA contrast, so dark mode lights it to amber. */}
        <h2 className="font-bold text-lg text-primary leading-tight dark:text-amber-300">
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
          title={isBusy ? "Disabling" : "Skip tutorial"}
          aria-label={isBusy ? "Disabling" : "Skip tutorial"}
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
        className="flex gap-1 px-4 pt-2 md:px-5"
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
    <div
      className={cn(
        "max-h-[min(40dvh,420px,calc(100dvh-var(--assistant-portrait-height)-22rem))] space-y-3 overflow-y-auto overscroll-contain px-4 py-3 md:px-5",
      )}
    >
      {isBusy && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 font-medium text-base text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Disabling
        </div>
      )}
      {errorMessage && !isBusy && (
        <p role="alert" className="text-base text-destructive">
          {errorMessage}
        </p>
      )}
      <fieldset disabled={isBusy} className="contents">
        {lead}
        {children}
      </fieldset>
    </div>
    {(action || footer) && (
      <fieldset
        disabled={isBusy}
        className="space-y-3 rounded-b-xl border-border border-t bg-card px-4 py-3 md:px-5"
      >
        {action && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/70 bg-amber-500/15 px-3 py-2 font-semibold text-base">
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
);
