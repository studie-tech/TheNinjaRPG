/** Pure progression and readiness rules shared by pet presentation and server guards. */
import {
  PET_FED_COLLECTION_SLOTS,
  PET_GENERATION_LEASE_MS,
  PET_MAX_COLLECTION_SLOTS,
  PET_RANKS,
  type UserRank,
} from "@/drizzle/constants";
import type { UserData, UserPet } from "@/drizzle/schema";
import { getPetPotentialCaps } from "@/libs/pets/potential";
import { calcLevelRequirements } from "@/libs/profile";
import { getUserFederalStatus } from "@/utils/paypal";

/** Tier loss reduces new-adoption capacity without removing permanent slots or owned pets. */
export const getPetCollectionCapacity = (
  user: Pick<UserData, "petSlots" | "federalStatus" | "staffAccount">,
) => {
  const bonusSlots = PET_FED_COLLECTION_SLOTS[getUserFederalStatus(user)];
  return {
    permanentSlots: user.petSlots,
    bonusSlots,
    slots: user.petSlots + bonusSlots,
    maxSlots: PET_MAX_COLLECTION_SLOTS + bonusSlots,
  };
};

/** Resolve rank metadata, falling back to the starting rank for unknown saved values. */
export const getPetRank = (rank: number) =>
  PET_RANKS.find((entry) => entry.rank === rank) ?? PET_RANKS[0];

/**
 * Highest companion evolution supported by the owner's actual character rank.
 * Elite Jonin is the top shinobi rank. Elder is a village office held by Jonin,
 * who return to JONIN when they leave it, so it carries Jonin progression.
 */
export const getMaxPetRank = (ownerRank: UserRank) => {
  const ranks: Record<UserRank, number> = {
    STUDENT: 1,
    GENIN: 3,
    CHUNIN: 5,
    JONIN: 7,
    "ELITE JONIN": 10,
    ELDER: 7,
    NONE: 0,
  };
  return ranks[ownerRank];
};

/**
 * Abandoned generation leases expire without releasing ownership.
 * A missing start time stays active so incomplete leases cannot be replaced or reset.
 */
export const hasActiveGeneration = (
  pet: Pick<UserPet, "generationStatus" | "generationStartedAt">,
  now = new Date(),
) =>
  pet.generationStatus === "GENERATING" &&
  (!pet.generationStartedAt ||
    now.getTime() - pet.generationStartedAt.getTime() < PET_GENERATION_LEASE_MS);

/**
 * A claim whose lease expired was never settled (timeout, crash or a failed settle write),
 * so it produced no accepted image.
 */
export const isAbandonedGeneration = (
  pet: Pick<UserPet, "generationStatus" | "generationStartedAt">,
  now = new Date(),
) => pet.generationStatus === "GENERATING" && !hasActiveGeneration(pet, now);

/**
 * Attempts limit accepted images: an abandoned claim's attempt is not charged, so the
 * next claim replaces it instead of adding another.
 */
export const getChargedGenerationAttempts = (
  pet: Pick<UserPet, "generationStatus" | "generationStartedAt" | "generationAttempts">,
  now = new Date(),
) =>
  isAbandonedGeneration(pet, now)
    ? Math.max(0, pet.generationAttempts - 1)
    : pet.generationAttempts;

/** Accepted current-rank art stays usable while a cosmetic replacement is generating. */
export const isPetAppearanceReady = (
  pet: Pick<UserPet, "rank" | "generationStatus" | "artRank" | "avatar">,
) =>
  pet.rank >= 1 &&
  pet.rank <= PET_RANKS.length &&
  (pet.generationStatus === "READY" || pet.generationStatus === "GENERATING") &&
  pet.artRank === pet.rank &&
  Boolean(pet.avatar);

/** Check combat/XP eligibility; collection ownership and active selection are caller guards. */
export const canUsePet = (
  pet: Pick<
    UserPet,
    "rank" | "battleEnabled" | "generationStatus" | "artRank" | "avatar"
  >,
  owner: { rank: UserRank },
) =>
  pet.battleEnabled &&
  pet.rank <= getMaxPetRank(owner.rank) &&
  isPetAppearanceReady(pet);

/** Derive level from total assigned XP using player thresholds, capped by pet rank. */
export const getPetLevel = (pet: Pick<UserPet, "rank" | "experience">) => {
  const cap = getPetRank(pet.rank).levelCap;
  let level = 1;
  while (level < cap && pet.experience >= calcLevelRequirements(level)) level += 1;
  return level;
};

/** Potential allocations define lifetime stat caps independently of evolution rank. */
export const getPetStatCaps = getPetPotentialCaps;

/** Return the first progression prerequisite to show the owner, or null when met. */
export const petRankUpBlockMessage = (
  pet: Pick<
    UserPet,
    | "rank"
    | "experience"
    | "generationStatus"
    | "generationStartedAt"
    | "artRank"
    | "avatar"
  >,
  owner: { rank: UserRank },
) => {
  const next = PET_RANKS.find((entry) => entry.rank === pet.rank + 1);
  if (!next) return "Your pet has reached its highest rank.";
  if (hasActiveGeneration(pet) || !isPetAppearanceReady(pet))
    return "Finish your pet's current appearance before evolving again.";
  if (next.rank > getMaxPetRank(owner.rank))
    return `Reach ${next.minUserRank} before evolving to ${next.name}.`;
  if (pet.experience < next.experienceRequired)
    return `Assign ${next.experienceRequired.toLocaleString("en-US")} total experience to evolve to ${next.name}.`;
  return null;
};
