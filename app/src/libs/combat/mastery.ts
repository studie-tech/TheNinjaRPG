import type { MasteryName } from "@/drizzle/constants";
import {
  MasteryNames,
  NO_REWARD_BATTLE_TYPES,
  PVP_MASTERY_LOSS_REWARD,
  PVP_MASTERY_WIN_REWARD,
} from "@/drizzle/constants";
import { decreaseMastery, increaseMastery } from "@/libs/combat/tags";
import type {
  BattleUserState,
  CombatAction,
  CompleteBattle,
  UserEffect,
} from "@/libs/combat/types";
import { MASTERY_REQUIREMENT_FIELDS, MASTERY_TYPE_TO_STAT } from "@/libs/mastery";
import { allocateMasteryGains } from "@/libs/masteryProgression";
import { boostPvpGain } from "@/libs/pvpExperience";
import { getVillageLoyaltyBonuses, percentageMultiplier } from "@/libs/villageLoyalty";
import {
  canStackEffect,
  getActiveSealEffects,
  getEffectStackKey,
  isEffectActive,
  sealCheck,
  sortEffects,
} from "./util";

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
    NO_REWARD_BATTLE_TYPES.includes(battle.battleType) ||
    outcome === "Fled" ||
    outcome === "Draw"
  )
    return {};
  const usage = { ...user.usedMasteries };
  if (user.sageModeUsedThisBattle) usage.sageMastery = (usage.sageMastery ?? 0) + 1;
  const total = Object.values(usage).reduce((sum, n) => sum + n, 0);
  if (total <= 0) return {};
  const isPvp = targets.some((target) => !target.isAi && !target.isSummon);
  // Loyalty augments the open-world human budget; AI growth and earned caps remain unchanged.
  const loyaltyFactor = percentageMultiplier(
    battle.battleType === "COMBAT" ? getVillageLoyaltyBonuses(user).pvpRewards : 0,
  );
  const budget = isPvp
    ? boostPvpGain(
        (outcome === "Won" ? PVP_MASTERY_WIN_REWARD : PVP_MASTERY_LOSS_REWARD) *
          battle.rewardScaling,
        user.pvpBoostPercent ?? 0,
      ) * loyaltyFactor
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

/**
 * Re-derive masteries from their bases and the mastery tags active now, with applyEffects'
 * seal, stacking and prevent rules, for state that is read before the next applyEffects:
 * a new battle, a completed action, or a new round whose expired or newly landed tags
 * change what is usable.
 */
export const refreshMasteries = (
  usersState: BattleUserState[],
  usersEffects: UserEffect[],
) => {
  usersState.forEach(resetMasteriesToBase);
  const sealEffects = getActiveSealEffects(usersEffects);
  const applied = new Set<string>();
  usersEffects
    .filter(
      (e) =>
        (e.type === "increasemastery" || e.type === "decreasemastery") &&
        e.targetType === "user" &&
        isEffectActive(e),
    )
    .sort(sortEffects)
    .forEach((effect) => {
      const creator = usersState.find((u) => u.userId === effect.creatorId);
      const target = usersState.find((u) => u.userId === effect.targetId);
      if (!creator || !target || !canStackEffect(effect, applied)) return;
      if (sealCheck(effect, sealEffects)) return;
      applied.add(getEffectStackKey(effect));
      if (effect.type === "increasemastery") {
        increaseMastery(effect, usersEffects, target);
      } else {
        decreaseMastery(effect, usersEffects, target);
      }
    });
};

/** Remember unbuffed masteries so residual mastery tags can be reapplied without stacking. */
export const storeMasteryBases = (user: BattleUserState) => {
  if (!user.baseStatsForModifiers) {
    user.baseStatsForModifiers = {};
  }
  for (const key of MasteryNames) {
    if (user.baseStatsForModifiers[key] === undefined) {
      user.baseStatsForModifiers[key] = user[key];
    }
  }
};

/** Restore masteries to the values stored before residual mastery tags were applied. */
export const resetMasteriesToBase = (user: BattleUserState) => {
  const base = user.baseStatsForModifiers;
  if (!base) return;
  for (const key of MasteryNames) {
    const stored = base[key];
    if (stored !== undefined) {
      user[key] = stored;
    }
  }
};
