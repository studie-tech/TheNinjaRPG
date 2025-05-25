import { RankedDivisions } from "@/drizzle/constants";
import type { BattleUserState } from "@/libs/combat/types";

export interface RankedPvpQueue {
  id: string;
  userId: string;
  rankedLp: number;
  queueStartTime: Date;
  createdAt: Date;
}

// K-factor adjustments based on LP
const K_FACTOR_BASE = 24;
const K_FACTOR_LOW = 32; // For players < 300 LP
const K_FACTOR_MID = 28; // For players 300-600 LP
const K_FACTOR_HIGH = 24; // For players > 900 LP

// Win streak bonus
const STREAK_BONUS = 5;

function getKFactor(lp: number): number {
  if (lp < 300) return K_FACTOR_LOW;
  if (lp < 600) return K_FACTOR_MID;
  if (lp > 900) return K_FACTOR_HIGH;
  return K_FACTOR_BASE;
}

function getRank(lp: number): string {
  // Start from highest rank (lowest LP requirement)
  for (let i = RankedDivisions.length - 1; i >= 0; i--) {
    const division = RankedDivisions[i];
    if (!division) continue;
    if (lp >= division.rankedLp) {
      return division.name;
    }
  }
  // If no rank found (shouldn't happen), return lowest rank
  return RankedDivisions[0]?.name ?? "UNRANKED";
}

function getRankIndex(lp: number): number {
  for (let i = RankedDivisions.length - 1; i >= 0; i--) {
    const division = RankedDivisions[i];
    if (!division) continue;
    if (lp >= division.rankedLp) {
      return i;
    }
  }
  return 0;
}

export function calculateLPChange(
  player: BattleUserState,
  opponent: BattleUserState,
  didWin: boolean,
): number {
  // If it's a draw (both players have 0 health), return 0
  if (player.curHealth <= 0 && opponent.curHealth <= 0) {
    return 0;
  }

  const playerLP = player.rankedLp ?? 0;
  const opponentLP = opponent.rankedLp ?? 0;
  const playerRank = getRankIndex(playerLP);
  const opponentRank = getRankIndex(opponentLP);

  // Calculate expected probability (Elo formula)
  const expectedScore = 1 / (1 + Math.pow(10, (opponentLP - playerLP) / 400));
  const actualScore = didWin ? 1 : 0;

  // Get K-factor based on player's LP
  const kFactor = getKFactor(playerLP);

  // Calculate base LP change
  let lpChange = Math.round(kFactor * (actualScore - expectedScore));

  // Apply rank-based adjustments
  if (didWin) {
    // Bonus for beating higher-ranked opponents
    if (opponentRank < playerRank) {
      lpChange += Math.min(10, (playerRank - opponentRank) * 2);
    }
  } else {
    // Protection against losing to much higher-ranked opponents
    if (opponentRank < playerRank - 1) {
      lpChange = Math.max(-10, lpChange);
    }
  }

  // Add win streak bonus
  if (didWin && player.rankedStreak > 0) {
    lpChange += STREAK_BONUS * Math.min(5, player.pvpStreak);
  }

  return lpChange;
} 
