import {
  type AllianceState,
  CREATOR_USERNAME,
  RANKS_RESTRICTED_FROM_PVP,
  type UserRank,
  type UserStatus,
  VILLAGE_SYNDICATE_ID,
  WAR_FUNDS_COST,
} from "@/drizzle/constants";
import type { Village, VillageAlliance } from "@/drizzle/schema";
import { getWarRelationship } from "@/libs/objectiveWar";

/** Whether a relationship row links the two villages, in either direction. */
export const isVillagePair = (
  relationship: Pick<VillageAlliance, "villageIdA" | "villageIdB">,
  villageIdA?: string | null,
  villageIdB?: string | null,
) =>
  (relationship.villageIdA === villageIdA && relationship.villageIdB === villageIdB) ||
  (relationship.villageIdA === villageIdB && relationship.villageIdB === villageIdA);

/**
 * Retrieves the relationship between two villages from the given array of VillageAlliance objects.
 * @param relationships - An array of VillageAlliance objects representing the relationships between villages.
 * @param villageIdA - The ID of the first village.
 * @param villageIdB - The ID of the second village.
 * @returns The VillageAlliance object representing the relationship between the two villages, or undefined if no relationship is found.
 */
export const findRelationship = (
  relationships: VillageAlliance[],
  villageIdA?: string | null,
  villageIdB?: string | null,
) => {
  return relationships.find((a) => isVillagePair(a, villageIdA, villageIdB));
};

/** A village and its formal allies; empty for a user without a village. */
export const getAlliedVillageIds = (
  relationships: VillageAlliance[],
  villageId: string | null,
): string[] => {
  if (!villageId) return [];
  const allies = relationships
    .filter((a) => a.villageIdA === villageId || a.villageIdB === villageId)
    .filter((a) => a.status === "ALLY")
    .flatMap((a) => [a.villageIdA, a.villageIdB]);
  return [...new Set([villageId, ...allies])];
};

/**
 * Finds the relationship between a village and a user.
 *
 * @param villageData - The village data including the relationships.
 * @param userVillageId - The ID of the user's village.
 * @returns The relationship between the village and the user.
 */
export const findVillageUserRelationship = (
  villageData: {
    id: string | null;
    relationshipA?: VillageAlliance[];
    relationshipB?: VillageAlliance[];
  },
  userVillageId?: string | null,
) => {
  const relationships = [
    ...(villageData.relationshipA ?? []),
    ...(villageData.relationshipB ?? []),
  ];
  return findRelationship(relationships, userVillageId, villageData.id);
};

/**
 * How the map regards a player. A war side wins, as in combat. `warRelationship` from the
 * sector snapshot is the only source for other players' mercenary contracts, so its answer
 * stands, null included; the viewer's war list applies only to targets it did not cover.
 * Otherwise a resolved `allianceStatus`, a shared village, and diplomacy decide.
 */
export const mapAttackRelation = (
  viewer:
    | {
        userId: string;
        villageId: string | null;
        village?: Parameters<typeof getAllyStatus>[0];
      }
    | null
    | undefined,
  target: {
    userId: string;
    villageId: string | null;
    allianceStatus?: AllianceState;
    warRelationship?: "ALLY" | "ENEMY" | null;
  },
  wars: Parameters<typeof getWarRelationship>[0] | null | undefined,
): AllianceState => {
  const warRelationship =
    target.warRelationship === undefined && viewer
      ? getWarRelationship(wars ?? [], viewer, target)
      : target.warRelationship;
  if (warRelationship) return warRelationship;
  if (target.allianceStatus === "ALLY" || target.allianceStatus === "ENEMY") {
    return target.allianceStatus;
  }
  if (!target.villageId) return "NEUTRAL";
  if (target.villageId === viewer?.villageId) return "ALLY";
  return getAllyStatus(viewer?.village, target.villageId);
};

/**
 * Whether map controls offer an attack: an awake, unbanned, PvP-eligible target, and no ally
 * unless opted in. Anyone but the creator themself can challenge the creator, whose attack
 * opens a PvE trial rather than PvP.
 */
export const canShowMapAttack = (
  viewer: Parameters<typeof mapAttackRelation>[0],
  target: Parameters<typeof mapAttackRelation>[1] & {
    rank: UserRank;
    status: UserStatus;
    isBanned?: boolean;
    username?: string;
  },
  allyAttack: boolean,
  wars: Parameters<typeof mapAttackRelation>[2],
) =>
  target.status === "AWAKE" &&
  !target.isBanned &&
  (target.username === CREATOR_USERNAME
    ? viewer?.userId !== target.userId
    : !RANKS_RESTRICTED_FROM_PVP.includes(target.rank) &&
      (allyAttack || mapAttackRelation(viewer, target, wars) !== "ALLY"));

/**
 * Whether ANBU auto-attack engages a player. It takes the map's attack rule without the
 * ally opt-in, and a stored ALLY status keeps a player safe even when a war says enemy.
 * Overworld NPCs share the map list but are fought through the interact flow.
 */
export const isAutoAttackTarget = (
  viewer: NonNullable<Parameters<typeof canShowMapAttack>[0]>,
  target: Parameters<typeof canShowMapAttack>[1] & { level: number; isNpc?: boolean },
  wars: Parameters<typeof canShowMapAttack>[3],
  minLevel: number,
) =>
  !!target.userId &&
  target.userId !== viewer.userId &&
  !target.isNpc &&
  target.username !== CREATOR_USERNAME &&
  target.allianceStatus !== "ALLY" &&
  target.level >= minLevel &&
  canShowMapAttack(viewer, target, false, wars);

/**
 * Finds the relationship status between two villages.
 *
 * @param villageData - The village data including the relationships.
 * @param userVillageId - The ID of the user's village.
 * @returns The relationship between the village and the user.
 */
export const getAllyStatus = (
  villageData?: {
    id: string | null;
    relationshipA?: VillageAlliance[];
    relationshipB?: VillageAlliance[];
  } | null,
  userVillageId?: string | null,
) => {
  // Guard
  if (!villageData) return "NEUTRAL";
  if (villageData.id === userVillageId) return "ALLY";
  if (userVillageId === VILLAGE_SYNDICATE_ID) return "ENEMY";
  if (villageData.id === VILLAGE_SYNDICATE_ID) return "ENEMY";
  if (villageData.relationshipA === undefined) return "NEUTRAL";
  if (villageData.relationshipB === undefined) return "NEUTRAL";
  if (!userVillageId) return "NEUTRAL";
  // Get relationship
  const relationship = findVillageUserRelationship(villageData, userVillageId);
  return relationship?.status ?? "NEUTRAL";
};

/**
 * Creates an error object with a specified error message.
 * @param msg - The error message.
 * @returns An object with a success property set to false and the specified error message.
 */
const errorResponse = (msg: string) => {
  return { success: false, message: msg };
};

/**
 * Checks if alliances can be formed between two villages.
 *
 * @param relationships - The array of VillageAlliance objects representing the existing relationships between villages.
 * @param villages - The array of Village objects representing all the villages.
 * @param villageId - The ID of the village initiating the alliance request.
 * @param targetId - The ID of the village being requested for alliance.
 * @returns An object indicating whether alliances can be formed or not.
 */
export const canAlly = (
  relationships: VillageAlliance[],
  villages: Village[],
  villageId: string,
  targetId: string,
) => {
  // Derived
  const relation = findRelationship(relationships, villageId, targetId);
  // Guards
  if (villageId === targetId) return errorResponse("Cannot ally with yourself");
  if (relation?.status === "ENEMY") return errorResponse("Not when enemy");
  if (relation?.status === "ALLY") return errorResponse("Already allied");
  for (const village of villages) {
    if (village.id === villageId || village.id === targetId) continue;
    const target = findRelationship(relationships, village.id, targetId)?.status;
    const self = findRelationship(relationships, village.id, villageId)?.status;
    // Cannot ally with someone who is allied with someone we are enemy with
    if (target === "ALLY" && self === "ENEMY") {
      return errorResponse(
        "Cannot ally with someone who is allied with someone we are enemies with",
      );
    }
    // Cannot ally with an enemy of one of our allies
    if (target === "ENEMY" && self === "ALLY") {
      return errorResponse("Cannot ally with an enemy of our ally");
    }
  }
  return { success: true, message: "OK" };
};

/** Validate a war declaration from loaded diplomacy state and project the resulting third-party relationships. */
export const canEnemy = (
  relationships: VillageAlliance[],
  villages: Village[],
  villageId: string,
  targetId: string,
) => {
  // Derived
  const relation = findRelationship(relationships, villageId, targetId);
  const senderVillage = villages.find((v) => v.id === villageId);
  // Guards
  if (!senderVillage) return enemyRejection("Village not found");
  if (villageId === targetId) return enemyRejection("Cannot be enemy with yourself");
  if (relation?.status === "ENEMY") return enemyRejection("Already an enemy");
  if (relation?.status === "ALLY")
    return enemyRejection("Cannot be enemy with an ally");
  if (senderVillage.tokens < WAR_FUNDS_COST)
    return enemyRejection("Insufficient funds");
  // Figure out consequences of this war
  const newNeutrals: string[] = [];
  const newEnemies: string[] = [];
  for (const village of villages) {
    if (village.id === villageId || village.id === targetId) continue;
    const target = findRelationship(relationships, village.id, targetId)?.status;
    const self = findRelationship(relationships, village.id, villageId)?.status;
    // Anyone allied with both target and us becomes neutral
    if (target === "ALLY" && self === "ALLY") {
      newNeutrals.push(village.id);
    }
    // Anyone allied with target and not allied with us becomes enemy
    if (target === "ALLY" && self !== "ALLY") {
      newEnemies.push(village.id);
    }
  }
  return { success: true, message: "OK", newNeutrals, newEnemies };
};

/** A refused war declaration, which has no consequences for other villages. */
const enemyRejection = (message: string) => ({
  ...errorResponse(message),
  newNeutrals: [] as string[],
  newEnemies: [] as string[],
});

export const canSurrender = (
  relationships: VillageAlliance[],
  villageId: string,
  targetId: string,
) => {
  // Derived
  const relation = findRelationship(relationships, villageId, targetId);
  // Guards
  if (villageId === targetId) return errorResponse("Cannot surrender to yourself");
  if (relation?.status === "NEUTRAL") return errorResponse("Not an enemy");
  if (relation?.status === "ALLY") return errorResponse("Cannot surrender to ally");
  return { success: true, message: "OK" };
};

/**
 * Calculate the consequences of declaring a village as enemy
 */
export const calculateEnemyConsequences = (
  relationships: VillageAlliance[],
  villages: Village[],
  sourceVillageId: string,
  targetVillageId: string,
) => {
  const enemy = canEnemy(relationships, villages, sourceVillageId, targetVillageId);
  const ally = canAlly(relationships, villages, sourceVillageId, targetVillageId);
  const newEnemies = villages.filter((v) => enemy.newEnemies.includes(v.id));
  const newNeutrals = villages.filter((v) => enemy.newNeutrals.includes(v.id));
  return { newEnemies, newNeutrals, enemy, ally };
};
