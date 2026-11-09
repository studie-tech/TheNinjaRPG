import type { UserData } from "@/drizzle/schema";

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
