import { RYO_FOR_REP_DAYS_FROZEN } from "@/drizzle/constants";
import { DAY_S, secondsFromDate } from "@/utils/time";

/** When a reputation-for-ryo offer leaves its freeze window and its creator may delist it. */
export const getRyoOfferUnfreezeDate = (createdAt: Date) =>
  secondsFromDate(RYO_FOR_REP_DAYS_FROZEN * DAY_S, createdAt);
