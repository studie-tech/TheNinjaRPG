"use client";

import { IMG_MANUAL_TOWER_UPGRADES } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { ImageLinkGrid } from "@/layout/ImageLinkGrid";
import Link from "@/layout/Link";

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
      <ImageLinkGrid priority entries={entries}>
        <Link href="/minigames/shinobi-struggle" className="flex flex-col items-center">
          <span
            className="grid h-[125px] w-[125px] place-items-center rounded-2xl border-2 border-amber-300 bg-slate-900 text-6xl text-amber-200 hover:opacity-50"
            aria-hidden="true"
          >
            忍
          </span>
          <p>Shinobi Struggle</p>
        </Link>
      </ImageLinkGrid>
    </ContentBox>
  );
}
