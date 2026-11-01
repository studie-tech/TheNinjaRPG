import { getNextUserSnapshotAt } from "@/server/utils/concurrency";

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

export const getUnchangedPetUserUpdate = () => ({
  userPatch: {},
});

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

export const getReleasePetUserUpdate = () => ({
  userPatch: { activePetId: null, petExperience: 0 },
});

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
