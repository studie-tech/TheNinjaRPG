import type { UserRank } from "@/drizzle/constants";
import {
  MAP_RESERVED_SECTORS,
  WAR_ESPIONAGE_TARGET,
  WAR_OBJECTIVES_PER_SIDE,
} from "@/drizzle/constants";
import type { SectorType, War } from "@/drizzle/schema";
import { shuffle } from "@/utils/array";
import { DAY_S } from "@/utils/time";
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
    warAllies?: { villageId: string; supportVillageId: string }[];
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
    activeWar.warAllies?.find((ally) => ally.villageId === villageId)
      ?.supportVillageId ?? null
  );
};

/** The moment a war's combat window closes. */
export const getObjectiveWarDeadline = (
  combatStartedAt: Date,
  rules: Pick<WarRules, "durationDays">,
) => new Date(combatStartedAt).getTime() + rules.durationDays * DAY_S * 1000;

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
  now.getTime() < getObjectiveWarDeadline(activeWar.combatStartedAt, activeWar.rules);

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

/** The war, in any state, that holds an objective on the sector. */
export const findObjectiveWarForSector = <
  T extends Pick<War, "rules" | "objectiveState">,
>(
  wars: T[],
  sector: number | null,
) =>
  wars.find(
    (w) => w.rules && w.objectiveState?.objectives.some((o) => o.sector === sector),
  );

/**
 * The war that lets a player fight at this sector's shrine. Objective wars need a live,
 * revealed, intact enemy objective; sector wars admit attackers only; village wars and
 * raids admit either side at the opposing village. `allowDefend` also admits a side at
 * its own village while its shrine is damaged, restoring shrine HP.
 */
export const findShrineAttackWar = <T extends ShrineWar>(
  wars: T[],
  villageId: string | null,
  userId: string | undefined,
  sector: number,
  { allowDefend = false }: { allowDefend?: boolean } = {},
) =>
  wars.find((w) => {
    if (w.status !== "ACTIVE") return false;
    const side = getWarSide(w, villageId, userId);

    if (w.rules) {
      return (
        !!side &&
        isObjectiveWarActive(w) &&
        areWarObjectivesRevealed(w, side) &&
        !!w.objectiveState?.objectives.some(
          (o) => o.sector === sector && o.villageId !== side && !o.destroyed,
        )
      );
    }

    if (w.type === "SECTOR_WAR") {
      return w.sector === sector && side === w.attackerVillageId;
    }

    const action = getVillageWarShrineAction(w, side, sector);
    return action === "attack" || (allowDefend && action === "defend");
  });

/**
 * What a war side may do at a sector's shrine in a village war or raid: attack the enemy
 * village's shrine, or defend its own while damaged. Rules, status and shrine HP floors
 * belong to the caller; other war types get null.
 */
export const getVillageWarShrineAction = (
  war: VillageWarShrine,
  sideVillageId: string | null | undefined,
  sector: number,
): "attack" | "defend" | null => {
  if (war.type !== "VILLAGE_WAR" && war.type !== "WAR_RAID") return null;
  const isUserOnAttackerSide = sideVillageId === war.attackerVillageId;
  const isUserOnDefenderSide = sideVillageId === war.defenderVillageId;
  const atDefenderVillage = war.defenderVillage?.sector === sector;
  const atAttackerVillage = war.attackerVillage?.sector === sector;
  if (
    (atDefenderVillage && isUserOnAttackerSide) ||
    (atAttackerVillage && isUserOnDefenderSide)
  ) {
    return "attack";
  }
  if (
    (atAttackerVillage &&
      isUserOnAttackerSide &&
      war.attackerShrineHp < war.attackerShrineMaxHp) ||
    (atDefenderVillage &&
      isUserOnDefenderSide &&
      war.defenderShrineHp < war.defenderShrineMaxHp)
  ) {
    return "defend";
  }
  return null;
};

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

/** Elders and the Kage of a viewer's own village read objectives without espionage. */
export const isWarObjectiveLeader = (
  user: { userId: string; rank: UserRank },
  ownVillage: { kageId: string } | null | undefined,
) => user.rank === "ELDER" || ownVillage?.kageId === user.userId;

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

type VillageWarShrine = Pick<
  War,
  | "type"
  | "attackerVillageId"
  | "defenderVillageId"
  | "attackerShrineHp"
  | "attackerShrineMaxHp"
  | "defenderShrineHp"
  | "defenderShrineMaxHp"
> & {
  attackerVillage?: { sector?: number } | null;
  defenderVillage?: { sector?: number } | null;
};

type ShrineWar = Parameters<typeof isObjectiveWarActive>[0] &
  Parameters<typeof getWarSide>[0] &
  VillageWarShrine &
  Pick<War, "objectiveState" | "sector">;
