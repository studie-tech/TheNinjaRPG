import { COOKING_RANKS } from "@/drizzle/constants";
import type { Item } from "@/drizzle/schema";
import { getStatTypeLabels } from "@/libs/combat/util";
import { getFarmingLevel } from "@/libs/farming";
import { calcLevelRequirements } from "@/libs/profile";

/** Cooking levels use the existing Farming experience curve. */
export const getCookingLevel = getFarmingLevel;
/** Highest Cooking title unlocked on the shared Farming experience curve. */
export const getCookingRank = (experience: number) => {
  const level = getCookingLevel(experience);
  return (
    [...COOKING_RANKS].reverse().find((rank) => level >= rank.level) ?? COOKING_RANKS[0]
  );
};
/** Progress between title milestones rather than individual Cooking levels. */
export const getCookingRankProgress = (experience: number) => {
  const rank = getCookingRank(experience);
  const next = COOKING_RANKS.find((entry) => entry.level > rank.level);
  const currentExperience =
    rank.level === 1 ? 0 : calcLevelRequirements(rank.level - 1);
  const nextExperience = next ? calcLevelRequirements(next.level - 1) : null;
  return {
    rank,
    next,
    nextExperience,
    progress:
      nextExperience === null
        ? 100
        : Math.min(
            100,
            Math.max(
              0,
              ((experience - currentExperience) /
                (nextExperience - currentExperience)) *
                100,
            ),
          ),
  };
};
/** Time counts every output meal; Crafting shrine bonuses increase Cooking duration. */
export const getCookingSeconds = (
  meal: Pick<Item, "cookingTimeSeconds" | "cookingOutputQuantity">,
  batches: number,
  shrineBoost: number,
  territoryBoost = 0,
) =>
  Math.max(
    1,
    Math.round(
      meal.cookingTimeSeconds *
        meal.cookingOutputQuantity *
        batches *
        (1 + shrineBoost) *
        (1 - territoryBoost),
    ),
  );

/** Human-readable recipe bonus and duration. */
export const describeMealEffect = (
  meal: Pick<Item, "effects" | "mealDurationSeconds">,
) =>
  `${meal.effects
    .map((effect) => {
      if (effect.type === "increaseregeneration")
        return `Regeneration +${effect.power}${effect.calculation === "percentage" ? "%" : ""}`;
      if (effect.type === "increasestat") {
        const stats = [...getStatTypeLabels(effect), ...(effect.generalTypes ?? [])];
        return `${stats.join(", ")} +${effect.power}${effect.calculation === "percentage" ? "%" : ""}`;
      }
      return effect.description;
    })
    .join(" · ")} for ${meal.mealDurationSeconds}s`;
