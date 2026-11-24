"use client";

import ContentBox from "@/layout/ContentBox";
import { MinigameGrid } from "@/layout/MinigameGrid";

/** Wake Island's Minigames building: every minigame, as in the manual's section. */
export function MinigamesScreen() {
  return (
    <ContentBox title="Minigames" subtitle="Fun games to play in the ninja world">
      <MinigameGrid priority />
    </ContentBox>
  );
}
