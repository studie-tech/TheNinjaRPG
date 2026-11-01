import type { UserQueueState } from "@/delta/profile";

import {
  COST_CHANGE_GENDER,
  COST_EXTRA_ITEM_SLOT,
  COST_EXTRA_JUTSU_SLOT,
  COST_REROLL_ELEMENT,
} from "@/drizzle/constants";
import { hasEnergyQueue } from "@/libs/queue";

import type { findUserWithBloodline } from "@/queries/profile";

export const getCreateOfferUserUpdate = ({
  user,
  inputReps,
}: {
  user: UserQueueState;
  inputReps: number;
}) => ({
  userDelta: hasEnergyQueue(user) ? undefined : { reputationPoints: -inputReps },
});

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

export const getBuyItemSlotUserUpdate = ({ user }: { user: UserQueueState }) => ({
  userDelta: hasEnergyQueue(user)
    ? undefined
    : { reputationPoints: -COST_EXTRA_ITEM_SLOT, extraItemSlots: 1 },
});

export const getBuyJutsuSlotUserUpdate = ({ user }: { user: UserQueueState }) => ({
  userDelta: hasEnergyQueue(user)
    ? undefined
    : { reputationPoints: -COST_EXTRA_JUTSU_SLOT, extraJutsuSlots: 1 },
});

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

export const getChangedGenderUserPatch = (
  gender: string,
  reputationPoints: number,
) => ({
  gender,
  reputationPoints: reputationPoints - COST_CHANGE_GENDER,
});
