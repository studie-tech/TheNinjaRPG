import { getNextUserSnapshotAt } from "@/server/utils/concurrency";

/**
 * Project the claimed pet slot and account revision together with its confirmed currency
 * debit.
 */
export const getUnlockSlotUserUpdate = ({
  userPetSlots,
  claimClaimedAt,
  paymentColumnName,
  paymentCost,
}: {
  userPetSlots: number;
  claimClaimedAt: Date;
  paymentColumnName: string;
  paymentCost: number;
}) => ({
  userPatch: { petSlots: userPetSlots + 1, updatedAt: claimClaimedAt },
  userDelta: { [paymentColumnName]: -paymentCost },
});

/** Select the active pet, restore its stored XP and advance the account snapshot timestamp. */
export const getActivatePetUserUpdate = ({
  petId,
  petStoredExperience,
  userUpdatedAt,
  now,
}: {
  petId: string;
  petStoredExperience: number;
  userUpdatedAt: Date;
  now: Date;
}) => ({
  userPatch: {
    activePetId: petId,
    petExperience: petStoredExperience,
    updatedAt: getNextUserSnapshotAt(userUpdatedAt, now),
  },
});

/** Confirm that a pet-specific operation leaves the cached user profile unchanged. */
export const getUnchangedPetUserUpdate = () => ({
  userPatch: {},
});

/** Advance the account revision and credit pet XP only when the fed pet is active. */
export const getFeedPetUserUpdate = ({
  userUpdatedAt,
  now,
  isActive,
  experience,
}: {
  userUpdatedAt: Date;
  now: Date;
  isActive: boolean;
  experience: number;
}) => ({
  userPatch: { updatedAt: getNextUserSnapshotAt(userUpdatedAt, now) },
  userDelta: isActive ? { petExperience: experience } : {},
});

/**
 * Record the confirmed acquisition and daily species claim, debit payment and activate the
 * pet when no pet is active.
 */
export const getAcquirePetUserUpdate = ({
  userActivePetId,
  petId,
  userPetAcquisitions,
  dayKey,
  claimedSpecies,
  inputSpeciesId,
  paymentColumnName,
  paymentCost,
}: {
  userActivePetId: string | null;
  petId: string;
  userPetAcquisitions: number;
  dayKey: string;
  claimedSpecies: string[];
  inputSpeciesId: string;
  paymentColumnName: string;
  paymentCost: number;
}) => ({
  userPatch: {
    ...(!userActivePetId ? { activePetId: petId, petExperience: 0 } : {}),
    petAcquisitions: userPetAcquisitions + 1,
    petDailyClaims: {
      dayKey,
      speciesIds: [...claimedSpecies, inputSpeciesId],
    },
  },
  userDelta: { [paymentColumnName]: -paymentCost },
});

/** Clear the released active pet and its cached XP bank. */
export const getReleasePetUserUpdate = () => ({
  userPatch: { activePetId: null, petExperience: 0 },
});

/**
 * Project the remaining XP bank only for the active pet; assigning an inactive pet leaves the
 * profile unchanged.
 */
export const getAssignExperienceUserUpdate = ({
  isActive,
  availableExperience,
  spent,
}: {
  isActive: boolean;
  availableExperience: number;
  spent: number;
}) => ({
  userPatch: isActive ? { petExperience: availableExperience - spent } : {},
});
