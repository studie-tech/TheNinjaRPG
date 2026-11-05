import type { WarType } from "@/drizzle/constants";
import {
  FACTION_RAID_MAX_DAYS,
  FACTION_RAID_STRUCTURE_ROUTES,
  FACTION_VILLAGE_TYPES,
  SHRINE_HP_BY_LEVEL,
} from "@/drizzle/constants";
import type { Village, VillageAlliance, VillageStructure, War } from "@/drizzle/schema";
import { getWarRelationship } from "@/libs/objectiveWar";
import type { FetchActiveWarsReturnType } from "@/server/api/routers/war";
import { findRelationship } from "@/utils/alliance";

/**
 * Checks if two players fight on the same side, by the rule combat enforces.
 * Masked war data carries only the viewer's mercenary contract, so a client cannot see
 * another player's; `warRelationship` on sector users already resolves those.
 */
export const isWarAllies = (
  wars: Parameters<typeof getWarRelationship>[0] | null | undefined,
  first: Parameters<typeof getWarRelationship>[1],
  second: Parameters<typeof getWarRelationship>[2],
) => getWarRelationship(wars ?? [], first, second) === "ALLY";

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
  // Checks
  const check1 = ![activeWar.attackerVillageId, activeWar.defenderVillageId].includes(
    joiningVillageId,
  );
  const check2 = [activeWar.attackerVillageId, activeWar.defenderVillageId].includes(
    warringVillageId,
  );
  const check3 = !activeWar.warAllies.some((f) => f.villageId === joiningVillageId);
  const check4 = ["VILLAGE", "HIDEOUT", "STRONGHOLD"].includes(joiningVillage.type);
  const check5 = ["NEUTRAL", "ALLY"].includes(status);
  const check6 = joiningVillage.type !== "VILLAGE" || joiningVillage.allianceSystem;
  const check =
    activeWar.type !== "WAR_RAID" &&
    check1 &&
    check2 &&
    check3 &&
    check4 &&
    check5 &&
    check6;
  // Derived message for each check failing
  let message = activeWar.type === "WAR_RAID" ? "Raids do not accept war allies" : "";
  if (!check1) message = "Cannot join war, already in it";
  if (!check2) message = "Cannot join war, warring village is not in it";
  if (!check3) message = "Cannot join war, faction already in war";
  if (!check4) message = "Cannot join war, not a village/hideout/stronghold";
  if (!check5) message = "Cannot join war with your enemy";
  if (!check6) message = "Cannot join war, not a joinable village/hideout/stronghold";
  // Return
  return { check, message };
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
