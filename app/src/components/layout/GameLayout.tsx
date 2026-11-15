"use client";

import type { ReactNode } from "react";
import { useActiveLayout } from "@/utils/LayoutContext";
import GameLayoutController from "./shared/GameLayoutController";
import type { GameLayoutRenderer } from "./shared/layoutTypes";

/** The game around a page, drawn by one frame's renderer. */
export function GameLayout({
  renderer,
  children,
  initialIsSignedIn,
}: GameFrameProps & { renderer: GameLayoutRenderer }) {
  const id = useActiveLayout();
  return (
    <GameLayoutController
      variant={id}
      renderer={renderer}
      initialIsSignedIn={initialIsSignedIn}
    >
      {children}
    </GameLayoutController>
  );
}

export interface GameFrameProps {
  children: ReactNode;
  initialIsSignedIn: boolean;
}
