"use client";

import { IMG_MANUAL_TOWER_UPGRADES } from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Image from "@/layout/Image";
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
        <Link href="/minigames/shinobi-struggle" className="flex flex-col items-center">
          <span
            className="grid h-[125px] w-[125px] place-items-center rounded-2xl border-2 border-amber-300 bg-slate-900 text-6xl text-amber-200 hover:opacity-50"
            aria-hidden="true"
          >
            忍
          </span>
          <p>Shinobi Struggle</p>
        </Link>
      </div>
    </ContentBox>
  );
}
