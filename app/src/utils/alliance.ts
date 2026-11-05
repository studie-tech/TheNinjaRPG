import {
  type AllianceState,
  RANKS_RESTRICTED_FROM_PVP,
  type UserRank,
  VILLAGE_SYNDICATE_ID,
  WAR_FUNDS_COST,
} from "@/drizzle/constants";
import type { Village, VillageAlliance } from "@/drizzle/schema";

/** Whether a relationship row links the two villages, in either direction. */
export const isVillagePair = (
  relationship: Pick<VillageAlliance, "villageIdA" | "villageIdB">,
  villageIdA: string | null,
  villageIdB: string | null,
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
  villageIdA: string | null,
  villageIdB: string | null,
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
  const relationship = findRelationship(
    relationships,
    userVillageId ?? "syndicate",
    villageData.id,
  );
  return relationship;
};

/**
 * Whether a map user is friendly to the viewer: a target's `allianceStatus` override wins,
 * then a shared village or a formal alliance.
 */
export const isMapUserAlly = (
  viewer:
    | {
        villageId: string | null;
        village?: Parameters<typeof findVillageUserRelationship>[0] | null;
      }
    | null
    | undefined,
  target: { villageId: string | null; allianceStatus?: AllianceState },
) => {
  const relationship =
    viewer?.village && findVillageUserRelationship(viewer.village, target.villageId);
  return (
    target.allianceStatus === "ALLY" ||
    (target.allianceStatus !== "ENEMY" &&
      (target.villageId === viewer?.villageId || relationship?.status === "ALLY"))
  );
};

/** Whether map controls offer an attack: a PvP-eligible rank, and no ally unless opted in. */
export const canShowMapAttack = (
  viewer: Parameters<typeof isMapUserAlly>[0],
  target: Parameters<typeof isMapUserAlly>[1] & { rank: UserRank },
  allyAttack: boolean,
) =>
  !RANKS_RESTRICTED_FROM_PVP.includes(target.rank) &&
  (allyAttack || !isMapUserAlly(viewer, target));

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
  const relationship = findVillageUserRelationship(
    {
      id: villageData.id,
      relationshipA: villageData.relationshipA,
      relationshipB: villageData.relationshipB,
    },
    userVillageId,
  );
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
 * @param requests - The array of UserRequest objects representing the pending alliance requests.
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
    // Cannot ally with someone who is allied with someone we are enemy with
    if (target === "ENEMY" && self === "ALLY") {
      return errorResponse(
        "Cannot ally with someone who is allied with someone we are enemies with",
      );
    }
  }
  return { success: true, message: "OK" };
};

export const canEnemy = (
  relationships: VillageAlliance[],
  villages: Village[],
  villageId: string,
  targetId: string,
) => {
  // Derived
  const relation = findRelationship(relationships, villageId, targetId);
  const senderVillage = villages.find((v) => v.id === villageId);
  // Book keeping
  let message = "OK";
  let success = true;
  const newNeutrals: string[] = [];
  const newEnemies: string[] = [];
  // Guards
  if (!senderVillage) {
    success = false;
    message = "Village not found";
  } else if (villageId === targetId) {
    success = false;
    message = "Cannot be enemy with yourself";
  } else if (relation?.status === "ENEMY") {
    success = false;
    message = "Already an enemy";
  } else if (relation?.status === "ALLY") {
    success = false;
    message = "Cannot be enemy with an ally";
  } else if (senderVillage.tokens < WAR_FUNDS_COST) {
    success = false;
    message = "Insufficient funds";
  } else {
    // Figure out consequences of this war
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
  }
  return { success, message, newNeutrals, newEnemies };
};

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
