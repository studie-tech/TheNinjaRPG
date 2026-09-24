import {
  KAGE_ELDER_MIN_DAYS,
  KAGE_MIN_DAYS_IN_VILLAGE,
  KAGE_PRESTIGE_REQUIREMENT,
  KAGE_RANK_REQUIREMENT,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { hasRequiredRank } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";

/**
 * Gets the number of days a user has been in their village.
 * @param user - The user data.
 * @returns The number of days the user has been in their village.
 */
const getDaysInVillage = (user: UserData) => {
  try {
    if (!user.joinedVillageAt) return 0;
    const joinDate = new Date(user.joinedVillageAt);
    return Math.floor((Date.now() - joinDate.getTime()) / (1000 * 3600 * 24));
  } catch {
    return 0;
  }
};

/**
 * Checks if a user can challenge the Kage.
 * @param user - The user data.
 * @returns True if the user can challenge the Kage, false otherwise.
 */
export const canChallengeKage = (user: UserData) => {
  const daysInVillage = getDaysInVillage(user);
  if (
    user.villagePrestige >= KAGE_PRESTIGE_REQUIREMENT &&
    hasRequiredRank(user.rank, KAGE_RANK_REQUIREMENT) &&
    daysInVillage >= KAGE_MIN_DAYS_IN_VILLAGE
  ) {
    return true;
  }
  return false;
};

/**
 * Checks if a user can be an elder.
 * @param user - The user data.
 * @returns True if the user can be an elder, false otherwise.
 */
export const canBeElder = (user: UserData) => {
  const daysInVillage = getDaysInVillage(user);
  return daysInVillage >= KAGE_ELDER_MIN_DAYS;
};

/**
 * Checks if a user is the Kage of their village.
 * @param user - The user object.
 * @returns True if the user is the Kage of their village, false otherwise.
 */
export const isKage = (user: NonNullable<UserWithRelations>) => {
  return Boolean(user?.village && user.userId === user.village?.kageId);
};
