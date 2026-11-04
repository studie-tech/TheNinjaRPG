import { VILLAGE_LOYALTY_TIERS, type VillageLoyaltyBonus } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { getDaysHoursMinutesSeconds } from "@/utils/time";

/** Membership fields shared by client previews, server rewards and battle snapshots. */
export type VillageLoyaltyUser = Pick<UserData, "isOutlaw" | "joinedVillageAt" | "villageId">;

/** Cumulative percentage points, rather than final multiplication factors. */
export type VillageLoyaltyBonuses = Record<VillageLoyaltyBonus, number>;

/** Start every calculation with explicit zeroes for all bonus categories. */
const emptyBonuses = (): VillageLoyaltyBonuses => ({
  regen: 0,
  villageRewards: 0,
  statGains: 0,
  pvpRewards: 0,
  shopDiscount: 0,
  missionRewards: 0,
  masteryTraining: 0,
});

/**
 * Complete 24-hour membership periods for non-outlaws with a village.
 * Invalid or future join dates earn no time; calendar/DST boundaries do not unlock tiers.
 * `now` may be a queued training session's completion time rather than collection time.
 */
export const getVillageLoyaltyDays = (
  user: VillageLoyaltyUser,
  now: Date = new Date(),
) => {
  if (user.isOutlaw || !user.villageId) return 0;
  const joinedAt = new Date(user.joinedVillageAt).getTime();
  if (!Number.isFinite(joinedAt)) return 0;
  return Math.max(0, getDaysHoursMinutesSeconds(now.getTime() - joinedAt)[0]);
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

/** Unrounded factor for continuous gains; use boostPvpGain before rounding integer rewards. */
export const percentageMultiplier = (percent: number) => 1 + percent / 100;

/** Loyalty-only prestige price, rounded up; normal Ryo shops combine their own discounts. */
export const getVillageLoyaltyShopCost = (
  cost: number,
  user: VillageLoyaltyUser,
  now: Date = new Date(),
) =>
  Math.ceil(
    cost * Math.max(0, 1 - getVillageLoyaltyBonuses(user, now).shopDiscount / 100),
  );

/** Describe an individual milestone's increment, not its cumulative category total. */
export const getVillageLoyaltyTierDescription = (
  tier: (typeof VILLAGE_LOYALTY_TIERS)[number],
) => {
  switch (tier.bonus) {
    case "regen":
      return `+${tier.percent}% regeneration`;
    case "villageRewards":
      return `+${tier.percent}% village prestige and token earnings`;
    case "statGains":
      return `+${tier.percent}% offense, defense, and general stat training gains`;
    case "pvpRewards":
      return `+${tier.percent}% open-world PvP stat gains and experience`;
    case "shopDiscount":
      return `${tier.percent}% item and village prestige shop discount`;
    case "missionRewards":
      return `+${tier.percent}% mission and errand rewards`;
    case "masteryTraining":
      return `+${tier.percent}% mastery training`;
  }
};
