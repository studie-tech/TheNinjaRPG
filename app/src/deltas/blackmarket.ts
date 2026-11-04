import type { UserQueueState } from "@/deltas/profile";

import {
  COST_CHANGE_GENDER,
  COST_REROLL_ELEMENT,
} from "@/drizzle/constants";
import { hasEnergyQueue } from "@/libs/queue";

import type { findUserWithBloodline } from "@/queries/profile";

/**
 * Debit reputation reserved by a listed offer, withholding the delta while energy work is
 * queued.
 */
export const getCreateOfferUserUpdate = ({
  user,
  inputReps,
}: {
  user: UserQueueState;
  inputReps: number;
}) => ({
  userDelta: hasEnergyQueue(user) ? undefined : { reputationPoints: -inputReps },
});

/**
 * Refund reputation only when the caller owns the delisted offer. Queued energy work requires
 * reconciliation even when another user owns the offer.
 */
export const getDelistOfferUserUpdate = ({
  user,
  creatorId,
  ctxUserId,
  offerRepsForSale,
}: {
  user: UserQueueState;
  creatorId: string;
  ctxUserId: string;
  offerRepsForSale: number;
}) => ({
  userDelta: hasEnergyQueue(user)
    ? undefined
    : creatorId === ctxUserId
      ? { reputationPoints: offerRepsForSale }
      : {},
});

/**
 * Exchange the accepted offer's ryo cost for reputation, withholding balances while energy
 * work is queued.
 */
export const getTakeOfferUserUpdate = ({
  user,
  offerRequestedRyo,
  offerRepsForSale,
}: {
  user: UserQueueState;
  offerRequestedRyo: number;
  offerRepsForSale: number;
}) => ({
  userDelta: hasEnergyQueue(user)
    ? undefined
    : { money: -offerRequestedRyo, reputationPoints: offerRepsForSale },
});

/**
 * Add the purchased slot and debit its reputation cost unless queued energy work requires
 * reconciliation.
 */
export const getBuySlotUserUpdate = ({
  user,
  column,
  cost,
}: {
  user: UserQueueState;
  column: "extraItemSlots" | "extraJutsuSlots";
  cost: number;
}) => ({
  userDelta: hasEnergyQueue(user)
    ? undefined
    : { reputationPoints: -cost, [column]: 1 },
});

/**
 * Replace the rerolled element while preserving the other slot. Withhold the reputation debit
 * while energy work is queued.
 */
export const getRerollElementUserUpdate = ({
  inputElementType,
  resultElement,
  user,
}: {
  inputElementType: "primary" | "secondary";
  resultElement: "Fire" | "Water" | "Wind" | "Earth" | "Lightning";
  user: NonNullable<Awaited<ReturnType<typeof findUserWithBloodline>>>;
}) => ({
  userPatch: {
    primaryElement:
      inputElementType === "primary" ? resultElement : user.primaryElement,
    secondaryElement:
      inputElementType === "secondary" ? resultElement : user.secondaryElement,
  },
  userDelta: hasEnergyQueue(user)
    ? undefined
    : { reputationPoints: -COST_REROLL_ELEMENT },
});

/**
 * Project the saved redistributed stats and their reputation cost. Queued energy work
 * withholds the currency delta.
 */
export const getUpdateStatsUserUpdate = ({
  input,
  user,
  cost,
}: {
  input: {
    offence: number;
    defence: number;
    strength: number;
    speed: number;
    intelligence: number;
    willpower: number;
  };
  user: UserQueueState;
  cost: number;
}) => ({
  userPatch: input,
  userDelta: hasEnergyQueue(user) ? undefined : { reputationPoints: -cost },
});

/** Project the saved gender and the reputation balance remaining after the change fee. */
export const getChangedGenderUserPatch = (
  gender: string,
  reputationPoints: number,
) => ({
  gender,
  reputationPoints: reputationPoints - COST_CHANGE_GENDER,
});
