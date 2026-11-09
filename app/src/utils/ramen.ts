import type { UserData } from "@/drizzle/schema";
import type { BoostStructure } from "@/utils/village";
import { getStrucBoost } from "@/utils/village";

// Options in standard ramen shop
export const ramenOptions = ["small", "medium", "large"] as const;
export type RamenOption = (typeof ramenOptions)[number];

/**
 * For each ramen option, return the percentage of health it heals
 */
export const getRamenHealPercentage = (option: RamenOption) => {
  switch (option) {
    case "small":
      return 10;
    case "medium":
      return 50;
    case "large":
      return 100;
  }
};

/**
 * Ryo cost of a ramen option for this user: maxHealth × the option's heal percentage / 500
 */
export const calcRamenCost = (option: RamenOption, user: UserData) => {
  const totalHealth = user.maxHealth;
  const healPercentage = getRamenHealPercentage(option);
  return (totalHealth * healPercentage) / 500;
};

/**
 * Ryo price of a ramen option after the ramen-shop discount of the sector's village
 * structures; a sector without a village gives no discount.
 */
export const calcRamenPrice = (
  option: RamenOption,
  user: UserData,
  structures?: BoostStructure[],
) => {
  const discount = getStrucBoost("ramenDiscountPerLvl", structures);
  return (calcRamenCost(option, user) * (100 - discount)) / 100;
};
