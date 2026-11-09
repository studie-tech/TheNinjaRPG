import { EXCLUSIVE_RAID_DURATION_HOURS } from "@/drizzle/constants";
import type { Quest } from "@/drizzle/schema";
import type { RaidObjectiveType } from "@/validators/objectives";
import { RaidObjective } from "@/validators/objectives";

export const RAID_CHAT_CONVERSATION_PREFIX = "raid-chat-";

export const RAID_CHAT_CONVERSATION_LIKE_PATTERN = `${RAID_CHAT_CONVERSATION_PREFIX}%`;

export const getRaidChatConversationId = (raidId: string) =>
  `${RAID_CHAT_CONVERSATION_PREFIX}${raidId}`;

export const isRaidChatConversationId = (conversationId: string) =>
  conversationId.startsWith(RAID_CHAT_CONVERSATION_PREFIX);

const BATTLE_CLAIM_PREFIX = "claiming-";

/** Matches queue rows whose `battleId` is still a start claim. */
export const BATTLE_CLAIM_LIKE_PATTERN = `${BATTLE_CLAIM_PREFIX}%`;

/** Placeholder `battleId` that reserves a queue while its battle is being initiated. */
export const createBattleClaimId = (nonce: string) => `${BATTLE_CLAIM_PREFIX}${nonce}`;

/** Distinguish an in-flight queue reservation from a published battle ID. */
export const isBattleClaimId = (battleId: string | null | undefined) =>
  battleId?.startsWith(BATTLE_CLAIM_PREFIX) ?? false;

/**
 * Helper to extract raid objective data from a quest.
 * Raid type is implicit from the objective task (open_raid or exclusive_raid).
 * Both raid types have sector for map location.
 */
export const getRaidObjectiveData = (questData: { content: Quest["content"] }) => {
  const objective = questData.content?.objectives?.[0];
  if (!objective) return null;

  const isExclusive = objective.task === "exclusive_raid";
  const isOpen = objective.task === "open_raid";

  if (!isExclusive && !isOpen) return null;

  const parsed = RaidObjective.safeParse(objective);
  if (!parsed.success) return null;

  const typedObjective = parsed.data;
  const opponentAIs = typedObjective.opponentAIs;
  const sector = typedObjective.sector;

  // Get the first AI profile ID from opponentAIs
  const firstAiId = opponentAIs[0]?.ids?.[0] ?? null;

  return {
    isExclusive,
    isOpen,
    raidType: isExclusive ? ("exclusive" as const) : ("open" as const),
    opponentAIs,
    sector,
    firstAiId,
    objective: typedObjective,
  };
};

/**
 * Validates that a raid is currently active and can be interacted with.
 * @param raid - The raid quest to validate
 * @param now - Current date for comparison (optional, defaults to new Date())
 * @returns Object with isValid flag, and the reason and error message when invalid
 */
export const validateRaidIsActive = (
  raid: { raidEndsAt: Date | null; raidBossCurrentHealth: number | null },
  now = new Date(),
):
  | { isValid: true }
  | {
      isValid: false;
      reason: "ended" | "misconfigured" | "defeated";
      error: string;
    } => {
  if (raid.raidEndsAt && raid.raidEndsAt < now) {
    return { isValid: false, reason: "ended", error: "This raid has ended" };
  }
  if (raid.raidBossCurrentHealth === null) {
    return {
      isValid: false,
      reason: "misconfigured",
      error: "This raid is not properly configured (missing boss HP)",
    };
  }
  if (raid.raidBossCurrentHealth <= 0) {
    return {
      isValid: false,
      reason: "defeated",
      error: "The raid boss has been defeated",
    };
  }
  return { isValid: true };
};

/**
 * Exclusive/open listing rules for getAvailableRaids. Only villageId plus
 * precomputed owned/attacker sector sets are required — not a full user row.
 */
export const isRaidListedForVillage = (
  raid: {
    content: Quest["content"];
    raidEndsAt: Date | null;
    raidCaptureDeadline: Date | null;
    raidGracePeriodEnd: Date | null;
  },
  villageId: string | null,
  ownedSectorNumbers: Set<number>,
  attackerDefeatedShrineSectors: Set<number>,
  now: Date,
): boolean => {
  if (raid.raidEndsAt && raid.raidEndsAt < now) {
    return false;
  }

  const raidData = getRaidObjectiveData(raid);
  if (!raidData) return false;
  if (raidData.isOpen) return true;
  if (!villageId || raidData.sector === null) return false;
  if (raidCaptureClosedMessage(raid, now)) return false;
  return (
    ownedSectorNumbers.has(raidData.sector) ||
    attackerDefeatedShrineSectors.has(raidData.sector)
  );
};

/** Why an exclusive raid no longer takes participants, or null within its capture window. */
export const raidCaptureClosedMessage = (
  raid: { raidCaptureDeadline: Date | null; raidGracePeriodEnd: Date | null },
  now: Date,
) => {
  if (!raid.raidCaptureDeadline || raid.raidCaptureDeadline >= now) return null;
  if (!raid.raidGracePeriodEnd) return "This raid's capture deadline has passed";
  if (raid.raidGracePeriodEnd < now) {
    return "This raid's capture deadline and grace period have ended";
  }
  return null;
};

/**
 * Whether an activated raid is running: it has a raidEndsAt still in the future and a
 * living boss. A null raidEndsAt means not activated (exclusive raids get one when their
 * shrine falls), unlike validateRaidIsActive, which treats it as having no end.
 */
export const isRaidCurrentlyActive = (
  raid: { raidEndsAt: Date | null; raidBossCurrentHealth: number | null },
  now = new Date(),
): boolean => {
  if (!raid.raidEndsAt || raid.raidEndsAt <= now) return false;
  if (raid.raidBossCurrentHealth === null || raid.raidBossCurrentHealth <= 0)
    return false;
  return true;
};

/**
 * Filters a list of raids to find exclusive raids for a specific sector.
 * @param raids - List of raid quests to filter
 * @param sector - The sector number to filter by
 * @returns Filtered list of exclusive raids for the sector
 */
export const filterExclusiveRaidsForSector = <T extends { content: Quest["content"] }>(
  raids: T[],
  sector: number,
): T[] => {
  return raids.filter((raid) => {
    const objective = raid.content?.objectives?.[0];
    if (objective?.task !== "exclusive_raid") return false;
    const typedObjective = objective as RaidObjectiveType;
    return typedObjective.sector === sector;
  });
};

/**
 * Finds the first active exclusive raid for a given sector.
 * An active raid has: raidEndsAt in the future AND raidBossCurrentHealth > 0
 * @param raids - List of raid quests to search
 * @param sector - The sector number to find raid for
 * @param now - Current date for comparison (optional)
 * @returns The active exclusive raid or undefined if none found
 */
export const findActiveExclusiveRaidForSector = <
  T extends {
    content: Quest["content"];
    raidEndsAt: Date | null;
    raidBossCurrentHealth: number | null;
  },
>(
  raids: T[],
  sector: number,
  now = new Date(),
): T | undefined => {
  const exclusiveRaids = filterExclusiveRaidsForSector(raids, sector);
  return exclusiveRaids.find((raid) => isRaidCurrentlyActive(raid, now));
};

/**
 * Prepares exclusive raid activation mutations when a sector war shrine is defeated.
 * Uses pre-loaded raid data instead of fetching from DB.
 * Returns mutations to be executed by caller in parallel with other mutations.
 *
 * @param preloadedRaids - Pre-loaded raid quests from battle initiation
 * @param sector - The sector number where the shrine was defeated
 * @returns Object with activated flag and array of mutation data
 */
export const prepareExclusiveRaidActivation = (
  preloadedRaids: Quest[],
  sector: number,
) => {
  const sectorExclusiveRaids = filterExclusiveRaidsForSector(preloadedRaids, sector);

  if (sectorExclusiveRaids.length === 0) {
    return { activated: false, mutations: [] };
  }

  // The activation deadline also identifies each run of this reusable quest.
  const now = new Date();
  const raidEndsAt = new Date(
    now.getTime() + EXCLUSIVE_RAID_DURATION_HOURS * 60 * 60 * 1000,
  );

  return {
    activated: true,
    mutations: sectorExclusiveRaids.map((raid) => ({
      raidId: raid.id,
      raidEndsAt,
      raidCaptureDeadline: raidEndsAt,
      raidBossCurrentHealth: raid.raidBossMaxHealth ?? 0,
    })),
  };
};

export const raidRewardBlockMessage = (
  participation: { damageDealt: number; rewardsClaimed: string[] },
  threshold: { id: string; damageRequired: number },
): string | null => {
  if (participation.damageDealt < threshold.damageRequired)
    return "You have not dealt enough damage to claim this reward";
  if (participation.rewardsClaimed.includes(threshold.id))
    return "You have already claimed this reward";
  return null;
};
