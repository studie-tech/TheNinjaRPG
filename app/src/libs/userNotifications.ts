import { KAGE_DEFENSE_REMINDER_HOURS } from "@/drizzle/constants";
import type { NavBarDropdownLink } from "@/libs/menus";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { getKageSetupDeadline } from "@/utils/kage";

/** Derive faction activity notices from the same profile snapshot on server and client. */
export const getUserFactionNotifications = (
  user: UserWithRelations,
  now = new Date(),
): NavBarDropdownLink[] => {
  const notifications: NavBarDropdownLink[] = [];
  // Shrine notifications (use Set to avoid duplicate sectors)
  const userWithRelations = user;
  const shrineDefenseSectors = [
    ...new Set(
      userWithRelations?.shrineBattles
        ?.filter((b) => b.defenderEntityId === user?.villageId)
        .map((b) => b.sector)
        .filter(Boolean) ?? [],
    ),
  ];
  const shrineOffenseSectors = [
    ...new Set(
      userWithRelations?.shrineBattles
        ?.filter((b) => b.attackerEntityId === user?.villageId)
        .map((b) => b.sector)
        .filter(Boolean) ?? [],
    ),
  ];

  if (shrineDefenseSectors.length > 0) {
    notifications.push({
      href: "/travel",
      name: `${shrineDefenseSectors.length > 1 ? "Shrines" : "Shrine"} under attack (${shrineDefenseSectors.length > 1 ? "Sectors" : "Sector"} ${shrineDefenseSectors.join(", ")})`,
      color: "red",
      alwaysShow: true,
    });
  }
  if (shrineOffenseSectors.length > 0) {
    notifications.push({
      href: "/travel",
      name: `We are attacking ${shrineOffenseSectors.length > 1 ? "Shrines" : "Shrine"} (${shrineOffenseSectors.length > 1 ? "Sectors" : "Sector"} ${shrineOffenseSectors.join(", ")})`,
      color: "blue",
      alwaysShow: true,
    });
  }

  // Gather sectors under war attack for this user's village (use Set to avoid duplicate sectors)
  const warDefenseSectors = [
    ...new Set(
      userWithRelations?.activeWars
        ?.filter((w) => {
          const isDefender = w.defenderVillageId === user?.villageId;
          const isDefenderAlly = w.warAllies?.some(
            (a) =>
              a.villageId === user?.villageId &&
              a.supportVillageId === w.defenderVillageId,
          );
          return (isDefender || isDefenderAlly) && w.sector;
        })
        .map((w) => w.sector)
        .filter(Boolean) ?? [],
    ),
  ];

  const warOffenseSectors = [
    ...new Set(
      userWithRelations?.activeWars
        ?.filter((w) => {
          const isAttacker = w.attackerVillageId === user?.villageId;
          const isAttackerAlly = w.warAllies?.some(
            (a) =>
              a.villageId === user?.villageId &&
              a.supportVillageId === w.attackerVillageId,
          );
          return (isAttacker || isAttackerAlly) && w.sector;
        })
        .map((w) => w.sector)
        .filter(Boolean) ?? [],
    ),
  ];

  if (warDefenseSectors.length > 0) {
    notifications.push({
      href: "/travel",
      name: `${warDefenseSectors.length > 1 ? "Sectors" : "Sector"} under attack (${warDefenseSectors.length > 1 ? "Sectors" : "Sector"} ${warDefenseSectors.join(", ")})`,
      color: "red",
      alwaysShow: true,
    });
  }
  if (warOffenseSectors.length > 0) {
    notifications.push({
      href: "/travel",
      name: `We are attacking ${warOffenseSectors.length > 1 ? "Sectors" : "Sector"} (${warOffenseSectors.length > 1 ? "Sectors" : "Sector"} ${warOffenseSectors.join(", ")})`,
      color: "blue",
      alwaysShow: true,
    });
  }

  // Village war / raid notifications (VILLAGE_WAR and WAR_RAID have sector=0)
  const villageWars =
    userWithRelations?.activeWars?.filter(
      (w) =>
        (w.type === "VILLAGE_WAR" || w.type === "WAR_RAID") &&
        (w.attackerVillageId === user?.villageId ||
          w.defenderVillageId === user?.villageId ||
          w.warAllies?.some((a) => a.villageId === user?.villageId)),
    ) ?? [];
  for (const w of villageWars) {
    const isAttacker = w.attackerVillageId === user?.villageId;
    const isDefender = w.defenderVillageId === user?.villageId;
    const isAttackerAlly = w.warAllies?.some(
      (a) =>
        a.villageId === user?.villageId && a.supportVillageId === w.attackerVillageId,
    );
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
      name: "Missing kage schedule!",
      color: isUrgent && !isPaused ? "red" : "blue",
      alwaysShow: true,
    });
  }

  // Raid notifications
  const openRaids =
    userWithRelations?.activeRaids?.filter((r) => r.raidType === "open") ?? [];
  const exclusiveRaids =
    userWithRelations?.activeRaids?.filter((r) => r.raidType === "exclusive") ?? [];

  // Group by sector to avoid duplicate sector mentions
  const openRaidSectors = [...new Set(openRaids.map((r) => r.sector))];
  const exclusiveRaidSectors = [...new Set(exclusiveRaids.map((r) => r.sector))];

  if (openRaidSectors.length > 0) {
    notifications.push({
      href: "/travel",
      name: `Open ${openRaidSectors.length > 1 ? "Raids" : "Raid"} available (${openRaidSectors.length > 1 ? "Sectors" : "Sector"} ${openRaidSectors.join(", ")})`,
      color: "red",
      alwaysShow: true,
    });
  }

  if (exclusiveRaidSectors.length > 0) {
    notifications.push({
      href: "/travel",
      name: `Village ${exclusiveRaidSectors.length > 1 ? "Raids" : "Raid"} active (${exclusiveRaidSectors.length > 1 ? "Sectors" : "Sector"} ${exclusiveRaidSectors.join(", ")})`,
      color: "red",
      alwaysShow: true,
    });
  }

  return notifications;
};
