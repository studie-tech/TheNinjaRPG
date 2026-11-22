"use client";

import { useSetAtom } from "jotai";
import { Eye, Layers, Swords } from "lucide-react";
import dynamic from "next/dynamic";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChunkErrorBoundary } from "@/layout/ChunkErrorBoundary";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { chatPanelAtom } from "@/libs/chatPanel";
import { cn } from "@/libs/shadui";
import { formatDateTime } from "@/utils/time";
import type { ChallengeMatch } from "@/validators/comments";

/**
 * The options load with the first panel opened. They bring the Kessen deck code (hub
 * data, the NPC catalog, the deck picker) that every conversation page would otherwise
 * download for a popover most players never open.
 */
const ChallengeOptions = dynamic(
  () => import("@/layout/ChallengeOptions").then((module) => module.ChallengeOptions),
  { loading: () => <Loader explanation="Loading challenges" /> },
);

/**
 * A swords icon that opens `ChallengePanel` for a player, so a spar or a duel is one
 * click away wherever players meet, such as their tavern messages.
 */
export function ChallengeButton({
  opponent,
  conversationId,
  className,
}: ChallengePanelProps & { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          aria-label={`Challenge ${opponent.username}`}
        >
          <Swords className="h-6 w-6 hover:text-orange-500" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        tabIndex={-1}
        align="end"
        collisionPadding={8}
        aria-label={`Challenge ${opponent.username}`}
        className="max-h-[var(--radix-popover-content-available-height)] w-[320px] overflow-y-auto p-[8px]"
        // Focus the panel, not its first Send button, so an extra Enter sends nothing.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <ChallengePanel
          opponent={opponent}
          conversationId={conversationId}
          onNavigate={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Every way to challenge a player straight away: a spar in the arena and a friendly
 * Kessen duel. Each option sends with one click and answers next to its button; the
 * challenged player accepts on the arena or Card Hall page as usual. Render it only while
 * shown, since the Kessen option reads the player's decks.
 */
export function ChallengePanel({
  opponent,
  conversationId,
  leading,
  onNavigate,
}: ChallengePanelProps &
  ChallengeNavigation & {
    /** A control before the title, such as a way back to the menu that opened it. */
    leading?: ReactNode;
  }) {
  const closeChat = useCloseChatPanel();
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex items-center gap-[4px]">
        {leading}
        <p className="min-w-0 px-[2px] text-[13px] font-bold">
          Challenge <span className="break-all">{opponent.username}</span>
        </p>
      </div>
      <ChunkErrorBoundary
        fallback={() => (
          <p role="alert" className="text-destructive px-[2px] text-[12px]">
            The challenge options could not be loaded.{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </p>
        )}
      >
        <ChallengeOptions
          opponent={opponent}
          conversationId={conversationId}
          onNavigate={() => {
            closeChat();
            onNavigate?.();
          }}
        />
      </ChunkErrorBoundary>
    </div>
  );
}

/**
 * A conversation's one-line announcement that a challenge sent from it started a match,
 * in place of a message card: who plays, what, when, and a link to watch it live.
 */
export function ChallengeMatchNotice({
  challenger,
  match,
  createdAt,
  compact = false,
  action,
}: {
  challenger: string;
  match: ChallengeMatch;
  createdAt: Date;
  /** The chat panel's dense rows. */
  compact?: boolean;
  /** A moderation control shown after the watch link. */
  action?: ReactNode;
}) {
  const closeChat = useCloseChatPanel();
  const isSpar = match.type === "SPAR";
  const Icon = isSpar ? Swords : Layers;
  return (
    <div
      // The full variant takes the message cards' type size and date format.
      className={cn(
        "flex items-center gap-[8px] rounded-lg border border-dashed",
        compact
          ? "mx-[8px] px-[8px] py-[4px] text-[13px]"
          : "bg-popover mb-3 px-[12px] py-[8px]",
      )}
    >
      <Icon className="h-[16px] w-[16px] shrink-0 text-orange-600" aria-hidden />
      <p className="min-w-0 flex-1">
        <b>{challenger}</b> and <b>{match.opponentName}</b> started{" "}
        {isSpar ? "a spar" : "a Kessen duel"}
        <span className="text-muted-foreground">
          {" · "}
          {/* Locale and timezone differ between server and browser. */}
          <time dateTime={createdAt.toISOString()} suppressHydrationWarning>
            {compact
              ? createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : formatDateTime(createdAt)}
          </time>
        </span>
      </p>
      <Button
        asChild
        variant="outline"
        className="h-[28px] shrink-0 px-[10px] text-[12px]"
      >
        <Link
          href={
            isSpar ? `/battlelog/${match.matchId}` : `/kessen/watch/${match.matchId}`
          }
          onNavigate={closeChat}
        >
          <Eye className="mr-[4px] h-[14px] w-[14px]" aria-hidden /> Watch
        </Link>
      </Button>
      {action}
    </div>
  );
}

/** Closes the chat panel as a challenge link in it opens another page. */
const useCloseChatPanel = () => {
  const setPanel = useSetAtom(chatPanelAtom);
  return () =>
    setPanel((current) => (current.owner ? { ...current, owner: null } : current));
};

/** Who a challenge goes to, and the public conversation it is sent from, if any. */
export interface ChallengePanelProps {
  opponent: ChallengeOpponent;
  /** Announces the match there when it starts. */
  conversationId?: string | null;
}

/** Lets the surface holding a challenge control close when one of its links opens a page. */
export interface ChallengeNavigation {
  /** Called as a link here opens another page, e.g. to close the popover holding it. */
  onNavigate?: () => void;
}

/** Where a challenge shortcut is offered: the public conversation that announces its match, if any. */
export interface ChallengeFrom {
  conversationId: string | null;
}

/** The player a challenge goes to. */
export interface ChallengeOpponent {
  userId: string;
  username: string;
}
