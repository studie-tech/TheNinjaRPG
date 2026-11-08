import { SKILL_TREE_RESET_FREE } from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { getUserFederalStatus } from "@/utils/paypal";
import { isStaffMember } from "@/utils/permissions";
import { getUtcMonthKey } from "@/utils/time";

/**
 * Button note for a free Skills or Bloodright reset. Staff resets never consume the shared
 * allowance, so staff see that instead of the count; a free reset with nothing remaining
 * can only be a staff reset.
 */
export const freeResetNote = (
  isStaff: boolean,
  remaining: number,
  allowance = "free resets",
) =>
  isStaff || remaining === 0 ? "Free for staff" : `${remaining} ${allowance} remaining`;

/**
 * Get the free reset amount for a user
 * @param user - The user
 * @returns The free reset amount
 */
export const getFreeResetAmount = (user: UserData) =>
  SKILL_TREE_RESET_FREE[getUserFederalStatus(user)];

/**
 * The monthly allowance skill and Bloodright resets share. Staff reset for free without
 * drawing on it; `next` is the state a reset persists.
 */
export const getResetAllowance = (user: UserData) => {
  const state = getMonthlyResetState(user);
  const isStaff = isStaffMember(user);
  const remaining = Math.max(0, getFreeResetAmount(user) - state.count);
  return {
    isStaff,
    isFree: remaining > 0 || isStaff,
    used: state.count,
    remaining,
    next: { ...state, count: state.count + (isStaff ? 0 : 1) },
  };
};

/** Free resets claimed this UTC month, persisted by the guarded reset UPDATE. */
export const getMonthlyResetState = (user: UserData) => {
  const month = getUtcMonthKey();
  return {
    month,
    count: user.monthlySkillResets?.month === month ? user.monthlySkillResets.count : 0,
  };
};
