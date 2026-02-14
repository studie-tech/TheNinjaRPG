"use client";

import Link from "next/link";
import { IMG_MANUAL_TOWER_UPGRADES } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";

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
      <div className="grid grid-cols-4 gap-4 text-center font-bold">
        {entries.map((page) => (
          <Link key={page.name} href={page.href} className="flex flex-col items-center">
            <Image
              className="rounded-2xl border-2 border-black hover:cursor-pointer hover:opacity-50"
              src={page.img}
              alt={page.name}
              width={125}
              height={125}
              priority={true}
            />
            <p>{page.name}</p>
          </Link>
        ))}
      </div>
    </ContentBox>
  );
}
