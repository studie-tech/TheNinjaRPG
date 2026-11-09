import type { RankedRank } from "@/drizzle/constants";
import {
  RANKED_DIVISIONS,
  RANKED_LEGEND_LP_REQUIREMENT,
  RANKED_LOADOUT_MAX_CONSUMABLES,
  RANKED_LOADOUT_MAX_INCREASECOST_ITEMS,
  RANKED_LOADOUT_MAX_JUTSUS,
  RANKED_LOADOUT_MAX_POISON_ITEMS,
  RANKED_LOADOUT_MAX_WEAPONS,
  RANKED_LOSS_PROTECTION_FACTOR,
  RANKED_LOSS_PROTECTION_RANK_GAP,
  RANKED_MIN_LP_GAIN,
  RANKED_QUEUE_MAX_WAIT_SECS,
  RANKED_RADIUS_MAX_LP,
  RANKED_RADIUS_STEP_LP,
  RANKED_RADIUS_STEP_SECS,
  RANKED_RANKS,
  RANKED_SANNIN_TOP_PLAYERS,
  RANKED_STREAK_BONUS,
  RANKED_UPSET_BONUS_PER_RANK,
} from "@/drizzle/constants";
import type { Item, Jutsu, UserData } from "@/drizzle/schema";
import {
  getJutsuCapFlags,
  getJutsuCategoryDef,
  type JutsuEquipCap,
} from "@/libs/jutsu";

/**
 * Determine player rank based on LP and top players
 * @param lp - Player's LP
 * @param topPlayersLP - Array of top players' LP values
 * @returns Player's rank
 */
export function getRankedRank(lp: number, topPlayersLP: number[]): RankedRank {
  // Sannin requires Legend LP (RANKED_LEGEND_LP_REQUIREMENT) and a place among the
  // RANKED_SANNIN_TOP_PLAYERS highest Legend players
  if (
    lp >= RANKED_LEGEND_LP_REQUIREMENT &&
    topPlayersLP.length >= RANKED_SANNIN_TOP_PLAYERS &&
    lp >= Math.min(...topPlayersLP)
  ) {
    return "Sannin";
  }
  return getDivision(lp).name;
}

/**
 * Get K-factor based on player's LP
 * @param lp - Player's LP
 * @returns K-factor for Elo calculation
 */
export function getKFactor(lp: number): number {
  return getDivision(lp).kFactor;
}

/**
 * Calculate Elo rating change with rank-based adjustments
 * @param player - Player data
 * @param opponent - Opponent data
 * @param playerWon - Whether the player won
 * @param topPlayersLP - Array of top 20 players' LP values
 * @returns New LP value
 */
export function calculateLpEloChange(
  player: Pick<UserData, "rankedLp" | "rankedStreak">,
  opponent: Pick<UserData, "rankedLp">,
  playerWon: boolean,
  topPlayersLP: number[],
): number {
  const kFactor = getKFactor(player.rankedLp);
  const expectedScore = 1 / (1 + 10 ** ((opponent.rankedLp - player.rankedLp) / 400));
  const actualScore = playerWon ? 1 : 0;

  let lpChange = kFactor * (actualScore - expectedScore);

  // Get ranks of both players
  const playerRank = getRankedRank(player.rankedLp, topPlayersLP);
  const opponentRank = getRankedRank(opponent.rankedLp, topPlayersLP);

  const playerRankIndex = RANKED_RANKS.indexOf(playerRank);
  const opponentRankIndex = RANKED_RANKS.indexOf(opponentRank);
  const rankDifference = opponentRankIndex - playerRankIndex;

  // Bonus LP for beating a higher-ranked opponent
  if (playerWon && rankDifference > 0) {
    lpChange += rankDifference * RANKED_UPSET_BONUS_PER_RANK;
  }

  // LP protection: soften a loss to an opponent ranked far enough above the loser
  if (!playerWon && rankDifference >= RANKED_LOSS_PROTECTION_RANK_GAP) {
    lpChange *= RANKED_LOSS_PROTECTION_FACTOR;
  }

  // Apply streak bonus
  if (playerWon && player.rankedStreak > 0) {
    lpChange += RANKED_STREAK_BONUS * player.rankedStreak;
  }

  const rounded = Math.round(lpChange);
  // A win always grants at least RANKED_MIN_LP_GAIN, even against a much
  // lower-rated opponent where the raw Elo delta rounds near zero.
  return playerWon ? Math.max(rounded, RANKED_MIN_LP_GAIN) : rounded;
}

/**
 * LP radius for ranked matchmaking, widening with time in queue. Once the
 * player has waited RANKED_QUEUE_MAX_WAIT_SECS, rank is ignored entirely
 * (Infinity) so they match any queued opponent.
 * @param secondsInQueue - Seconds the player has been in the queue
 * @returns The LP radius within which an opponent may be matched
 */
export const getRankedRadius = (secondsInQueue: number): number => {
  if (secondsInQueue >= RANKED_QUEUE_MAX_WAIT_SECS) {
    return Infinity;
  }
  // A negative wait (clock skew between instances) counts as just queued.
  const steps = Math.floor(Math.max(0, secondsInQueue) / RANKED_RADIUS_STEP_SECS);
  return Math.min(RANKED_RADIUS_MAX_LP, RANKED_RADIUS_STEP_LP * (steps + 1));
};

/**
 * Validate the jutsu loadout for ranked PvP
 * @param jutsus - The jutsu loadout to validate
 * @returns An object with a check flag and a message if the loadout is invalid
 */
export const validateJutsuLoadout = (jutsus: Jutsu[], caps: JutsuEquipCap[]) => {
  const skillGatedJutsu = jutsus.find((jutsu) => jutsu.requiredSkillId);
  if (skillGatedJutsu) {
    return {
      check: false,
      message: `${skillGatedJutsu.name} cannot be equipped in ranked PvP because it requires a skill tree entry`,
    };
  }

  const pveJutsu = jutsus.find((jutsu) => jutsu.battleUsageType === "PVE");
  if (pveJutsu) {
    return {
      check: false,
      message: `${pveJutsu.name} cannot be equipped in ranked PvP because it is PVE-only`,
    };
  }

  const villageJutsu = jutsus.find((jutsu) => jutsu.villageId);
  if (villageJutsu) {
    return {
      check: false,
      message: `${villageJutsu.name} cannot be equipped in ranked PvP because it requires a village`,
    };
  }

  let check = true;
  let message = "";

  const flagged = jutsus.map((jutsu) => getJutsuCapFlags(jutsu));
  for (const cap of caps) {
    const count = flagged.filter((flags) => flags[cap.key]).length;
    if (count > cap.max) {
      check = false;
      const label = getJutsuCategoryDef(cap.key).label;
      message = `You can only equip up to ${cap.max} ${label} jutsu in ranked PvP`;
    }
  }

  if (jutsus.length > RANKED_LOADOUT_MAX_JUTSUS) {
    check = false;
    message = `You can only equip up to ${RANKED_LOADOUT_MAX_JUTSUS} jutsus`;
  }

  return { check, message };
};

/**
 * Validate the item loadout for ranked PvP
 * @param items - The item loadout to validate
 * @returns An object with a check flag and a message if the loadout is invalid
 */
export const validateItemLoadout = (items: Item[]) => {
  const furnitureItem = items.find((item) => item.itemType === "FURNITURE");
  if (furnitureItem) {
    return {
      check: false,
      message: `${furnitureItem.name} belongs in your home and cannot be equipped in ranked PvP`,
    };
  }
  const skillGatedItem = items.find((item) => item.requiredSkillId);
  if (skillGatedItem) {
    return {
      check: false,
      message: `${skillGatedItem.name} cannot be equipped in ranked PvP because it requires a skill tree entry`,
    };
  }

  const bloodlineItem = items.find((item) => item.bloodlineId);
  if (bloodlineItem) {
    return {
      check: false,
      message: `${bloodlineItem.name} cannot be equipped in ranked PvP because it requires a bloodline`,
    };
  }

  let check = true;
  let message = "";

  // Split weapons and consumables
  const weapons = items.filter((item) => item.itemType === "WEAPON");
  const consumables = items.filter((item) => item.itemType === "CONSUMABLE");

  // Check poison items limit
  const poisonItems = items.filter((item) =>
    item.effects.some((e) => e.type === "poison"),
  );
  if (poisonItems.length > RANKED_LOADOUT_MAX_POISON_ITEMS) {
    check = false;
    message = `You can only equip up to ${RANKED_LOADOUT_MAX_POISON_ITEMS} poison item in ranked PvP`;
  }

  // Check increasecost items limit
  const increasecostItems = items.filter((item) =>
    item.effects.some((e) => e.type === "increasepoolcost"),
  );
  if (increasecostItems.length > RANKED_LOADOUT_MAX_INCREASECOST_ITEMS) {
    check = false;
    message = `You can only equip up to ${RANKED_LOADOUT_MAX_INCREASECOST_ITEMS} increasecost item in ranked PvP`;
  }

  // Check weapon limit
  if (weapons.length > RANKED_LOADOUT_MAX_WEAPONS) {
    check = false;
    message = `You can only equip up to ${RANKED_LOADOUT_MAX_WEAPONS} weapons`;
  }

  // Check consumable limit
  if (consumables.length > RANKED_LOADOUT_MAX_CONSUMABLES) {
    check = false;
    message = `You can only equip up to ${RANKED_LOADOUT_MAX_CONSUMABLES} consumables`;
  }

  return { check, message };
};

/** Highest division whose LP requirement the player meets; Unranked starts at 0 LP. */
const getDivision = (lp: number) => {
  let division: (typeof RANKED_DIVISIONS)[number] = RANKED_DIVISIONS[0];
  for (const candidate of RANKED_DIVISIONS) {
    if (lp >= candidate.rankedLp) division = candidate;
  }
  return division;
};
