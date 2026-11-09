import {
  FED_ITEM_LOADOUTS,
  FED_ITEM_LOADOUTS_BASE,
  FED_JUTSU_LOADOUTS,
  FED_JUTSU_LOADOUTS_BASE,
  FED_REPS_COST,
  FED_UPGRADE_REPS_COST,
  FederalStatuses,
  MAX_REPS_EXTRA_PER_MONTH,
  MAX_REPS_PER_MONTH,
  PAYPAL_DISCOUNT_PERCENT,
  QUEUE_WAITING_SLOTS,
  STORE_BUNDLE_MIN_PRICE_CENTS,
} from "@/drizzle/constants";
import type { FederalStatus, Item, UserData } from "@/drizzle/schema";
import type { StoreContents } from "@/validators/points";

export const getUserFederalStatus = (
  user: Pick<UserData, "staffAccount" | "federalStatus">,
) => {
  if (user.staffAccount) {
    return "GOLD";
  } else {
    return user.federalStatus;
  }
};

/**
 * Why a monthly allowance use cost nothing. Staff come first; the federal tier is named only
 * when the use falls beyond what an account without supporter status gets.
 */
export const freeAllowanceNote = (
  allowance: Record<FederalStatus, number>,
  federalStatus: FederalStatus,
  used: number,
  isStaff: boolean,
) => {
  if (isStaff) return "Free for staff member";
  if (used >= allowance.NONE) return `Free for ${federalStatus} supporter`;
  return "Free monthly allowance";
};

/** Jobs that may wait behind the active one in each timed queue. */
export const getQueueWaitingSlots = (
  user: Pick<UserData, "staffAccount" | "federalStatus">,
) => QUEUE_WAITING_SLOTS[getUserFederalStatus(user)];

/** One active job plus the federal waiting-slot allowance. */
export const getQueueTotalCapacity = (
  user: Pick<UserData, "staffAccount" | "federalStatus">,
) => 1 + getQueueWaitingSlots(user);

export const fedJutsuLoadouts = (
  user?: Pick<UserData, "staffAccount" | "federalStatus">,
) => {
  const base = FED_JUTSU_LOADOUTS_BASE;
  if (!user) return base;
  return base + FED_JUTSU_LOADOUTS[getUserFederalStatus(user)];
};

export const fedItemLoadouts = (
  user?: Pick<UserData, "staffAccount" | "federalStatus">,
) => {
  const base = FED_ITEM_LOADOUTS_BASE;
  if (!user) return base;
  return base + FED_ITEM_LOADOUTS[getUserFederalStatus(user)];
};

/** Scale the monthly reputation cap with completed account-age months, never below base. */
export const dynamicMonthlyRepCap = (user?: UserData): number => {
  if (!user?.createdAt) return MAX_REPS_PER_MONTH;
  const created = user.createdAt;
  const now = new Date();
  // Calculate full months between created and now
  const monthsActive =
    (now.getFullYear() - created.getFullYear()) * 12 +
    (now.getMonth() - created.getMonth()) +
    (now.getDate() >= created.getDate() ? 0 : -1);
  const months = Math.max(0, monthsActive);
  return MAX_REPS_PER_MONTH + MAX_REPS_EXTRA_PER_MONTH * months;
};

export const reps2dollars = (reps: number) => {
  const discount = (100 - PAYPAL_DISCOUNT_PERCENT) / 100;
  const base = reps ** (1 / 1.305);
  return Math.ceil(base * discount * 10) / 10;
};

/** Price the bundle's reputation and rep-priced items using the direct-purchase curve. */
export const getStoreBundleMinimumPriceCents = (
  contents: StoreContents,
  items: Pick<Item, "id" | "repsCost">[],
) => {
  const reputation = contents.items.reduce(
    (total, reward) =>
      total +
      Math.max(0, items.find((entry) => entry.id === reward.id)?.repsCost ?? 0) *
        reward.quantity,
    contents.reputationPoints,
  );
  return Math.max(
    STORE_BUNDLE_MIN_PRICE_CENTS,
    Math.round(reps2dollars(reputation) * 100),
  );
};

export const dollars2reps = (dollars: number) => {
  const discountFactor = (100 - PAYPAL_DISCOUNT_PERCENT) / 100;
  const s = dollars / discountFactor;
  const reps = Math.floor(s ** 1.305);
  return reps;
};

export const calcFedUgradeCost = (a: FederalStatus, b: FederalStatus) =>
  FED_UPGRADE_REPS_COST[a]?.[b] ?? null;

/**
 * Explains a federal card whose reputation purchase is hidden: reputation points only
 * buy support for a character without any, and upgrades are limited to your own one.
 */
export const fedRepsUnavailableNote = (
  current: FederalStatus,
  tier: FederalStatus,
  isSelf: boolean,
) => {
  if (!isSelf) {
    const isUpgrade = FederalStatuses.indexOf(tier) > FederalStatuses.indexOf(current);
    const upgrade = isUpgrade ? " Only they can upgrade it." : "";
    return `This player already has Federal Support.${upgrade} You can buy this tier for them with reputation points once it ends.`;
  }
  return current === tier
    ? "Your Federal Support is active. You can buy it with reputation points again once it ends."
    : "You have a higher Federal Support tier active. You can buy this tier with reputation points once it ends.";
};

export const plan2FedStatus = (planId: string) => {
  switch (planId) {
    case process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_NORMAL:
      return "NORMAL";
    case process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_SILVER:
      return "SILVER";
    case process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_GOLD:
      return "GOLD";
    default:
      return "NONE";
  }
};

export const fedStatusRepsCost = (status: FederalStatus) => {
  if (status === "NONE") throw new Error("Invalid federal status");
  return FED_REPS_COST[status];
};
