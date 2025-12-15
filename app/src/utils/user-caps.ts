import type { UserRank } from "@/drizzle/constants";
import { USER_CAPS } from "@/drizzle/constants";

type UserCaps = (typeof USER_CAPS)[UserRank];

const FALLBACK_RANK: UserRank = "NONE";

/**
 * Returns the cap configuration for a given rank, falling back to a safe default
 * when the provided rank is missing or unexpected.
 */
export const getUserCaps = (rank?: string | null): UserCaps => {
  if (rank && Object.prototype.hasOwnProperty.call(USER_CAPS, rank)) {
    return USER_CAPS[rank as UserRank];
  }

  return USER_CAPS[FALLBACK_RANK];
};
