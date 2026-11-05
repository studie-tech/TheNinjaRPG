import { OCCUPATION_CHANGE_COOLDOWN_DAYS } from "@/drizzle/constants";
import { DAY_S, secondsFromDate } from "@/utils/time";

/** Moment a player who took an occupation at `signupAt` may change it. */
export const getOccupationChangeAvailableAt = (signupAt: Date) =>
  secondsFromDate(OCCUPATION_CHANGE_COOLDOWN_DAYS * DAY_S, signupAt);

/** Days left on the occupation change cooldown, counting a started day; 0 once it ends. */
export const getOccupationChangeDaysRemaining = (signupAt: Date, now = new Date()) => {
  const secondsLeft =
    (getOccupationChangeAvailableAt(signupAt).getTime() - now.getTime()) / 1000;
  return Math.max(0, Math.ceil(secondsLeft / DAY_S));
};
