import { VILLAGE_LOYALTY_TIERS, type VillageLoyaltyBonus } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";

type VillageLoyaltyUser = Pick<UserData, "isOutlaw" | "joinedVillageAt" | "villageId">;

export type VillageLoyaltyBonuses = Record<VillageLoyaltyBonus, number>;

const emptyBonuses = (): VillageLoyaltyBonuses => ({
  regen: 0,
  villageRewards: 0,
  statGains: 0,
  pvpRewards: 0,
  shopDiscount: 0,
  missionRewards: 0,
  masteryTraining: 0,
});

/** Whole days continuously spent in a non-outlaw village. */
export const getVillageLoyaltyDays = (
  user: VillageLoyaltyUser,
  now: Date = new Date(),
) => {
  if (user.isOutlaw || !user.villageId) return 0;
  const joinedAt = new Date(user.joinedVillageAt).getTime();
  if (!Number.isFinite(joinedAt)) return 0;
  return Math.max(0, Math.floor((now.getTime() - joinedAt) / 86_400_000));
};

/** Cumulative percentage-point bonuses earned from continuous village membership. */
export const getVillageLoyaltyBonuses = (
  user: VillageLoyaltyUser,
  now: Date = new Date(),
): VillageLoyaltyBonuses => {
  const days = getVillageLoyaltyDays(user, now);
  const bonuses = emptyBonuses();
  for (const tier of VILLAGE_LOYALTY_TIERS) {
    if (days < tier.days) break;
    bonuses[tier.bonus] += tier.percent;
  }
  return bonuses;
};

export const percentageMultiplier = (percent: number) => 1 + percent / 100;

export const getVillageLoyaltyShopCost = (
  cost: number,
  user: VillageLoyaltyUser,
  now: Date = new Date(),
) =>
  Math.ceil(
    cost * Math.max(0, 1 - getVillageLoyaltyBonuses(user, now).shopDiscount / 100),
  );

export const getVillageLoyaltyTierDescription = (
  tier: (typeof VILLAGE_LOYALTY_TIERS)[number],
) => {
  switch (tier.bonus) {
    case "regen":
      return `+${tier.percent}% regeneration`;
    case "villageRewards":
      return `+${tier.percent}% village prestige and token earnings`;
    case "statGains":
      return `+${tier.percent}% offense, defense, and general stat gains`;
    case "pvpRewards":
      return `+${tier.percent}% PvP rewards`;
    case "shopDiscount":
      return `${tier.percent}% item and village prestige shop discount`;
    case "missionRewards":
      return `+${tier.percent}% mission and errand rewards`;
    case "masteryTraining":
      return `+${tier.percent}% sage mastery training`;
  }
};
