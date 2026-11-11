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

  // Player pages; staff tools carry the permission check that shows them.
  const entries: ManualEntry[] = [
    { name: "combat", label: "Combat", img: IMG_MANUAL_COMBAT },
    { name: "bloodline", label: "Bloodlines", img: IMG_MANUAL_BLOODLINE },
    { name: "sageMode", label: "Sage Modes", img: IMG_MANUAL_SAGE_MODE },
    { name: "jutsu", label: "Jutsu", img: IMG_MANUAL_JUTSU },
    { name: "skillTree", label: "Skill Trees", img: IMG_MANUAL_SKILLTREE },
    { name: "bloodright", label: "Bloodrights", img: IMG_MANUAL_BLOODRIGHT },
    { name: "item", label: "Items", img: IMG_MANUAL_ITEM },
    {
      name: "crafting_recipes",
      label: "Crafting Recipes",
      img: IMG_MANUAL_CRAFTING_RECIPES,
    },
    { name: "ai", label: "AI Opponents", img: IMG_MANUAL_AI },
    { name: "companions", label: "Companions", img: IMG_MANUAL_PET_SPECIES },
    { name: "quest", label: "Quests", img: IMG_MANUAL_QUEST },
    { name: "logs", label: "Content Log", img: IMG_MANUAL_LOGS },
    { name: "damage_calcs", label: "Damage Calculator", img: IMG_MANUAL_DAM_CALCS },
    { name: "badge", label: "Badges", img: IMG_MANUAL_BADGE },
    { name: "title", label: "Titles", img: IMG_MANUAL_TITLE },
    { name: "asset", label: "Game Assets", img: IMG_MANUAL_ASSET },
    { name: "opinions", label: "Opinions", img: IMG_MANUAL_OPINION },
    { name: "awards", label: "User Rewards", img: IMG_MANUAL_AWARDS },
    { name: "polls", label: "Polls", img: IMG_MANUAL_POLLS },
    { name: "pvp_rank", label: "Ranked PvP", img: IMG_MANUAL_RANKED },
    { name: "balance", label: "Balance Data", img: IMG_MANUAL_BALANCE },
    { name: "staff", label: "Staff", img: IMG_MANUAL_STAFF },
    { name: "towerDefense", label: "Tower Defense", img: IMG_MANUAL_TOWER_UPGRADES },
    {
      name: "activityStreak",
      label: "Activity Streaks",
      img: IMG_MANUAL_ACTIVITY_STREAK,
    },
    {
      name: "tournaments",
      label: "Tournaments",
      img: IMG_MANUAL_TOURNAMENTS,
      visible: canManageTournaments(role),
    },
    {
      name: "dungeon",
      label: "Dungeons",
      img: IMG_MANUAL_DUNGEON,
      visible: canEditContent,
    },
    {
      name: "hunting",
      label: "Hunting",
      img: IMG_MANUAL_HUNTING,
      visible: canEditContent,
    },
    {
      name: "world",
      label: "World Maps",
      img: IMG_MANUAL_TRAVEL,
      visible: canEditContent,
    },
    {
      name: "sprite_studio",
      label: "Sprite Studio",
      img: IMG_MANUAL_ASSET,
      visible: canEditContent,
    },
    {
      name: "recruitment",
      label: "Recruitment",
      img: IMG_MANUAL_RECRUITMENT,
      visible: canViewRecruitmentAnalytics(role),
    },
    {
      name: "content_backups",
      label: "Backups & Sync",
      img: IMG_MANUAL_BACKUP,
      visible: canControlBackups(role),
    },
    // Staff suggest content changes here; content staff review them.
    {
      name: "review",
      label: "Content Review",
      img: IMG_MANUAL_REVIEW,
      visible: isStaff,
    },
    { name: "rewards", label: "Rewards", img: IMG_MANUAL_REWARDS, visible: isStaff },
  ];
  const toTiles = (pages: ManualEntry[]) =>
    pages
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(({ name, label, img }) => ({ name, label, img, href: `/manual/${name}` }));
  const playerTiles = toTiles(entries.filter((page) => page.visible === undefined));
  const staffTiles = toTiles(entries.filter((page) => page.visible === true));

  return (
    <>
      <ContentBox title="Manual" subtitle="Player guide and game data">
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
        <ImageLinkGrid entries={playerTiles} />
      </ContentBox>
      {staffTiles.length > 0 && (
        <ContentBox
          title="Staff tools"
          subtitle="Content, moderation and operations tools for your role"
          initialBreak={true}
        >
          <ImageLinkGrid entries={staffTiles} />
        </ContentBox>
      )}
    </>
  );
}

/** A hub tile; `visible` marks a staff tool and holds its permission check. */
type ManualEntry = { name: string; label: string; img: string; visible?: boolean };
