import {
  BALANCE_IDLE_ACTION_IDS,
  BALANCE_MIN_ROUNDS,
  type BalanceExclusion,
} from "@/drizzle/constants";
import type { BattleUserState } from "@/libs/combat/types";

type BalanceUser = Pick<
  BattleUserState,
  "userId" | "direction" | "isAi" | "isSummon" | "usedActions"
>;

/** True when the user did anything but end the turn or flee; timeouts record nothing. */
export const hasActiveBalanceAction = (user: Pick<BattleUserState, "usedActions">) =>
  (user.usedActions ?? []).some(
    (action) => action.type !== "basic" || !BALANCE_IDLE_ACTION_IDS.includes(action.id),
  );

/**
 * Why a player's settlement should stay out of the balance data, or null when it counts.
 * The battle must reach BALANCE_MIN_ROUNDS, the player must have acted, and every side must
 * have acted: a win against an idle side says nothing about either side's content. AI
 * opponents always count as active, so PvE only depends on the human side.
 */
export const getBalanceExclusion = (
  battle: { round: number; usersState: BalanceUser[] },
  userId: string,
): BalanceExclusion | null => {
  if (battle.round < BALANCE_MIN_ROUNDS) return "short";
  const fighters = battle.usersState.filter((u) => !u.isSummon);
  const user = fighters.find((u) => u.userId === userId);
  if (!user || (!user.isAi && !hasActiveBalanceAction(user))) return "idle";
  const directions = new Set(fighters.map((u) => u.direction));
  for (const direction of directions) {
    const side = fighters.filter((u) => u.direction === direction);
    if (!side.some((u) => u.isAi || hasActiveBalanceAction(u))) return "idle";
  }
  return null;
};
