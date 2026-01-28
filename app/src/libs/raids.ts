import type { Quest } from "@/drizzle/schema";
import { RaidObjective } from "@/validators/objectives";
import type { RaidObjectiveType } from "@/validators/objectives";

/**
 * Helper to extract raid objective data from a quest.
 * Raid type is implicit from the objective task (open_raid or exclusive_raid).
 * Both raid types have sector for map location.
 */
export const getRaidObjectiveData = (questData: Quest) => {
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
  };
};

/**
 * Validates that a raid is currently active and can be interacted with.
 * @param raid - The raid quest to validate
 * @param now - Current date for comparison (optional, defaults to new Date())
 * @returns Object with isValid flag and optional error message
 */
export const validateRaidIsActive = (
  raid: { raidEndsAt: Date | null; raidBossCurrentHealth: number | null },
  now = new Date(),
): { isValid: true } | { isValid: false; error: string } => {
  if (raid.raidEndsAt && raid.raidEndsAt < now) {
    return { isValid: false, error: "This raid has ended" };
  }
  if (raid.raidBossCurrentHealth === null) {
    return {
      isValid: false,
      error: "This raid is not properly configured (missing boss HP)",
    };
  }
  if (raid.raidBossCurrentHealth <= 0) {
    return { isValid: false, error: "The raid boss has been defeated" };
  }
  return { isValid: true };
};

/**
 * Simple boolean check if a raid is currently active (has time remaining and boss is alive).
 * Use this for filtering/conditional logic. Use validateRaidIsActive for error messages.
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

  // Calculate raid time limits (24 hours from now)
  const now = new Date();
  const raidEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const raidCaptureDeadline = raidEndsAt;

  return {
    activated: true,
    mutations: sectorExclusiveRaids.map((raid) => ({
      raidId: raid.id,
      raidEndsAt,
      raidCaptureDeadline,
      raidBossCurrentHealth: raid.raidBossMaxHealth ?? 0,
    })),
  };
};
