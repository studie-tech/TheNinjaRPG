"use client";

import { IMG_MANUAL_TOWER_UPGRADES } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { ImageLinkGrid } from "@/layout/ImageLinkGrid";

export default function MinigamesMain() {
  const entries = [
    {
      name: "Tower Defense",
      href: "/towerDefense",
      img: IMG_MANUAL_TOWER_UPGRADES,
    },
  ];

  return (
    <ContentBox title="Minigames" subtitle="Fun games to play in the ninja world">
      <ImageLinkGrid priority entries={entries} />
    </ContentBox>
  );
}
