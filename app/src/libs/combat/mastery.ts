import type { MasteryName } from "@/drizzle/constants";
import {
  MasteryNames,
  PVP_MASTERY_LOSS_REWARD,
  PVP_MASTERY_WIN_REWARD,
} from "@/drizzle/constants";
import type {
  BattleUserState,
  CombatAction,
  CompleteBattle,
} from "@/libs/combat/types";
import { MASTERY_REQUIREMENT_FIELDS, MASTERY_TYPE_TO_STAT } from "@/libs/mastery";
import { allocateMasteryGains } from "@/libs/masteryProgression";

/** Count the disciplines of a successfully performed action once, not once per effect. */
export const recordMasteryUsage = (user: BattleUserState, action: CombatAction) => {
  if (!action.data) return;
  const names = new Set<MasteryName>();
  const classification =
    "statClassification" in action.data ? action.data.statClassification : null;
  if (classification && classification !== "None") {
    names.add(MASTERY_TYPE_TO_STAT[classification]);
  }
  for (const [requirement, mastery] of MASTERY_REQUIREMENT_FIELDS) {
    if ((action.data[requirement] ?? 0) > 0) names.add(mastery);
  }
  if (action.data.bloodlineId) names.add("bloodlineMastery");
  user.usedMasteries ??= {};
  for (const mastery of names) {
    user.usedMasteries[mastery] = (user.usedMasteries[mastery] ?? 0) + 1;
  }
};

/**
 * Allocate one battle's mastery budget by performed discipline usage against earned caps.
 * Preloaded baseStatsForModifiers removes temporary bonuses before cap calculations.
 * Fleeing, draws and practice/ranked battles grant no mastery; quest cast tracking is
 * independent and still counts their performed actions. Requested shares are floored to
 * hundredths; caps can reduce them further. Gains never contribute combat-stat XP.
 * Persistence rechecks the live row's gain capacity.
 */
export const combatMasteryGains = (
  battle: Pick<CompleteBattle, "battleType" | "rewardScaling">,
  user: BattleUserState,
  targets: BattleUserState[],
  outcome: "Won" | "Lost" | "Draw" | "Fled",
  pveGrowth: number,
): Partial<Record<MasteryName, number>> => {
  if (
    user.isAi ||
    user.isSummon ||
    ["SPARRING", "TRAINING", "RANKED_PVP", "RANKED_SPARRING"].includes(
      battle.battleType,
    ) ||
    outcome === "Fled" ||
    outcome === "Draw"
  )
    return {};
  const usage = { ...user.usedMasteries };
  if (user.sageModeUsedThisBattle) usage.sageMastery = (usage.sageMastery ?? 0) + 1;
  const total = Object.values(usage).reduce((sum, n) => sum + n, 0);
  if (total <= 0) return {};
  const isPvp = targets.some((target) => !target.isAi && !target.isSummon);
  const budget = isPvp
    ? (outcome === "Won" ? PVP_MASTERY_WIN_REWARD : PVP_MASTERY_LOSS_REWARD) *
      battle.rewardScaling
    : Math.max(0, pveGrowth);
  const base = { ...user, ...user.baseStatsForModifiers };
  return allocateMasteryGains(
    base,
    Object.fromEntries(
      MasteryNames.map((mastery) => [
        mastery,
        Math.floor(((budget * (usage[mastery] ?? 0)) / total) * 100) / 100,
      ]),
    ),
  );
};
