import { KAGE_DEFENSE_REMINDER_HOURS } from "@/drizzle/constants";
import type { NavBarDropdownLink } from "@/libs/menus";
import { getWarSide } from "@/libs/objectiveWar";
import { isTutorialActive } from "@/libs/tutorial";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { getKageSetupDeadline } from "@/utils/kage";

/** Sidebar warning for a player whose active jutsu loadout is empty. */
export const NO_JUTSU_EQUIPPED_NOTIFICATION: NavBarDropdownLink = {
  href: "/jutsus",
  name: "No jutsu equipped!",
  color: "red",
};

/**
 * Warn a player whose active jutsu loadout is empty, so they don't walk into a fight
 * with basic actions only. Skipped for AI, players without a loadout yet, and
 * players still in the tutorial.
 */
export const getNoJutsuEquippedNotifications = (
  user:
    | {
        isAi: boolean;
        tutorialOn?: boolean | null;
        tutorialStep?: number | null;
        loadout?: { jutsuIds: string[] } | null;
      }
    | null
    | undefined,
): NavBarDropdownLink[] =>
  user &&
  !user.isAi &&
  user.loadout &&
  user.loadout.jutsuIds.length === 0 &&
  !isTutorialActive(user)
    ? [NO_JUTSU_EQUIPPED_NOTIFICATION]
    : [];

/** Derive faction activity notices from the same profile snapshot on server and client. */
export const getUserFactionNotifications = (
  user: UserWithRelations,
  now = new Date(),
): NavBarDropdownLink[] => {
  const notifications: NavBarDropdownLink[] = [];
  const warSideOf = (war: Parameters<typeof getWarSide>[0]) =>
    getWarSide(war, user?.villageId ?? null);

  // Shrine notifications
  const shrineDefenseSectors = activeSectors(
    user?.shrineBattles,
    (b) => b.defenderEntityId === user?.villageId,
  );
  const shrineOffenseSectors = activeSectors(
    user?.shrineBattles,
    (b) => b.attackerEntityId === user?.villageId,
  );

  if (shrineDefenseSectors.length > 0) {
    notifications.push({
      href: "/travel",
      name: `${pluralize("Shrine", shrineDefenseSectors)} under attack (${sectorList(shrineDefenseSectors)})`,
      color: "red",
      alwaysShow: true,
    });
  }
  if (shrineOffenseSectors.length > 0) {
    notifications.push({
      href: "/travel",
      name: `We are attacking ${pluralize("Shrine", shrineOffenseSectors)} (${sectorList(shrineOffenseSectors)})`,
      color: "blue",
      alwaysShow: true,
    });
  }

  // Gather sectors under war attack for this user's village
  const warDefenseSectors = activeSectors(
    user?.activeWars,
    (w) => warSideOf(w) === w.defenderVillageId,
  );
  const warOffenseSectors = activeSectors(
    user?.activeWars,
    (w) => warSideOf(w) === w.attackerVillageId,
  );

  if (warDefenseSectors.length > 0) {
    notifications.push({
      href: "/travel",
      name: `${pluralize("Sector", warDefenseSectors)} under attack (${sectorList(warDefenseSectors)})`,
      color: "red",
      alwaysShow: true,
    });
  }
  if (warOffenseSectors.length > 0) {
    notifications.push({
      href: "/travel",
      name: `We are attacking ${pluralize("Sector", warOffenseSectors)} (${sectorList(warOffenseSectors)})`,
      color: "blue",
      alwaysShow: true,
    });
  }

  // Village war / raid notifications (VILLAGE_WAR and WAR_RAID have sector=0)
  const villageWars =
    user?.activeWars?.filter(
      (w) => (w.type === "VILLAGE_WAR" || w.type === "WAR_RAID") && !!warSideOf(w),
    ) ?? [];
  for (const w of villageWars) {
    const isAttacker = w.attackerVillageId === user?.villageId;
    const isDefender = w.defenderVillageId === user?.villageId;
    const isAttackerAlly = warSideOf(w) === w.attackerVillageId;
    const defenderName = w.defenderVillage?.name ?? "another village";
    const attackerName = w.attackerVillage?.name ?? "another village";
    const label = isAttacker
      ? `At war: attacking ${defenderName}`
      : isDefender
        ? `At war: defending vs ${attackerName}`
        : isAttackerAlly
          ? `Supporting ${attackerName} attacking ${defenderName}`
          : `Supporting ${defenderName} defending vs ${attackerName}`;
    notifications.push({
      href: "/townhall",
      name: label,
      color: "red",
      alwaysShow: true,
    });
  }

  // Remind the incumbent for the whole publication window; missing it removes the title.
  const kageVillage = user?.village;
  const setupDeadline =
    user &&
    !user.isAi &&
    kageVillage?.type === "VILLAGE" &&
    kageVillage.kageId === user.userId
      ? getKageSetupDeadline(kageVillage)
      : null;
  if (setupDeadline) {
    const isPaused =
      kageVillage?.kageSchedule?.kageId === user?.userId &&
      !!kageVillage?.kageSchedule?.paused;
    const isUrgent =
      setupDeadline.getTime() - now.getTime() <= KAGE_DEFENSE_REMINDER_HOURS * 3600_000;
    notifications.push({
      href: "/townhall",
      name: "Missing schedule",
      color: isUrgent && !isPaused ? "red" : "blue",
      alwaysShow: true,
    });
  }

  // Raid notifications. Raids are opportunities to join, not threats, so they use the
  // informational colour and leave red (and the red badge) to attacks and blocking states.
  const openRaids = user?.activeRaids?.filter((r) => r.raidType === "open") ?? [];
  const exclusiveRaids =
    user?.activeRaids?.filter((r) => r.raidType === "exclusive") ?? [];

  // Group by sector to avoid duplicate sector mentions
  const openRaidSectors = [...new Set(openRaids.map((r) => r.sector))];
  const exclusiveRaidSectors = [...new Set(exclusiveRaids.map((r) => r.sector))];

  if (openRaidSectors.length > 0) {
    notifications.push({
      href: "/travel",
      name: `${pluralize("Raid", openRaidSectors)} (${sectorList(openRaidSectors)})`,
      color: "blue",
      alwaysShow: true,
    });
  }

  if (exclusiveRaidSectors.length > 0) {
    notifications.push({
      href: "/travel",
      name: `Village ${pluralize("Raid", exclusiveRaidSectors)} active (${sectorList(exclusiveRaidSectors)})`,
      color: "blue",
      alwaysShow: true,
    });
  }

  return notifications;
};

/** Distinct sectors of the matching rows. Sector 0 means the row has no map sector. */
const activeSectors = <Row extends { sector: number | null }>(
  rows: Row[] | undefined,
  isIncluded: (row: Row) => boolean,
) => [
  ...new Set(
    rows
      ?.filter(isIncluded)
      .map((row) => row.sector)
      .filter(Boolean) ?? [],
  ),
];

/** Name the noun in the plural when several sectors are listed. */
const pluralize = (noun: string, sectors: unknown[]) =>
  sectors.length > 1 ? `${noun}s` : noun;

/** Label a sector listing, e.g. "Sector 4" or "Sectors 4, 5". */
const sectorList = (sectors: unknown[]) =>
  `${pluralize("Sector", sectors)} ${sectors.join(", ")}`;
