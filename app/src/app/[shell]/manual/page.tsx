"use client";

import {
  IMG_MANUAL_ACTIVITY_STREAK,
  IMG_MANUAL_AI,
  IMG_MANUAL_ASSET,
  IMG_MANUAL_AWARDS,
  IMG_MANUAL_BACKUP,
  IMG_MANUAL_BADGE,
  IMG_MANUAL_BALANCE,
  IMG_MANUAL_BLOODLINE,
  IMG_MANUAL_BLOODRIGHT,
  IMG_MANUAL_COMBAT,
  IMG_MANUAL_CRAFTING_RECIPES,
  IMG_MANUAL_DAM_CALCS,
  IMG_MANUAL_DUNGEON,
  IMG_MANUAL_HUNTING,
  IMG_MANUAL_ITEM,
  IMG_MANUAL_JUTSU,
  IMG_MANUAL_LOGS,
  IMG_MANUAL_OPINION,
  IMG_MANUAL_PET_SPECIES,
  IMG_MANUAL_POLLS,
  IMG_MANUAL_QUEST,
  IMG_MANUAL_RANKED,
  IMG_MANUAL_RECRUITMENT,
  IMG_MANUAL_REVIEW,
  IMG_MANUAL_REWARDS,
  IMG_MANUAL_SAGE_MODE,
  IMG_MANUAL_SKILLTREE,
  IMG_MANUAL_STAFF,
  IMG_MANUAL_TITLE,
  IMG_MANUAL_TOURNAMENTS,
  IMG_MANUAL_TOWER_UPGRADES,
  IMG_MANUAL_TRAVEL,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import { ImageLinkGrid } from "@/layout/ImageLinkGrid";
import Link from "@/layout/Link";
import {
  canChangeContent,
  canControlBackups,
  canManageTournaments,
  canViewRecruitmentAnalytics,
  isStaffRole,
} from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";

/** Render the content catalog and additional management links permitted by the user's role. */
export default function ManualMain() {
  const { data: userData } = useUserData();
  const role = userData?.role ?? "USER";
  const canEditContent = canChangeContent(role);
  const isStaff = isStaffRole(role);

  const entries = [
    {
      name: "tournaments",
      img: IMG_MANUAL_TOURNAMENTS,
      visible: canManageTournaments(role),
    },
    { name: "combat", img: IMG_MANUAL_COMBAT },
    { name: "bloodline", img: IMG_MANUAL_BLOODLINE },
    { name: "sageMode", img: IMG_MANUAL_SAGE_MODE },
    { name: "jutsu", img: IMG_MANUAL_JUTSU },
    { name: "skillTree", img: IMG_MANUAL_SKILLTREE },
    { name: "bloodright", img: IMG_MANUAL_BLOODRIGHT },
    { name: "item", img: IMG_MANUAL_ITEM },
    { name: "crafting_recipes", img: IMG_MANUAL_CRAFTING_RECIPES },
    { name: "ai", img: IMG_MANUAL_AI },
    { name: "companions", img: IMG_MANUAL_PET_SPECIES },
    { name: "quest", img: IMG_MANUAL_QUEST },
    { name: "dungeon", img: IMG_MANUAL_DUNGEON, visible: canEditContent },
    { name: "hunting", img: IMG_MANUAL_HUNTING, visible: canEditContent },
    { name: "logs", img: IMG_MANUAL_LOGS },
    { name: "damage_calcs", img: IMG_MANUAL_DAM_CALCS },
    { name: "badge", img: IMG_MANUAL_BADGE },
    { name: "title", img: IMG_MANUAL_TITLE },
    { name: "asset", img: IMG_MANUAL_ASSET },
    { name: "opinions", img: IMG_MANUAL_OPINION },
    { name: "awards", img: IMG_MANUAL_AWARDS },
    { name: "polls", img: IMG_MANUAL_POLLS },
    { name: "pvp_rank", img: IMG_MANUAL_RANKED },
    { name: "balance", img: IMG_MANUAL_BALANCE },
    { name: "staff", img: IMG_MANUAL_STAFF },
    { name: "towerDefense", img: IMG_MANUAL_TOWER_UPGRADES },
    { name: "activityStreak", img: IMG_MANUAL_ACTIVITY_STREAK },
    { name: "world", img: IMG_MANUAL_TRAVEL, visible: canEditContent },
    { name: "sprite_studio", img: IMG_MANUAL_ASSET, visible: canEditContent },
    {
      name: "recruitment",
      img: IMG_MANUAL_RECRUITMENT,
      visible: canViewRecruitmentAnalytics(role),
    },
    {
      name: "content_backups",
      img: IMG_MANUAL_BACKUP,
      visible: canControlBackups(role),
    },
    // Staff suggest content changes here; content staff review them.
    { name: "review", img: IMG_MANUAL_REVIEW, visible: isStaff },
    { name: "rewards", img: IMG_MANUAL_REWARDS, visible: isStaff },
    { name: "resource_silos", img: IMG_MANUAL_REWARDS, visible: isStaff },
  ];

  return (
    <>
      <ContentBox title="Player Guide" subtitle="How to play TheNinja-RPG">
        <p>
          New to Seichi? Start with the official{" "}
          <Link
            href="/guide"
            className="font-bold text-orange-500 hover:text-orange-700"
          >
            player guide
          </Link>{" "}
          for getting started, combat, farming, bloodlines and ranks. The cards below
          are the game-data encyclopedia.
        </p>
      </ContentBox>
      <ContentBox
        title="Game Data & Manual"
        subtitle="Look up jutsu, items, bloodlines and tools"
        initialBreak={true}
        alreadyHasH1={true}
      >
        <ImageLinkGrid
          entries={entries
            .filter((page) => page.visible ?? true)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(({ name, img }) => ({
              name: name === "resource_silos" ? "Resource Silos" : name,
              img,
              href: `/manual/${name}`,
            }))}
        />
      </ContentBox>
    </>
  );
}
