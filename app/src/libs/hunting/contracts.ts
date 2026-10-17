import { HUNTING_REQUIRED_EXP } from "@/drizzle/constants";
import type {
  HuntingBattleState,
  HuntingContract,
  HuntingReceipt,
} from "@/validators/hunting";

/** Read the remaining allowance; an expired cooldown replenishes it without a write. */
export const huntingAllowance = (
  contract: HuntingContract,
  progress?: { used: number; cooldownUntil: Date | null },
  now = Date.now(),
) => {
  const cooling = !!progress?.cooldownUntil && progress.cooldownUntil.getTime() > now;
  const used = progress?.cooldownUntil && !cooling ? 0 : (progress?.used ?? 0);
  return { used, cooling, remaining: Math.max(0, contract.hunts - used) };
};
/** Contracts use the Hunter occupation and hunting XP, independently of character rank. */
export const huntingEligibility = (
  occupation: string | null,
  experience: number,
  contract: HuntingContract,
) => occupation === "HUNTER" && experience >= HUNTING_REQUIRED_EXP[contract.rank];

/**
 * Build the persisted result from preloaded rules, preserving allowance on non-victories.
 * Roll once before settlement so deadlock retries keep the same drops and cooldown.
 */
export const huntingVictoryReceipt = (
  meta: HuntingBattleState,
  battleId: string,
  outcome: HuntingReceipt["outcome"],
  now = new Date(),
  random = Math.random,
): HuntingReceipt => {
  const won = outcome === "Won";
  const remaining = Math.max(0, meta.contract.hunts - meta.used - (won ? 1 : 0));
  return {
    battleId,
    outcome,
    contractName: meta.contract.name,
    experience: won ? meta.contract.experience : 0,
    totalExperience: meta.huntingExperience + (won ? meta.contract.experience : 0),
    remaining,
    cooldownUntil:
      won && remaining === 0
        ? new Date(now.getTime() + meta.contract.cooldownSeconds * 1000).toISOString()
        : null,
    materials: won
      ? meta.contract.rewards
          .filter((r) => r.chance === 100 || random() * 100 < r.chance)
          .map((r) => ({
            itemId: r.itemId,
            name: meta.materialNames[r.itemId] ?? r.itemId,
            quantity: r.quantity,
            bonus: r.chance < 100,
          }))
      : [],
  };
};
