import {
  MAP_RESERVED_SECTORS,
  WAR_ESPIONAGE_TARGET,
  WAR_OBJECTIVES_PER_SIDE,
} from "@/drizzle/constants";
import type { SectorType, War } from "@/drizzle/schema";
import { shuffle } from "@/utils/array";
import type { WarObjectiveState, WarRules } from "@/validators/war";

/** Whether the user holds a mercenary appointment in any of the wars. */
export const isWarMercenary = (
  wars: { warMercenaries?: { userId: string }[] }[],
  userId: string,
) => wars.some((war) => war.warMercenaries?.some((m) => m.userId === userId));

/**
 * Resolve the credited village; a mercenary appointment overrides the player's village
 * and excludes participation in other wars. Callers supply accepted, unended memberships,
 * with mercenary contracts from open wars only. User-specific checks require the war ID
 * and complete cross-war assignments from withMercenaryParticipation, or an explicit
 * fetchMercenaryWarId result for a single-war read.
 */
export const getWarSide = (
  activeWar: Pick<War, "attackerVillageId" | "defenderVillageId"> & {
    id?: string;
    warAllies: { villageId: string; supportVillageId: string }[];
    warMercenaries?: { userId: string; sideVillageId: string }[];
    mercenaryWarIds?: Record<string, string>;
  },
  villageId: string | null,
  userId?: string,
  mercenaryWarId?: string | null,
) => {
  const assignedWar =
    mercenaryWarId ?? (userId ? activeWar.mercenaryWarIds?.[userId] : undefined);
  if (assignedWar && "id" in activeWar && activeWar.id !== assignedWar) return null;
  const contract = activeWar.warMercenaries?.find((m) => m.userId === userId);
  if (contract) return contract.sideVillageId;
  if (!villageId) return null;
  if ([activeWar.attackerVillageId, activeWar.defenderVillageId].includes(villageId))
    return villageId;
  return (
    activeWar.warAllies.find((ally) => ally.villageId === villageId)
      ?.supportVillageId ?? null
  );
};

/** Exclude expired and defeated wars even before background settlement finishes. */
export const isObjectiveWarOpen = (
  activeWar: Pick<
    War,
    | "rules"
    | "combatStartedAt"
    | "endedAt"
    | "status"
    | "attackerWarHealth"
    | "defenderWarHealth"
  >,
  now = new Date(),
) =>
  activeWar.status === "ACTIVE" &&
  activeWar.attackerWarHealth > 0 &&
  activeWar.defenderWarHealth > 0 &&
  !activeWar.endedAt &&
  !!activeWar.rules &&
  !!activeWar.combatStartedAt &&
  now.getTime() <
    new Date(activeWar.combatStartedAt).getTime() +
      activeWar.rules.durationDays * 86400000;

/** The notice period permits hiring and anonymity; combat starts at its own deadline. */
export const isObjectiveWarActive = (
  activeWar: Parameters<typeof isObjectiveWarOpen>[0],
  now = new Date(),
) =>
  isObjectiveWarOpen(activeWar, now) &&
  !!activeWar.combatStartedAt &&
  new Date(activeWar.combatStartedAt) <= now;

/**
 * Attach exclusive mercenary assignments and strip contracts from closed wars.
 * Supply every open war with accepted, unended contracts before filtering by viewer
 * or village, so appointments in other wars still exclude native participation.
 */
export const withMercenaryParticipation = <
  T extends War & { warMercenaries?: { userId: string; sideVillageId: string }[] },
>(
  wars: T[],
) => {
  const mercenaryWarIds = Object.fromEntries(
    wars
      .filter((w) => isObjectiveWarOpen(w))
      .flatMap((w) => (w.warMercenaries ?? []).map((m) => [m.userId, w.id])),
  );
  return wars.map((w) => ({
    ...w,
    warMercenaries: isObjectiveWarOpen(w) ? w.warMercenaries : [],
    mercenaryWarIds,
  }));
};

/** Missing progress on legacy wars behaves as an empty espionage counter. */
export const getWarEspionage = (
  activeWar: Pick<War, "objectiveState" | "attackerVillageId">,
  sideVillageId: string,
) =>
  (sideVillageId === activeWar.attackerVillageId
    ? activeWar.objectiveState?.attackerEspionage
    : activeWar.objectiveState?.defenderEspionage) ?? 0;

/** Both sides' objective locations unlock together when the viewing side finishes espionage. */
export const areWarObjectivesRevealed = (
  activeWar: Pick<War, "objectiveState" | "attackerVillageId">,
  sideVillageId: string,
) => getWarEspionage(activeWar, sideVillageId) >= WAR_ESPIONAGE_TARGET;

/**
 * Choose distinct, usable shrines. Ordinary ownership blocks reserve fallback even
 * when those ordinary shrines are destroyed, disputed or temporarily locked.
 */
export const selectWarObjectives = (
  sectors: Pick<
    SectorType,
    "sector" | "villageId" | "boostLockedUntil" | "shrineLevel"
  >[],
  villageId: string,
  homeSector: number,
  rules: WarRules,
  random = Math.random,
  excludedSectors: number[] = [],
): WarObjectiveState[] => {
  const owned = sectors.filter((s) => s.villageId === villageId);
  const ordinary = owned.filter(
    (s) => s.sector !== homeSector && !MAP_RESERVED_SECTORS.includes(s.sector),
  );
  const eligible = (ordinary.length ? ordinary : owned).filter(
    (s) =>
      s.shrineLevel > 0 &&
      !excludedSectors.includes(s.sector) &&
      (!s.boostLockedUntil || new Date(s.boostLockedUntil) <= new Date()),
  );
  const shuffled = shuffle(eligible, (n) => Math.floor(random() * n));
  return shuffled.slice(0, WAR_OBJECTIVES_PER_SIDE).map((s) => ({
    sector: s.sector,
    villageId,
    hp: rules.shrineHp,
    maxHp: rules.shrineHp,
    isReserve: s.sector === homeSector || MAP_RESERVED_SECTORS.includes(s.sector),
    destroyed: false,
  }));
};

/**
 * Return only the viewer's mercenary contract and cross-war assignment. Objective
 * locations require participation and either leader access or completed side espionage.
 */
export const maskWarObjectives = <
  T extends War & {
    warAllies: { villageId: string; supportVillageId: string }[];
    warMercenaries?: { userId: string; sideVillageId: string }[];
    mercenaryWarIds?: Record<string, string>;
  },
>(
  activeWar: T,
  villageId: string | null,
  isLeader: boolean,
  userId?: string,
): T => {
  activeWar = {
    ...activeWar,
    warMercenaries: activeWar.warMercenaries?.filter((m) => m.userId === userId),
    mercenaryWarIds:
      userId && activeWar.mercenaryWarIds?.[userId]
        ? { [userId]: activeWar.mercenaryWarIds[userId] }
        : {},
  };
  if (!activeWar.objectiveState) return activeWar;
  const side = getWarSide(activeWar, villageId, userId);
  if (side && (isLeader || areWarObjectivesRevealed(activeWar, side))) return activeWar;
  return {
    ...activeWar,
    objectiveState: { ...activeWar.objectiveState, objectives: [] },
  };
};

/** War allegiance overrides permanent diplomacy only when both players participate. */
export const getWarRelationship = (
  wars: (War & Parameters<typeof getWarSide>[0])[],
  first: { userId: string; villageId: string | null },
  second: { userId: string; villageId: string | null },
): "ALLY" | "ENEMY" | undefined => {
  for (const activeWar of wars) {
    if (activeWar.rules && !isObjectiveWarActive(activeWar)) continue;
    const firstSide = getWarSide(activeWar, first.villageId, first.userId);
    const secondSide = getWarSide(activeWar, second.villageId, second.userId);
    if (firstSide && secondSide) return firstSide === secondSide ? "ALLY" : "ENEMY";
  }
};
