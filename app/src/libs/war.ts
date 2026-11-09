import type { AllianceVillageType, WarState, WarType } from "@/drizzle/constants";
import {
  ALLIANCE_VILLAGE_TYPES,
  FACTION_RAID_MAX_DAYS,
  FACTION_RAID_REWARD,
  FACTION_RAID_STRUCTURE_ROUTES,
  FACTION_VILLAGE_TYPES,
  OBJECTIVE_WAR_ATTACKER_COOLDOWN_DAYS,
  OBJECTIVE_WAR_DEFENDER_COOLDOWN_DAYS,
  SHRINE_HP_BY_LEVEL,
  WAR_ATTACKER_EXHAUSTION_MULTIPLIER,
  WAR_LOSING_COOLDOWN_DAYS,
  WAR_VICTORY_TOKEN_BONUS,
  WAR_WINNING_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import type {
  UserRequest,
  Village,
  VillageAlliance,
  VillageStructure,
  War,
} from "@/drizzle/schema";
import { isObjectiveWarOpen } from "@/libs/objectiveWar";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import { findRelationship } from "@/utils/alliance";
import { DAY_S, secondsFromDate } from "@/utils/time";

/**
 * The cover name a player wears for `viewer`, or null when their identity is public.
 * Open-war mercenaries are hidden from everyone else, and ANBU from other villages. The
 * sector roster and Sensory reveals share it.
 */
export const getMapDisguise = (
  viewer: { userId: string; villageId: string | null },
  target: { userId: string; anbuSquad?: { villageId: string } | null },
  wars: (Parameters<typeof isObjectiveWarOpen>[0] & {
    warMercenaries?: { userId: string }[];
  })[],
) => {
  const isHiredElsewhere =
    target.userId !== viewer.userId &&
    wars.some(
      (war) =>
        isObjectiveWarOpen(war) &&
        war.warMercenaries?.some((mercenary) => mercenary.userId === target.userId),
    );
  if (isHiredElsewhere) return "Mercenary";
  if (target.anbuSquad && target.anbuSquad.villageId !== viewer.villageId) {
    return "ANBU Member";
  }
  return null;
};

/**
 * Checks if a village can join a war
 * @param activeWar - The war to check
 * @param relationships - The relationships between villages
 * @param joiningVillage - The village to join the war
 * @param warringVillage - The village to war against
 * @returns Whether the village can join the war and a message
 */
export const canJoinWar = (
  activeWar: FetchActiveWarsReturnType,
  relationships: VillageAlliance[],
  joiningVillage: Village,
  warringVillage: Village,
) => {
  // Derived
  const joiningVillageId = joiningVillage.id;
  const warringVillageId = warringVillage.id;
  const relationship = findRelationship(
    relationships,
    joiningVillageId,
    warringVillageId,
  );
  const status = relationship?.status || "NEUTRAL";
  const warVillageIds = [activeWar.attackerVillageId, activeWar.defenderVillageId];
  // The first failure is the message a player sees.
  const failure = [
    {
      ok: joiningVillage.type !== "VILLAGE" || joiningVillage.allianceSystem,
      message: "Cannot join war, not a joinable village/hideout/stronghold",
    },
    {
      ok: ["NEUTRAL", "ALLY"].includes(status),
      message: "Cannot join war with your enemy",
    },
    {
      ok: ALLIANCE_VILLAGE_TYPES.includes(joiningVillage.type as AllianceVillageType),
      message: "Cannot join war, not a village/hideout/stronghold",
    },
    {
      ok: !activeWar.warAllies.some((f) => f.villageId === joiningVillageId),
      message: "Cannot join war, faction already in war",
    },
    {
      ok: warVillageIds.includes(warringVillageId),
      message: "Cannot join war, warring village is not in it",
    },
    {
      ok: !warVillageIds.includes(joiningVillageId),
      message: "Cannot join war, already in it",
    },
    { ok: activeWar.type !== "WAR_RAID", message: "Raids do not accept war allies" },
  ].find((requirement) => !requirement.ok);
  return { check: !failure, message: failure?.message ?? "" };
};

/**
 * Get the shrine hp for a given level
 * @param level - The level of the shrine
 * @returns The shrine hp
 */
export const getShrineHpByLevel = (level?: number | null): number =>
  SHRINE_HP_BY_LEVEL[level as keyof typeof SHRINE_HP_BY_LEVEL] ?? SHRINE_HP_BY_LEVEL[1];

/**
 * Checks if a village is involved in any active war (as attacker, defender, or ally)
 * @param activeWars - Array of active wars to check against
 * @param villageId - The village ID to check
 * @param excludeWarId - Optional war ID to exclude from the check
 * @param types - Optional array of war types to check for
 * @returns true if the village is involved in any active war, false otherwise
 */
export const isVillageInvolvedInAnyWar = (
  activeWars: (Pick<
    FetchActiveWarsReturnType,
    "attackerVillageId" | "defenderVillageId"
  > &
    Partial<Pick<FetchActiveWarsReturnType, "id" | "type">> & {
      warAllies: { villageId: string }[];
    })[],
  villageId: string,
  excludeWarId?: string,
  types?: readonly WarType[],
): boolean => {
  return activeWars.some((war) => {
    // Skip the excluded war if provided
    if (excludeWarId && war.id === excludeWarId) {
      return false;
    }

    // Skip if types are provided and war type is not in them
    if (types && (!war.type || !types.includes(war.type))) {
      return false;
    }

    // Check if village is attacker or defender
    if (war.attackerVillageId === villageId || war.defenderVillageId === villageId) {
      return true;
    }

    // Check if village is an ally in the war
    return war.warAllies.some((ally) => ally.villageId === villageId);
  });
};

/**
 * Whether a village is a faction's hideout or stronghold rather than a village with elders
 */
export const isFactionVillage = (target: Pick<Village, "type">) =>
  FACTION_VILLAGE_TYPES.some((type) => type === target.type);

/** End a raid when either structure is defeated or its two-day deadline is reached. */
export const shouldEndRaid = (
  raid: Pick<War, "startedAt" | "attackerWarHealth" | "defenderWarHealth">,
  now = new Date(),
) =>
  raid.attackerWarHealth <= 0 ||
  raid.defenderWarHealth <= 0 ||
  now.getTime() - raid.startedAt.getTime() >= FACTION_RAID_MAX_DAYS * 86400_000;

/** Who won a closing war, what the winners earn and when each side may fight again. */
export const computeWarOutcome = (
  current: FetchActiveWarsReturnType,
  losingVillageId: string | undefined,
  options: { shrineBuilderId?: string },
  endedAt: Date,
) => {
  const isRaid = current.type === "WAR_RAID";
  const attackerLost =
    losingVillageId === current.attackerVillageId ||
    (!isRaid && !current.rules && current.attackerVillage.tokens <= 0) ||
    current.attackerWarHealth <= 0;
  const defenderLost =
    !!options.shrineBuilderId ||
    losingVillageId === current.defenderVillageId ||
    (!isRaid && !current.rules && current.defenderVillage.tokens <= 0) ||
    current.defenderWarHealth <= 0;
  const isDraw =
    !isRaid &&
    ((attackerLost && defenderLost) ||
      (!attackerLost &&
        !defenderLost &&
        current.attackerWarHealth === current.defenderWarHealth));
  const winnerId = isRaid
    ? defenderLost && !attackerLost
      ? current.attackerVillageId
      : current.defenderVillageId
    : (attackerLost && !defenderLost) ||
        (!attackerLost &&
          !defenderLost &&
          current.attackerWarHealth < current.defenderWarHealth)
      ? current.defenderVillageId
      : current.attackerVillageId;
  const loserId =
    winnerId === current.attackerVillageId
      ? current.defenderVillageId
      : current.attackerVillageId;
  const status: WarState = isDraw
    ? "DRAW"
    : winnerId === current.attackerVillageId
      ? "ATTACKER_VICTORY"
      : "DEFENDER_VICTORY";
  const winningVillageIds = isRaid
    ? [winnerId]
    : isDraw
      ? []
      : [
          ...new Set([
            winnerId,
            ...current.warAllies
              .filter((ally) => ally.supportVillageId === winnerId)
              .map((ally) => ally.villageId),
          ]),
        ].sort();
  const share = isRaid
    ? winnerId === current.attackerVillageId
      ? FACTION_RAID_REWARD
      : 0
    : winningVillageIds.length
      ? Math.floor(WAR_VICTORY_TOKEN_BONUS / winningVillageIds.length)
      : 0;
  const winnerTokens =
    share +
    (!isRaid && winningVillageIds.length
      ? WAR_VICTORY_TOKEN_BONUS % winningVillageIds.length
      : 0);
  const attackerCooldown = current.rules
    ? secondsFromDate(
        (status === "ATTACKER_VICTORY"
          ? WAR_WINNING_COOLDOWN_DAYS
          : OBJECTIVE_WAR_ATTACKER_COOLDOWN_DAYS) * DAY_S,
        endedAt,
      )
    : secondsFromDate(
        (status === "ATTACKER_VICTORY"
          ? WAR_WINNING_COOLDOWN_DAYS
          : WAR_LOSING_COOLDOWN_DAYS) *
          DAY_S *
          WAR_ATTACKER_EXHAUSTION_MULTIPLIER,
        endedAt,
      );
  const defenderCooldown = current.rules
    ? secondsFromDate(
        (status === "DEFENDER_VICTORY"
          ? WAR_WINNING_COOLDOWN_DAYS
          : OBJECTIVE_WAR_DEFENDER_COOLDOWN_DAYS) * DAY_S,
        endedAt,
      )
    : secondsFromDate(
        (status === "DEFENDER_VICTORY"
          ? WAR_WINNING_COOLDOWN_DAYS
          : WAR_LOSING_COOLDOWN_DAYS) * DAY_S,
        endedAt,
      );
  return {
    isDraw,
    winnerId,
    loserId,
    status,
    winningVillageIds,
    share,
    winnerTokens,
    attackerCooldown,
    defenderCooldown,
  };
};

/**
 * Return the first user-facing structure or cooldown rejection, or undefined if eligible.
 * Shared by the options preview and the authoritative declaration guards.
 */
export const getRaidDeclarationBlock = (
  attacker: Pick<Village, "raidRetryCooldowns">,
  attackerStructures: VillageStructure[],
  targetStructures: VillageStructure[],
  targetId: string,
  route: string,
  now = new Date(),
): string | undefined => {
  if (!(FACTION_RAID_STRUCTURE_ROUTES as readonly string[]).includes(route))
    return "Select a raid-eligible structure";
  const own = attackerStructures.find((s) => s.route === route);
  const target = targetStructures.find((s) => s.route === route);
  if (!own || own.level <= 0) return "Your faction must have the matching structure";
  if (!target || target.level <= 0) return "Target structure is unavailable";
  if (own.raidBoostExpiresAt && new Date(own.raidBoostExpiresAt) > now)
    return "Your faction already has an active raid bonus for this structure";
  if (target.raidProtectedUntil && new Date(target.raidProtectedUntil) > now)
    return `Target structure is protected until ${new Date(target.raidProtectedUntil).toUTCString()}`;
  const retryUntil = attacker.raidRetryCooldowns[targetId];
  if (retryUntil && new Date(retryUntil) > now)
    return `Raids against this settlement are on cooldown until ${new Date(retryUntil).toUTCString()}`;
};

/** Whether a village war card lists this ally offer. */
export const isOfferForWarCard = (
  offer: Pick<UserRequest, "relatedId" | "status">,
  warId: string,
) => offer.relatedId === warId && offer.status !== "ACCEPTED";
