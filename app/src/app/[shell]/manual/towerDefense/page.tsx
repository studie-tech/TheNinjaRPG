"use client";

import {
  IMG_MANUAL_TOWER_ENEMIES,
  IMG_MANUAL_TOWER_LEADERBOARD,
  IMG_MANUAL_TOWER_UPGRADES,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { ImageLinkGrid } from "@/layout/ImageLinkGrid";
import { canChangeContent } from "@/utils/permissions";
import { useUserDataSelector } from "@/utils/UserContext";

export default function TowerDefenseManual() {
  const { data: userData } = useUserDataSelector((profile) => ({ role: profile.role }));
  const role = userData?.role ?? "USER";
  const canEditContent = canChangeContent(role);

  const entries = [
    {
      name: "leaderboard",
      label: "Leaderboard",
      img: IMG_MANUAL_TOWER_LEADERBOARD,
      public: true,
    },
    {
      name: "characters",
      label: "Characters",
      img: IMG_MANUAL_TOWER_ENEMIES,
      public: false,
    },
    {
      name: "upgrades",
      label: "Upgrades",
      img: IMG_MANUAL_TOWER_UPGRADES,
      public: false,
    },
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
      <ImageLinkGrid
        priority
        entries={visibleEntries
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((page) => ({ ...page, href: `/manual/towerDefense/${page.name}` }))}
      />
    </ContentBox>
  );
}
