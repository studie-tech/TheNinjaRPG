"use client";

import "../kessen.css";
import "./hub.css";
import type React from "react";
import ContentBox from "@/layout/ContentBox";

/**
 * The Card Hall in the game's page frame ("Kessen", with the way back to the minigames),
 * on the content box's own surface in the game's theme, with its section tabs (`tabs`)
 * in the frame's header. An open scene (the table, a pack ceremony) takes the hall's
 * place in the lacquer scene palette, the tabs leave the header and the frame's title
 * leads back to the hall; the hall stays mounted behind, hidden, so the section, its
 * scroll and the control that opened the scene are still there. The subtitle wraps
 * rather than clipping beside the tabs on a phone.
 */
export const HallBox = ({
  children,
  tabs,
  title = KESSEN_GAME_NAME,
  subtitle = KESSEN_HALL_SUBTITLE,
  scene = null,
  backHref = "/minigames",
}: {
  children: React.ReactNode;
  /** The section tabs, in the frame's header. */
  tabs?: React.ReactNode;
  title?: string;
  subtitle?: string;
  scene?: HallScene | null;
  /** Where the frame's back control leads while no scene is open. */
  backHref?: string;
}) => (
  <ContentBox
    title={scene ? "Card Hall" : title}
    subtitle={
      <span className="block whitespace-normal">{scene?.label ?? subtitle}</span>
    }
    defaultBackHref={backHref}
    onBack={scene?.onLeave}
    padding={false}
    topRightContent={scene ? undefined : tabs}
  >
    <div className="kessen-hall kessen-ui">
      {scene ? <div className="kh-scene kessen-scene">{scene.content}</div> : null}
      <div hidden={scene !== null}>
        <div className="kh-hall-inner">{children}</div>
      </div>
    </div>
  </ContentBox>
);

export const KESSEN_GAME_NAME = "Kessen";
export const KESSEN_HALL_SUBTITLE = "Best-of-three card duels";

/** A scene shown in the hall's place: its content, its name and the way back. */
export type HallScene = {
  content: React.ReactNode;
  label: string;
  onLeave: () => void;
};
