import { FED_NORMAL_REPS_COST } from "@/drizzle/constants";
import { FED_SILVER_REPS_COST } from "@/drizzle/constants";
import { FED_GOLD_REPS_COST } from "@/drizzle/constants";
import { FED_NORMAL_JUTSU_LOADOUTS } from "@/drizzle/constants";
import { FED_SILVER_JUTSU_LOADOUTS } from "@/drizzle/constants";
import { FED_GOLD_JUTSU_LOADOUTS } from "@/drizzle/constants";
import { FED_NORMAL_ITEM_LOADOUTS } from "@/drizzle/constants";
import { FED_SILVER_ITEM_LOADOUTS } from "@/drizzle/constants";
import { FED_GOLD_ITEM_LOADOUTS } from "@/drizzle/constants";
import { PAYPAL_DISCOUNT_PERCENT } from "@/drizzle/constants";
import { MAX_REPS_PER_MONTH, MAX_REPS_EXTRA_PER_MONTH } from "@/drizzle/constants";
import type { FederalStatus } from "@/drizzle/schema";
import type { UserData } from "@/drizzle/schema";

export const getUserFederalStatus = (user: UserData) => {
  if (user.staffAccount) {
    return "GOLD";
  } else {
    return user.federalStatus;
  }
};

export const fedJutsuLoadouts = (user?: UserData) => {
  const base = 0;
  if (!user) return base;
  const status = getUserFederalStatus(user);
  switch (status) {
    case "NORMAL":
      return base + FED_NORMAL_JUTSU_LOADOUTS;
    case "SILVER":
      return base + FED_SILVER_JUTSU_LOADOUTS;
    case "GOLD":
      return base + FED_GOLD_JUTSU_LOADOUTS;
  }
  return base;
};

export const fedItemLoadouts = (user?: UserData) => {
  const base = 0;
  if (!user) return base;
  const status = getUserFederalStatus(user);
  switch (status) {
    case "NORMAL":
      return base + FED_NORMAL_ITEM_LOADOUTS;
    case "SILVER":
      return base + FED_SILVER_ITEM_LOADOUTS;
    case "GOLD":
      return base + FED_GOLD_ITEM_LOADOUTS;
  }
  return base;
};

// Returns the monthly reputation cap for a user, scaling with account age.
// Formula: MAX_REPS_PER_MONTH + MAX_REPS_EXTRA_PER_MONTH * months_active
export const dynamicMonthlyRepCap = (user?: UserData): number => {
  if (!user?.createdAt) return MAX_REPS_PER_MONTH;
  const created =
    typeof user.createdAt === "string" ? new Date(user.createdAt) : user.createdAt;
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
  const base = Math.pow(reps, 1 / 1.305);
  return Math.ceil(base * discount * 10) / 10;
};

export const dollars2reps = (dollars: number) => {
  const discountFactor = (100 - PAYPAL_DISCOUNT_PERCENT) / 100;
  const s = dollars / discountFactor;
  const reps = Math.floor(Math.pow(s, 1.305));
  return reps;
};

export const calcFedUgradeCost = (a: FederalStatus, b: FederalStatus) => {
  let cost: number | null = null;
  if (a === "NORMAL") {
    if (b === "SILVER") {
      cost = 20;
    } else if (b === "GOLD") {
      cost = 40;
    }
  } else if (a === "SILVER" && b === "GOLD") {
    cost = 20;
  }
  return cost;
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

export const fedStatusToPlan = (status: FederalStatus) => {
  switch (status) {
    case "NORMAL":
      return process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_NORMAL;
    case "SILVER":
      return process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_SILVER;
    case "GOLD":
      return process.env.NEXT_PUBLIC_PAYPAL_PLAN_ID_GOLD;
    default:
      return null;
  }
};

export const fedStatusRepsCost = (status: FederalStatus) => {
  switch (status) {
    case "NORMAL":
      return FED_NORMAL_REPS_COST;
    case "SILVER":
      return FED_SILVER_REPS_COST;
    case "GOLD":
      return FED_GOLD_REPS_COST;
  }
  throw new Error("Invalid federal status");
};
