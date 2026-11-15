"use client";

import {
  IMG_MANUAL_TOWER_ENEMIES,
  IMG_MANUAL_TOWER_LEADERBOARD,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { ImageLinkGrid } from "@/layout/ImageLinkGrid";

export default function TowerDefenseManual() {
  return (
    <ContentBox
      title="Tower Defense Manual"
      subtitle="Hold the line for as many waves as you can"
      defaultBackHref="/manual"
    >
      <ImageLinkGrid
        priority
        entries={[
          {
            name: "play",
            label: "Play",
            img: IMG_MANUAL_TOWER_ENEMIES,
            href: "/towerDefense",
          },
          {
            name: "leaderboard",
            label: "Leaderboard",
            img: IMG_MANUAL_TOWER_LEADERBOARD,
            href: "/manual/towerDefense/leaderboard",
          },
        ]}
      />
    </ContentBox>
  );
}
