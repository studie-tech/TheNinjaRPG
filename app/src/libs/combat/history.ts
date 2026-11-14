import type { BattleOutcome } from "@/drizzle/constants";

/** How a battle history row's battle ended for one of its two fighters, when recorded. */
export const battleHistoryOutcome = (
  row: {
    attackedId: string;
    defenderId: string;
    attackerOutcome: BattleOutcome | null;
    defenderOutcome: BattleOutcome | null;
  },
  userId: string,
): BattleOutcome | null =>
  row.attackedId === userId
    ? row.attackerOutcome
    : row.defenderId === userId
      ? row.defenderOutcome
      : null;
