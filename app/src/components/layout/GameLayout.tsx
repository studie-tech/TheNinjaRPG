"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import {
  type GameLayout as GameLayoutDefinition,
  getGameLayout,
} from "@/libs/gameLayouts";
import { useActiveLayout } from "@/utils/LayoutContext";
import GameLayoutController from "./shared/GameLayoutController";
import type { GameLayoutRenderer } from "./shared/layoutTypes";

// One chunk per frame, so a layout downloads only its own; LayoutSwitcher defers a
// change of layout until the next frame has loaded.
const ClassicGameLayout = dynamic(() =>
  import("./ClassicGameLayout").then((module) => module.ClassicGameLayout),
);
const PixelGameLayout = dynamic(() =>
  import("./PixelGameLayout").then((module) => module.PixelGameLayout),
);
const PanelGameLayout = dynamic(() =>
  import("./PanelGameLayout").then((module) => module.PanelGameLayout),
);

const GAME_FRAMES = {
  classic: ClassicGameLayout,
  pixel: PixelGameLayout,
  panel: PanelGameLayout,
} satisfies Record<GameLayoutDefinition["frame"], GameLayoutRenderer>;

export function GameLayout({
  children,
  initialIsSignedIn,
}: {
  children: ReactNode;
  initialIsSignedIn: boolean;
}) {
  const id = useActiveLayout();
  return (
    <GameLayoutController
      variant={id}
      renderer={GAME_FRAMES[getGameLayout(id).frame]}
      initialIsSignedIn={initialIsSignedIn}
    >
      {children}
    </GameLayoutController>
  );
}
