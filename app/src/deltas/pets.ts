import type { RouterOutputs } from "@/app/_trpc/client";
import type { CombatStatName } from "@/drizzle/constants";
import { PET_EXPERIENCE_TRANSFER_COST } from "@/drizzle/constants";
import type { UserData, UserPet } from "@/drizzle/schema";
import { getPetTransferStats } from "@/libs/pets/potential";
import { petRankUpBlockMessage } from "@/libs/pets/progression";
import { getNextUserSnapshotAt } from "@/utils/time";

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

/** Project committed integer pet allocations; fractional stat snapshots or costs require a read. */
export const getAssignExperienceUserUpdate = ({
  user,
  pet,
  stats,
  availableExperience,
  spent,
  now,
}: {
  user: Pick<UserData, "activePetId" | "rank">;
  pet: UserPet;
  stats: Pick<UserPet, CombatStatName>;
  availableExperience: number;
  spent: number;
  now: Date;
}) => {
  const isActive = user.activePetId === pet.id;
  // Fractional SQL parameters can round differently from JavaScript doubles.
  if (!Number.isSafeInteger(spent) || !Object.values(stats).every(Number.isSafeInteger))
    return { userPatch: isActive ? undefined : {}, petUpdate: undefined };
  const updated = {
    ...stats,
    experience: pet.experience + spent,
    storedExperience: isActive ? pet.storedExperience : availableExperience - spent,
    revision: pet.revision + 1,
    updatedAt: now,
  };
  const rankUpReason = petRankUpBlockMessage({ ...pet, ...updated }, user);
  return {
    userPatch: isActive ? { petExperience: availableExperience - spent } : {},
    petUpdate: {
      id: pet.id,
      previousRevision: pet.revision,
      ...updated,
      unusedExperience: availableExperience - spent,
      canRankUp: rankUpReason === null,
      rankUpReason,
    },
  };
};

/** Committed XP projection shared by the selected pet and collection caches. */
type PetExperienceUpdate = NonNullable<
  ReturnType<typeof getAssignExperienceUserUpdate>["petUpdate"]
>;

/** Update only the selected pet's matching revision, preserving unrelated collection and care data. */
export const getAssignedPetExperience = (
  current: RouterOutputs["pets"]["getPet"],
  update: PetExperienceUpdate | undefined,
): RouterOutputs["pets"]["getPet"] | undefined => {
  if (
    !update ||
    current.pet?.id !== update.id ||
    current.pet.revision !== update.previousRevision ||
    !current.pets.some(
      (pet) => pet.id === update.id && pet.revision === update.previousRevision,
    )
  )
    return;
  const {
    id,
    previousRevision: _previous,
    unusedExperience,
    canRankUp,
    rankUpReason,
    ...patch
  } = update;
  return {
    ...current,
    pet: { ...current.pet, ...patch },
    pets: current.pets.map((pet) => (pet.id === id ? { ...pet, ...patch } : pet)),
    unusedExperience,
    canRankUp,
    rankUpReason,
  };
};

/** Apply the same committed XP allocation to a loaded collection, or refetch an unknown pet revision. */
export const getAssignedPetCollection = (
  current: RouterOutputs["pets"]["getCollection"],
  update: PetExperienceUpdate | undefined,
): RouterOutputs["pets"]["getCollection"] | undefined => {
  if (
    !update ||
    !current.pets.some(
      (pet) => pet.id === update.id && pet.revision === update.previousRevision,
    )
  )
    return;
  const {
    id,
    previousRevision: _previous,
    unusedExperience: _unused,
    canRankUp: _canRankUp,
    rankUpReason: _reason,
    ...patch
  } = update;
  return {
    ...current,
    pets: current.pets.map((pet) => (pet.id === id ? { ...pet, ...patch } : pet)),
  };
};

/** Retain source stat proportions and credit transferred assigned XP to the destination's unused bank. */
export const getTransferPetExperienceUpdate = (
  source: UserPet,
  amount: number,
  user: Pick<UserData, "updatedAt" | "activePetId">,
  destinationId: string,
  now: Date,
) => ({
  source: {
    ...getPetTransferStats(source, amount),
    experience: source.experience - amount,
  },
  userPatch: { updatedAt: getNextUserSnapshotAt(user.updatedAt, now) },
  userDelta: {
    money: -PET_EXPERIENCE_TRANSFER_COST,
    ...(user.activePetId === destinationId ? { petExperience: amount } : {}),
  },
});

/** Public settings fields that cannot expose artwork generation leases or owner secrets. */
type PetSettings = Pick<
  UserPet,
  | "name"
  | "gender"
  | "battleEnabled"
  | "spawnPosition"
  | "aiRules"
  | "includeDefaultRules"
>;

/** Publish only the committed settings and snapshot metadata; recovery needs a complete pet refresh. */
export const getSavedPetSettingsUpdate = (
  user: UserData,
  pet: UserPet,
  patch: Partial<PetSettings>,
  now: Date,
  recovered: boolean,
) => ({
  userPatch: recovered ? {} : { updatedAt: getNextUserSnapshotAt(user.updatedAt, now) },
  petSettingsUpdate: recovered
    ? undefined
    : {
        id: pet.id,
        ownerId: user.userId,
        previousOwnerUpdatedAt: user.updatedAt,
        previousRevision: pet.revision,
        revision: pet.revision + 1,
        updatedAt: now,
        name: patch.name ?? pet.name,
        gender: patch.gender ?? pet.gender,
        battleEnabled: patch.battleEnabled ?? pet.battleEnabled,
        spawnPosition: patch.spawnPosition ?? pet.spawnPosition,
        aiRules: patch.aiRules ?? pet.aiRules,
        includeDefaultRules: patch.includeDefaultRules ?? pet.includeDefaultRules,
      },
});

type PetSettingsUpdate = NonNullable<
  ReturnType<typeof getSavedPetSettingsUpdate>["petSettingsUpdate"]
>;

/** Advance only the matching owner's saved timestamp, preserving concurrent account changes. */
export const getSavedPetSettingsOwnerPatch = (
  user: Pick<UserData, "userId" | "updatedAt">,
  update: PetSettingsUpdate,
) =>
  user.userId === update.ownerId &&
  user.updatedAt.getTime() === update.previousOwnerUpdatedAt.getTime()
    ? { updatedAt: getNextUserSnapshotAt(user.updatedAt, update.updatedAt) }
    : undefined;

/** Reconcile selected settings only when both pet projections still hold the committed baseline. */
export const getSavedPetSettings = (
  current: RouterOutputs["pets"]["getPet"],
  update: PetSettingsUpdate | undefined,
): RouterOutputs["pets"]["getPet"] | undefined => {
  if (
    !update ||
    current.pet?.id !== update.id ||
    current.pet.revision !== update.previousRevision ||
    !current.pets.some(
      (pet) => pet.id === update.id && pet.revision === update.previousRevision,
    )
  )
    return;
  const {
    ownerId: _owner,
    previousOwnerUpdatedAt: _ownerAt,
    previousRevision: _previous,
    id,
    ...patch
  } = update;
  return {
    ...current,
    pet: { ...current.pet, ...patch },
    pets: current.pets.map((pet) => (pet.id === id ? { ...pet, ...patch } : pet)),
  };
};

/** Reconcile a loaded companion collection without changing eligibility, species or generation state. */
export const getSavedPetSettingsCollection = (
  current: RouterOutputs["pets"]["getCollection"],
  update: PetSettingsUpdate | undefined,
): RouterOutputs["pets"]["getCollection"] | undefined => {
  if (
    !update ||
    !current.pets.some(
      (pet) => pet.id === update.id && pet.revision === update.previousRevision,
    )
  )
    return;
  const {
    ownerId: _owner,
    previousOwnerUpdatedAt: _ownerAt,
    previousRevision: _previous,
    id,
    ...patch
  } = update;
  return {
    ...current,
    pets: current.pets.map((pet) => (pet.id === id ? { ...pet, ...patch } : pet)),
  };
};

/** Advance the owner cache to the timestamp claimed when revealing a companion's saved potential. */
export const getRevealedPetPotentialUserUpdate = (
  user: Pick<UserData, "updatedAt">,
  now: Date,
) => ({
  userPatch: { updatedAt: getNextUserSnapshotAt(user.updatedAt, now) },
});
