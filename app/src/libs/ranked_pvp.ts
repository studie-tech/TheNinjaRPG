import {
  RANKED_RANKS,
  RANKED_STREAK_BONUS,
  RANKED_DIVISIONS,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import type { RankedRank } from "@/drizzle/constants";

/**
 * Determine player rank based on LP and top players
 * @param lp - Player's LP
 * @param topPlayersLP - Array of top 20 players' LP values
 * @returns Player's rank
 */
export function getRankedRank(lp: number, topPlayersLP: number[]): RankedRank {
  // Sannin rank requires being in top 20 players
  if (topPlayersLP.length >= 20 && lp >= Math.min(...topPlayersLP)) {
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
  player: UserData,
  opponent: UserData,
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
