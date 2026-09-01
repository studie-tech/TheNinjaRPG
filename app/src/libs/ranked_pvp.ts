import type { RankedRank } from "@/drizzle/constants";
import {
  RANKED_DIVISIONS,
  RANKED_LEGEND_LP_REQUIREMENT,
  RANKED_LOADOUT_MAX_CONSUMABLES,
  RANKED_LOADOUT_MAX_INCREASECOST_ITEMS,
  RANKED_LOADOUT_MAX_JUTSUS,
  RANKED_LOADOUT_MAX_POISON_ITEMS,
  RANKED_LOADOUT_MAX_WEAPONS,
  RANKED_MIN_LP_GAIN,
  RANKED_QUEUE_MAX_WAIT_SECS,
  RANKED_RANKS,
  RANKED_SANNIN_TOP_PLAYERS,
  RANKED_STREAK_BONUS,
} from "@/drizzle/constants";
import type { Item, Jutsu, UserData } from "@/drizzle/schema";
import { getJutsuCapFlags, getJutsuCategoryDef, RANKED_JUTSU_CAPS } from "@/libs/jutsu";

/**
 * Determine player rank based on LP and top players
 * @param lp - Player's LP
 * @param topPlayersLP - Array of top players' LP values
 * @returns Player's rank
 */
export function getRankedRank(lp: number, topPlayersLP: number[]): RankedRank {
  // Sannin rank requires being Legend (900+ LP) AND in top 10 Legend players
  if (
    lp >= RANKED_LEGEND_LP_REQUIREMENT &&
    topPlayersLP.length >= RANKED_SANNIN_TOP_PLAYERS &&
    lp >= Math.min(...topPlayersLP)
  ) {
    return "Sannin";
  }
  // Find the highest division the player qualifies for
  let highestDivision: RankedRank = "Wood";
  for (const division of RANKED_DIVISIONS) {
    if (lp >= division.rankedLp) {
      highestDivision = division.name;
    }
  }
  return highestDivision;
}

/**
 * Get K-factor based on player's LP
 * @param lp - Player's LP
 * @returns K-factor for Elo calculation
 */
export function getKFactor(lp: number): number {
  // Find all divisions the player qualifies for (LP >= division requirement)
  const qualifyingDivisions = RANKED_DIVISIONS.filter(
    (division) => lp >= division.rankedLp,
  );
  // Sort by LP requirement descending to get highest qualifying division
  const sortedDivisions = qualifyingDivisions.sort((a, b) => b.rankedLp - a.rankedLp);
  // Return K-factor from highest qualifying division, or Wood division, or default 32
  return (
    sortedDivisions?.[0]?.kFactor ??
    RANKED_DIVISIONS.find((division) => division.name === "Wood")?.kFactor ??
    32
  );
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
    lpChange += rankDifference * 10;
  }

  // LP Protection: Reduce loss if losing to an opponent 2+ ranks above
  if (!playerWon && rankDifference <= -2) {
    lpChange *= 0.5;
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
  if (secondsInQueue < 60) {
    return 50;
  } else if (secondsInQueue < 120) {
    return 100;
  } else if (secondsInQueue < 180) {
    return 150;
  } else if (secondsInQueue < 240) {
    return 200;
  }
  return 250;
};

/**
 * Validate the jutsu loadout for ranked PvP
 * @param jutsus - The jutsu loadout to validate
 * @returns An object with a check flag and a message if the loadout is invalid
 */
export const validateJutsuLoadout = (jutsus: Jutsu[]) => {
  const skillGatedJutsu = jutsus.find((jutsu) => jutsu.requiredSkillId);
  if (skillGatedJutsu) {
    return {
      check: false,
      message: `${skillGatedJutsu.name} cannot be equipped in ranked PvP because it requires a skill tree entry`,
    };
  }

  let check = true;
  let message = "";

  const flagged = jutsus.map((jutsu) => getJutsuCapFlags(jutsu));
  for (const cap of RANKED_JUTSU_CAPS) {
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
  const skillGatedItem = items.find((item) => item.requiredSkillId);
  if (skillGatedItem) {
    return {
      check: false,
      message: `${skillGatedItem.name} cannot be equipped in ranked PvP because it requires a skill tree entry`,
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

  // Check bloodline items limit
  const bloodlineItems = items.filter((item) => item.bloodlineId);
  if (bloodlineItems.length > 1) {
    check = false;
    message = `You can only equip one item with a bloodline requirement in ranked PvP`;
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
