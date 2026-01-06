"use client";

import Image from "@/layout/Image";
import Link from "next/link";
import {
  IMG_MANUAL_TOWER_UPGRADES,
  IMG_MANUAL_TOWER_ENEMIES,
  IMG_MANUAL_TOWER_LEADERBOARD,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { useUserData } from "@/utils/UserContext";
import { canChangeContent } from "@/utils/permissions";
import Loader from "@/layout/Loader";

export default function TowerDefenseManual() {
  const { data: userData } = useUserData();
  const role = userData?.role ?? "USER";
  const canEditContent = canChangeContent(role);

  if (!userData) return <Loader explanation="Loading user data..." />;

  const entries = [
    { name: "leaderboard", img: IMG_MANUAL_TOWER_LEADERBOARD, public: true },
    { name: "characters", img: IMG_MANUAL_TOWER_ENEMIES, public: false },
    { name: "upgrades", img: IMG_MANUAL_TOWER_UPGRADES, public: false },
  ];

  const visibleEntries = entries.filter((e) => e.public || canEditContent);

  return (
    <ContentBox
      title="Tower Defense Manual"
      subtitle={
        canEditContent ? "Manage tower defense content" : "Tower defense information"
      }
      defaultBackHref="/manual"
    >
      <div className="grid grid-cols-4 gap-4 text-center font-bold">
        {visibleEntries
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((page) => (
            <Link
              key={page.name}
              href={`/manual/towerDefense/${page.name}`}
              className="flex flex-col items-center"
            >
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
