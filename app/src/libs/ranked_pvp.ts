import {
  RANKED_RANKS,
  RANKED_STREAK_BONUS,
  RANKED_DIVISIONS,
  RANKED_SANNIN_TOP_PLAYERS,
  RANKED_LOADOUT_MAX_RESIDUAL_JUTSUS,
  RANKED_LOADOUT_MAX_POISON_JUTSUS,
  RANKED_LOADOUT_MAX_INCREASECOST_JUTSUS,
  RANKED_LOADOUT_MAX_POISON_ITEMS,
  RANKED_LOADOUT_MAX_INCREASECOST_ITEMS,
  RANKED_LOADOUT_MAX_JUTSUS,
  RANKED_LOADOUT_MAX_WEAPONS,
  RANKED_LOADOUT_MAX_CONSUMABLES,
  RANKED_LOADOUT_MAX_SUMMON_JUTSUS,
  RANKED_LOADOUT_MAX_BARRIER_JUTSUS,
  JUTSU_MAX_EVENT_EQUIPPED,
} from "@/drizzle/constants";
import type { Jutsu, UserData, Item } from "@/drizzle/schema";
import type { RankedRank } from "@/drizzle/constants";

/**
 * Determine player rank based on LP and top players
 * @param lp - Player's LP
 * @param topPlayersLP - Array of top players' LP values
 * @returns Player's rank
 */
export function getRankedRank(lp: number, topPlayersLP: number[]): RankedRank {
  // Sannin rank requires being Legend (900+ LP) AND in top 10 Legend players
  const LEGEND_LP_REQUIREMENT =
    RANKED_DIVISIONS.find((d) => d.key === "LEGEND")?.rankedLp ?? 900;
  if (
    lp >= LEGEND_LP_REQUIREMENT &&
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
  const expectedScore =
    1 / (1 + Math.pow(10, (opponent.rankedLp - player.rankedLp) / 400));
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

  return Math.round(lpChange);
}

/**
 * Validate the jutsu loadout for ranked PvP
 * @param jutsus - The jutsu loadout to validate
 * @returns An object with a check flag and a message if the loadout is invalid
 */
export const validateJutsuLoadout = (jutsus: Jutsu[]) => {
  let check = true;
  let message = "";

  // Check residual jutsu limit
  const residualJutsus = jutsus.filter((jutsu) =>
    jutsu.effects.some((e) => "residualModifier" in e && e.residualModifier),
  );
  if (residualJutsus.length > RANKED_LOADOUT_MAX_RESIDUAL_JUTSUS) {
    check = false;
    message = `You can only equip up to ${RANKED_LOADOUT_MAX_RESIDUAL_JUTSUS} residual jutsu in ranked PvP`;
  }

  // Check poison jutsu limit
  const poisonJutsus = jutsus.filter((jutsu) =>
    jutsu.effects.some((e) => e.type === "poison"),
  );
  if (poisonJutsus.length > RANKED_LOADOUT_MAX_POISON_JUTSUS) {
    check = false;
    message = `You can only equip up to ${RANKED_LOADOUT_MAX_POISON_JUTSUS} poison jutsu in ranked PvP`;
  }

  // Check increasecost jutsu limit
  const increasecostJutsus = jutsus.filter((jutsu) =>
    jutsu.effects.some((e) => e.type === "increasepoolcost"),
  );
  if (increasecostJutsus.length > RANKED_LOADOUT_MAX_INCREASECOST_JUTSUS) {
    check = false;
    message = `You can only equip up to ${RANKED_LOADOUT_MAX_INCREASECOST_JUTSUS} increasecost jutsu in ranked PvP`;
  }

  // Check summon jutsu limit
  const summonJutsus = jutsus.filter((jutsu) =>
    jutsu.effects.some((e) => e.type === "summon"),
  );
  if (summonJutsus.length > RANKED_LOADOUT_MAX_SUMMON_JUTSUS) {
    check = false;
    message = `You can only equip up to ${RANKED_LOADOUT_MAX_SUMMON_JUTSUS} summon jutsu in ranked PvP`;
  }

  // Check barrier jutsu limit
  const barrierJutsus = jutsus.filter((jutsu) =>
    jutsu.effects.some((e) => e.type === "barrier"),
  );
  if (barrierJutsus.length > RANKED_LOADOUT_MAX_BARRIER_JUTSUS) {
    check = false;
    message = `You can only equip up to ${RANKED_LOADOUT_MAX_BARRIER_JUTSUS} barrier jutsu in ranked PvP`;
  }

  // Check event jutsu limit
  const eventJutsus = jutsus.filter((jutsu) => jutsu.jutsuType === "EVENT");
  if (eventJutsus.length > JUTSU_MAX_EVENT_EQUIPPED) {
    check = false;
    message = `You can only equip up to ${JUTSU_MAX_EVENT_EQUIPPED} event jutsu in ranked PvP`;
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
