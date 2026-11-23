"use client";

import "../kessen.css";
import "./hub.css";
import { Trophy } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import { cn } from "@/libs/shadui";

/**
 * The Card Hall in the game's page frame ("Kessen", with the way back to the minigames),
 * on the content box's own surface in the game's theme, with its section tabs (`tabs`)
 * in the frame's header. An open scene (the table, a pack ceremony) takes the hall's
 * place in the lacquer scene palette, the tabs leave the header and the frame's title
 * leads back to the hall; the hall stays mounted behind, hidden, so the section, its
 * scroll and the control that opened the scene are still there. The subtitle wraps
 * rather than clipping beside the tabs on a phone. Beside the tabs, a Leaderboard button
 * opens the ranked ladder.
 */
export const HallBox = ({
  children,
  tabs,
  title = KESSEN_GAME_NAME,
  subtitle = KESSEN_HALL_SUBTITLE,
  scene = null,
  backHref = "/minigames",
  leaderboardLink = true,
  isGuest = false,
}: {
  children: React.ReactNode;
  /** The section tabs, in the frame's header. */
  tabs?: React.ReactNode;
  title?: string;
  subtitle?: string;
  scene?: HallScene | null;
  /** Where the frame's back control leads while no scene is open. */
  backHref?: string;
  /** Show the Leaderboard button in the header; off on the leaderboard itself. */
  leaderboardLink?: boolean;
  /** Guests keep the illustrated landing typography. */
  isGuest?: boolean;
}) => (
  <ContentBox
    title={scene ? (scene.title ?? "Card Hall") : title}
    subtitle={
      <span className="block whitespace-normal">{scene?.label ?? subtitle}</span>
    }
    defaultBackHref={backHref}
    onBack={scene?.onLeave}
    padding={false}
    topRightContent={
      scene ? undefined : (
        <div className="flex items-center gap-2">
          {tabs}
          {leaderboardLink ? <LeaderboardLink /> : null}
        </div>
      )
    }
  >
    <div className={cn("kessen-hall kessen-ui", !isGuest && "kessen-lobby")}>
      {scene ? <div className="kh-scene kessen-scene">{scene.content}</div> : null}
      <div hidden={scene !== null}>
        <div className="kh-hall-inner">{children}</div>
      </div>
    </div>
  </ContentBox>
);

/**
 * The way to the ranked ladder, as the other minigames' Leaderboard buttons; a trophy
 * alone on a phone, so the section tabs keep their place in the header.
 */
const LeaderboardLink = () => (
  <Button asChild size="sm" className="px-2 sm:px-3">
    <Link href="/kessen/leaderboard" aria-label="Leaderboard" title="Leaderboard">
      <Trophy className="h-4 w-4 sm:mr-1.5" aria-hidden />
      <span className="hidden sm:inline">Leaderboard</span>
    </Link>
  </Button>
);

export const KESSEN_GAME_NAME = "Kessen";
export const KESSEN_HALL_SUBTITLE = "Best-of-three card duels";

/** A scene shown in the hall's place: its content, its name and the way back. */
export type HallScene = {
  content: React.ReactNode;
  label: string;
  /** The frame's title; "Card Hall", where the way back leads, unless named. */
  title?: string;
  onLeave: () => void;
};
