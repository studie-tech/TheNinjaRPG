import * as Sentry from "@sentry/nextjs";
import { and, eq, exists, gte, isNull, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  getAcquirePetUserUpdate,
  getActivatePetUserUpdate,
  getAssignExperienceUserUpdate,
  getFeedPetUserUpdate,
  getReleasePetUserUpdate,
  getSavedPetSettingsUpdate,
  getUnchangedPetUserUpdate,
  getUnlockSlotUserUpdate,
} from "@/deltas/pets";
import {
  CombatStatNames,
  getCombatStatCap,
  MAP_WAKE_ISLAND_SECTOR,
  PET_BATTLE_CONFIG,
  PET_COLLECTION_SLOT_COST,
  PET_FEED_COOLDOWN_HOURS,
  PET_FEED_EXPERIENCE_BY_RARITY,
  PET_GENERATION_LEASE_MS,
  PET_GENERATION_RETRY_MS,
  PET_MAX_ABILITY_SLOTS,
  PET_MAX_COLLECTION_SLOTS,
  PET_MAX_GENERATION_ATTEMPTS,
  PET_OPTION_COUNTS,
  PET_RANKS,
  PET_REPLACEMENT_COST,
  PET_SANCTUARY_NAME,
  PET_SEICHI_SILVER_COST,
  PetGenders,
  type PetPaymentCurrency,
  PetSpawnPositions,
} from "@/drizzle/constants";
import { type UserData, type UserPet, userData, userPet } from "@/drizzle/schema";
import { actionPrerequisiteUser } from "@/libs/actionReadiness";
import { getPetArtProvider } from "@/libs/gamesettings";
import {
  getPetAbilityCapacity,
  isPetJutsuAllowedForSpecies,
  isPetSkillAllowed,
  validatePetAbilities,
} from "@/libs/pets/abilities";
import { generatePetAppearance } from "@/libs/pets/appearance";
import { getDailyPetOptions, isAvailablePetAppearance } from "@/libs/pets/catalogue";
import { createPetFromSpecies } from "@/libs/pets/creation";
import { getPetGenderUpdateError } from "@/libs/pets/gender";
import {
  canChoosePetAppearance,
  getChargedGenerationAttempts,
  getMaxPetRank,
  getPetCollectionCapacity,
  getPetStatCaps,
  hasActiveGeneration,
  isAbandonedGeneration,
  isPetAppearanceReady,
  petRankUpBlockMessage,
} from "@/libs/pets/progression";
import { getAssignedCombatStatTotal } from "@/libs/profile";
import { updateUserForActionReadiness } from "@/queries/actionReadiness";
import { deleteEmptyUserItem } from "@/queries/item";
import {
  deleteUserPetForReleasePet,
  executeActivatedForActivatePet,
  executeAssignedForAssignExperience,
  executeFedForFeedPet,
  executeRemovedForReleasePet,
  executeResultForUpdateOwnedPet,
  fetchPetAbilities,
  fetchPetOwner,
  findUserItemForFeedPet,
  insertUserPet,
  insertUserUploadForGenerateAppearance,
  listPetSpeciesForGetPet,
  listUserItemForGetPet,
  listVisiblePetJutsu,
  selectPetSpeciesForWhere,
  selectUserDataForActivatePet,
  selectUserPetForWhere,
  updateUserPetForGenerateAppearance,
  updateUserPetForGenerateAppearance2,
  updateUserPetForGenerateAppearance3,
} from "@/queries/pets";
import {
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import {
  type ActionReadinessWrite,
  actionReadinessResponse,
  prepareActionReadiness,
} from "@/server/utils/actionReadiness";
import { claimUserSnapshot } from "@/server/utils/concurrency";
import { isMysqlDuplicateKeyError, retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { logError } from "@/server/utils/sentry";
import { getUserFederalStatus } from "@/utils/paypal";
import {
  getNextUserSnapshotAt,
  getPetFeedAvailableAt,
  getUtcDayKey,
} from "@/utils/time";
import { AiRule } from "@/validators/ai";
import {
  acquirePetSchema,
  assignPetExperienceSchema,
  petPaymentSchema,
  petSelectionSchema,
  updatePetAiSchema,
  updatePetSchema,
} from "@/validators/pets";
import { userDeltaResponseSchema } from "@/validators/userCache";

/** Include the displayed stack quantity so a changed meal stack must be refreshed before consumption. */
const feedPetSchema = petSelectionSchema.extend({
  userItemId: z.string().min(1).max(191),
  expectedQuantity: z.number().int().positive(),
});

/** Bound request size; owner access, duplicates and the combined budget are validated against live content. */
const updatePetAbilitiesSchema = petSelectionSchema.extend({
  jutsuIds: z.array(z.string().min(1).max(191)).max(PET_MAX_ABILITY_SLOTS),
  skillIds: z.array(z.string().min(1).max(191)).max(PET_MAX_ABILITY_SLOTS),
});

/** Only founders without accepted artwork can choose daily cosmetics. */
const generatePetAppearanceSchema = petSelectionSchema.extend({
  appearance: acquirePetSchema
    .pick({
      dayKey: true,
      paletteIndex: true,
      characteristicIndex: true,
      auraIndex: true,
    })
    .optional(),
});

/** Settings responses expose a fixed public allowlist, never a database pet row. */
const petSettingsResponseSchema = userDeltaResponseSchema.extend({
  petSettingsUpdate: z
    .object({
      id: z.string(),
      ownerId: z.string(),
      previousOwnerUpdatedAt: z.date(),
      previousRevision: z.number(),
      revision: z.number(),
      updatedAt: z.date(),
      name: z.string(),
      gender: z.enum(PetGenders).nullable(),
      battleEnabled: z.boolean(),
      spawnPosition: z.enum(PetSpawnPositions),
      aiRules: z.array(AiRule),
      includeDefaultRules: z.boolean(),
    })
    .optional(),
});

/** Own, configure and progress companions through guarded account and pet snapshots. */
export const petsRouter = createTRPCRouter({
  /** Buy collection capacity and debit its price in one account update. */
  unlockSlot: protectedProcedure
    .input(petPaymentSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const { user: initialUser, settings } = await fetchPetOwner(
        ctx.drizzle,
        ctx.userId,
        undefined,
        true,
      );
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      if (user.isBanned || user.status !== "AWAKE" || user.battleId || user.isAi)
        return errorResponse(
          "You must be awake and out of combat to unlock a companion slot.",
        );
      if (user.petSlots >= PET_MAX_COLLECTION_SLOTS)
        return errorResponse("Your companion collection has all available slots.");
      const payment = getPetPayment(user, input.currency, PET_COLLECTION_SLOT_COST);
      if (payment.balance < payment.cost)
        return errorResponse(
          `A collection slot costs ${payment.cost} ${payment.label}.`,
        );
      const claim = await retryOnDeadlock(() =>
        claimUserSnapshot({
          client: ctx.drizzle,
          userId: ctx.userId,
          updatedAt: user.updatedAt,
          readiness,
          where: [
            ...ownerMutationWhere(user),
            eq(userData.petSlots, user.petSlots),
            gte(payment.column, payment.cost),
          ],
          set: {
            petSlots: sql`${userData.petSlots} + 1`,
            [payment.column.name]: sql`${payment.column} - ${payment.cost}`,
          },
        }),
      );
      return claim.success
        ? actionReadinessResponse(
            {
              success: true,
              message: "Companion collection slot unlocked.",
              ...getUnlockSlotUserUpdate({
                userPetSlots: user.petSlots,
                claimClaimedAt: claim.claimedAt,
                paymentColumnName: payment.column.name,
                paymentCost: payment.cost,
              }),
            },
            readiness,
            ctx.drizzle,
          )
        : changedResponse();
    }),

  /** Move both unused XP banks with their companions when changing the active selection. */
  activatePet: protectedProcedure
    .input(petSelectionSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        user: initialUser,
        pet,
        pets,
        settings,
      } = await fetchPetOwner(ctx.drizzle, ctx.userId, input.petId, true);
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const restriction = petMutationBlockMessage(user, pet);
      if (restriction || !pet) return errorResponse(restriction ?? "Pet not found");
      if (pet.id === user.activePetId)
        return errorResponse("This companion is already active.");
      if (pet.rank > getMaxPetRank(user.rank))
        return errorResponse("Your rank does not support this companion rank.");
      const previous = pets.find((entry) => entry.id === user.activePetId);
      if (user.activePetId && !previous) return changedResponse();
      const now = new Date();

      // LIMIT materializes the locking snapshot, preserving XP earned before this
      // statement independently of MySQL's unspecified multi-table assignment order.
      const ownerSnapshot = selectUserDataForActivatePet(
        ctx.drizzle,
        (snapshot) => ownerSnapshotWhere(snapshot, readiness),
        user,
        readiness,
      );
      // Drizzle's MySQL UPDATE builder cannot update the owner and both pets together.
      const activated = await retryOnDeadlock(() =>
        executeActivatedForActivatePet(
          ctx.drizzle,
          ownerSnapshot,
          previous,
          pet,
          user,
          now,
          (snapshot) => ownerSnapshotWhere(snapshot, readiness),
          readiness,
        ),
      );
      return activated.rowsAffected > 0
        ? actionReadinessResponse(
            {
              success: true,
              message: `${pet.name} is now your active companion.`,
              ...getActivatePetUserUpdate({
                petId: pet.id,
                petStoredExperience: pet.storedExperience,
                userUpdatedAt: user.updatedAt,
                now,
              }),
            },
            readiness,
            ctx.drizzle,
          )
        : changedResponse();
    }),

  /** Equip published pet jutsus and activated skills within the companion's shared budget. */
  updateAbilities: protectedProcedure
    .input(updatePetAbilitiesSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [{ user: initialUser, pet, settings }, abilities] = await Promise.all([
        fetchPetOwner(ctx.drizzle, ctx.userId, input.petId, true),
        fetchPetAbilities(ctx.drizzle, ctx.userId),
      ]);
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const restriction = petMutationBlockMessage(user, pet);
      if (restriction || !pet) return errorResponse(restriction ?? "Pet not found");
      const blocked = validatePetAbilities({
        pet: { ...pet, jutsuIds: input.jutsuIds, skillIds: input.skillIds },
        owner: user,
        ...abilities,
      });
      if (blocked) return errorResponse(blocked);
      const changed = await updateOwnedPet(
        ctx.drizzle,
        user,
        pet,
        {
          jutsuIds: input.jutsuIds,
          skillIds: input.skillIds,
        },
        readiness,
      );
      return changed
        ? actionReadinessResponse(
            {
              success: true,
              message: "Companion abilities updated.",
              ...getUnchangedPetUserUpdate(),
            },
            readiness,
            ctx.drizzle,
          )
        : changedResponse();
    }),

  /** Exchange one carried meal for XP after the companion's feeding cooldown. */
  feedPet: protectedProcedure
    .input(feedPetSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const [{ user: initialUser, pet, settings }, meal] = await Promise.all([
        fetchPetOwner(ctx.drizzle, ctx.userId, input.petId, true),
        findUserItemForFeedPet(ctx.drizzle, input, ctx),
      ]);
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const now = new Date();
      const feedBlock = petFeedBlockMessage(user, pet, now);
      if (feedBlock || !pet) return errorResponse(feedBlock ?? "Pet not found");
      if (
        meal?.item?.itemType !== "MEAL" ||
        meal.storedAtHome ||
        meal.isInAuction ||
        meal.equipped !== "NONE" ||
        (meal.craftingFinishedAt && meal.craftingFinishedAt > now)
      )
        return errorResponse(
          "Carry a finished meal in your inventory to feed your companion.",
        );
      if (input.expectedQuantity !== meal.quantity || meal.quantity <= 0)
        return errorResponse("Your meal stack changed. Refresh and try again.");
      const experience = PET_FEED_EXPERIENCE_BY_RARITY[meal.item.rarity];
      const isActive = user.activePetId === pet.id;
      // One joined UPDATE guards the account, pet and exact meal stack before any
      // debit or XP grant. Zero quantities are harmless tombstones until cleanup.
      const fed = await retryOnDeadlock(() =>
        executeFedForFeedPet(
          ctx.drizzle,
          user,
          now,
          meal,
          isActive,
          experience,
          (snapshot) => ownerSnapshotWhere(snapshot, readiness),

          pet,
          ctx,
          readiness,
        ),
      );
      if (fed.rowsAffected === 0) return changedResponse();
      if (meal.quantity === 1) {
        try {
          await retryOnDeadlock(() =>
            deleteEmptyUserItem(ctx.drizzle, meal.id, ctx.userId),
          );
        } catch (error) {
          // The feed already committed; inventory hides zero stacks and its cleaner
          // reclaims them. Report success so a cleanup failure cannot repeat the grant.
          Sentry.captureException(error, {
            level: "warning",
            tags: { source: "feedPet" },
          });
        }
      }
      return actionReadinessResponse(
        {
          success: true,
          ...getFeedPetUserUpdate({
            userUpdatedAt: user.updatedAt,
            now,
            isActive,
            experience,
          }),

          message: `${pet.name} enjoyed its meal and gained ${experience.toLocaleString("en-US")} companion experience.`,
        },
        readiness,
        ctx.drizzle,
      );
    }),

  /** Return the owner's collection without exposing server-only generation tokens. */
  getCollection: protectedProcedure.query(async ({ ctx }) => {
    const { user, pets } = await fetchPetOwner(ctx.drizzle, ctx.userId);
    if (!user) throw serverError("NOT_FOUND", "User not found");
    return { pets: pets.map(omitGenerationToken), activePetId: user.activePetId };
  }),

  /** Assemble companion progression, abilities, meals and daily sanctuary choices. */
  getPet: protectedProcedure
    .input(petSelectionSchema.optional())
    .query(async ({ ctx, input }) => {
      const [{ user, pet, pets }, abilities, species, meals] = await Promise.all([
        fetchPetOwner(ctx.drizzle, ctx.userId, input?.petId),
        fetchPetAbilities(ctx.drizzle, ctx.userId),
        listPetSpeciesForGetPet(ctx.drizzle),
        listUserItemForGetPet(ctx.drizzle, ctx),
      ]);
      if (!user) throw serverError("NOT_FOUND", "User not found");
      const now = new Date();
      const dayKey = getUtcDayKey(now);
      const prerequisiteUser = actionPrerequisiteUser(user);
      const capacity = getPetCollectionCapacity(user);
      const federalStatus = getUserFederalStatus(user);
      const options = getDailyPetOptions(
        user.userId,
        federalStatus,
        species,
        dayKey,
        user.petDailyClaims,
      );
      const nextFeedAt = getPetFeedAvailableAt(pet?.lastFedAt ?? null);
      const feedAvailableAt = nextFeedAt && nextFeedAt > now ? nextFeedAt : null;
      // Buying capacity or releasing a companion cannot replenish exhausted daily offers.
      const acquisitionRestriction = !species.some((entry) => entry.isActive)
        ? "The Bondkeepers are not offering new companions right now. Please check back later."
        : options.species.length === 0
          ? "You have adopted all of today's companion species. New choices arrive at midnight UTC."
          : capacity.slots <= pets.length
            ? "Unlock another collection slot or release a companion before adopting another."
            : acquisitionBlockMessage(prerequisiteUser);
      const rankUpReason = pet
        ? (petMutationBlockMessage(prerequisiteUser, pet) ??
          petRankUpBlockMessage(pet, user))
        : "Adopt a pet first.";
      const attempts = pet ? getChargedGenerationAttempts(pet) : 0;
      // A generation token is server-only; the UI needs its status and retry time instead.
      const visiblePet = pet ? omitGenerationToken(pet) : null;
      return {
        pet: visiblePet,
        pets: pets.map(omitGenerationToken),
        activePetId: user.activePetId,
        ...capacity,
        slotCost: PET_COLLECTION_SLOT_COST,
        slotSilverCost: PET_SEICHI_SILVER_COST,
        abilities: {
          jutsus: abilities.jutsus.filter((entry) =>
            isPetJutsuAllowedForSpecies(entry, pet?.speciesId),
          ),
          skills: abilities.skills.filter(isPetSkillAllowed),
        },
        abilityCapacity: pet ? getPetAbilityCapacity(pet) : null,
        feedMeals: meals
          .filter((meal) => meal.item?.itemType === "MEAL")
          .map((meal) => ({
            id: meal.id,
            quantity: meal.quantity,
            name: meal.item.name,
            rarity: meal.item.rarity,
            experience: PET_FEED_EXPERIENCE_BY_RARITY[meal.item.rarity],
          })),
        feedAvailableAt,
        canFeed: !petFeedBlockMessage(prerequisiteUser, pet, now),
        options,
        dayKey,
        optionCount: PET_OPTION_COUNTS[federalStatus],
        replacementCost: user.petAcquisitions === 0 ? 0 : PET_REPLACEMENT_COST,
        replacementSilverCost: user.petAcquisitions === 0 ? 0 : PET_SEICHI_SILVER_COST,
        canAcquire: !acquisitionRestriction,
        unavailableReason: acquisitionRestriction,
        unusedExperience:
          pet?.id === user.activePetId
            ? user.petExperience
            : (pet?.storedExperience ?? 0),
        nextRank: pet
          ? (PET_RANKS.find((rank) => rank.rank === pet.rank + 1) ?? null)
          : null,
        maxRank: getMaxPetRank(user.rank),
        canRankUp: Boolean(pet) && !rankUpReason,
        rankUpReason,
        generationLimit: PET_MAX_GENERATION_ATTEMPTS,
        remainingGenerations: Math.max(0, PET_MAX_GENERATION_ATTEMPTS - attempts),
        generationRetryAt: pet?.generationStartedAt
          ? new Date(
              pet.generationStartedAt.getTime() +
                (pet.generationStatus === "GENERATING"
                  ? PET_GENERATION_LEASE_MS
                  : PET_GENERATION_RETRY_MS),
            )
          : null,
      };
    }),

  /** Adopt the first companion free, then charge each additional adoption exactly once. */
  acquirePet: protectedProcedure
    .input(acquirePetSchema)
    .output(userDeltaResponseSchema.extend({ petId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [{ user: initialUser, pets, settings }, species, jutsus] =
        await Promise.all([
          fetchPetOwner(ctx.drizzle, ctx.userId, undefined, true),
          listPetSpeciesForGetPet(ctx.drizzle),
          listVisiblePetJutsu(ctx.drizzle),
        ]);
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const restriction = acquisitionBlockMessage(user);
      if (restriction) return errorResponse(restriction);
      const capacity = getPetCollectionCapacity(user);
      if (pets.length >= capacity.slots)
        return errorResponse(
          "Unlock another collection slot or release a companion before adopting another.",
        );
      const dayKey = getUtcDayKey();
      if (input.dayKey !== dayKey)
        return errorResponse(
          "Today's companion choices changed. Refresh and choose again.",
        );
      const claimedSpecies =
        user.petDailyClaims?.dayKey === dayKey ? user.petDailyClaims.speciesIds : [];
      if (claimedSpecies.includes(input.speciesId))
        return errorResponse(
          "You have already adopted this species today. New choices arrive at midnight UTC.",
        );
      if (
        !isAvailablePetAppearance(
          input,
          getDailyPetOptions(
            user.userId,
            getUserFederalStatus(user),
            species,
            dayKey,
            user.petDailyClaims,
          ),
        )
      )
        return errorResponse("Choose from your available companion traits for today.");
      const payment = getPetPayment(
        user,
        input.currency,
        user.petAcquisitions === 0 ? 0 : PET_REPLACEMENT_COST,
      );
      if (payment.balance < payment.cost)
        return errorResponse(
          `Adopting a companion costs ${payment.cost} ${payment.label}.`,
        );
      const selectedSpecies = species.find((entry) => entry.id === input.speciesId);
      if (!selectedSpecies)
        return errorResponse("This companion species is unavailable.");
      const created = createPetFromSpecies({
        species: selectedSpecies,
        user,
        jutsus,
        name: input.name,
        gender: input.gender,
        appearance: input,
      });
      const petId = created.id;
      try {
        // MySQL cannot insert the pet and update its owner's debit/counters/first
        // selection in one statement. Keep this transaction to those paired writes.
        const acquired = await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            const claim = await claimUserSnapshot({
              client: tx,
              userId: user.userId,
              updatedAt: user.updatedAt,
              readiness,
              where: [
                ...ownerMutationWhere(user),
                eq(userData.isAi, false),
                eq(userData.sector, MAP_WAKE_ISLAND_SECTOR),
                eq(userData.federalStatus, user.federalStatus),
                eq(userData.staffAccount, user.staffAccount),
                eq(userData.petAcquisitions, user.petAcquisitions),
                eq(userData.petSlots, user.petSlots),
                lt(selectUserPetForWhere(tx, user), capacity.slots),
                gte(payment.column, payment.cost),
                // Retirement must win before a claim charges either balance or grants a pet.
                exists(selectPetSpeciesForWhere(tx, input)),
              ],
              set: {
                ...(!user.activePetId ? { activePetId: petId, petExperience: 0 } : {}),
                petAcquisitions: sql`${userData.petAcquisitions} + 1`,
                petDailyClaims: {
                  dayKey,
                  speciesIds: [...claimedSpecies, input.speciesId],
                },
                [payment.column.name]: sql`${payment.column} - ${payment.cost}`,
              },
            });
            if (!claim.success) return false;
            await insertUserPet(tx, created);
            return true;
          }),
        );
        if (!acquired) return changedResponse();
        return actionReadinessResponse(
          {
            success: true,
            petId,
            ...getAcquirePetUserUpdate({
              userActivePetId: user.activePetId,
              petId,
              userPetAcquisitions: user.petAcquisitions,
              dayKey,
              claimedSpecies,
              inputSpeciesId: input.speciesId,
              paymentColumnName: payment.column.name,
              paymentCost: payment.cost,
            }),

            message: payment.cost
              ? `Companion adopted for ${payment.cost} ${payment.label}. Its appearance is ready to generate.`
              : "Your first companion is adopted free. Its appearance is ready to generate.",
          },
          readiness,
          ctx.drizzle,
        );
      } catch (error) {
        if (isPetMutationConflict(error) || isMysqlDuplicateKeyError(error))
          return changedResponse();
        throw error;
      }
    }),

  /** Remove an owned companion and discard only its own unused XP bank. */
  releasePet: protectedProcedure
    .input(petSelectionSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        user: initialUser,
        pet,
        settings,
      } = await fetchPetOwner(ctx.drizzle, ctx.userId, input.petId, true);
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const restriction = petMutationBlockMessage(user, pet);
      if (restriction || !pet) return errorResponse(restriction ?? "Pet not found");
      if (hasActiveGeneration(pet))
        return errorResponse(
          "Wait for your pet's appearance to finish before releasing it.",
        );
      try {
        // An inactive pet owns its bank entirely. A joined DELETE checks both
        // snapshots without updating or serializing an unrelated active XP bank.
        if (user.activePetId !== pet.id) {
          const recoveredAt = getNextUserSnapshotAt(user.updatedAt);
          // DELETE cannot update the retained owner. Its parallel recovery may win first;
          // accept only that exact owner revision while retaining every pet snapshot guard.
          const [removed, recovered] = await Promise.all([
            retryOnDeadlock(() =>
              executeRemovedForReleasePet(
                ctx.drizzle,
                (snapshot) =>
                  readiness.notice
                    ? or(
                        ownerSnapshotWhere(snapshot, readiness),
                        ownerSnapshotWhere({ ...snapshot, updatedAt: recoveredAt }),
                      )
                    : ownerSnapshotWhere(snapshot),
                user,
                pet,
              ),
            ),
            updateUserForActionReadiness(ctx.drizzle, readiness, recoveredAt),
          ]);
          const response =
            removed.rowsAffected === 1
              ? {
                  success: true,
                  ...getUnchangedPetUserUpdate(),
                  message:
                    "Your companion returned to the sanctuary. Its progress and unused experience were removed.",
                }
              : changedResponse();
          return recovered.rowsAffected > 0
            ? actionReadinessResponse(response, readiness, ctx.drizzle)
            : response;
        }
        // DELETE cannot also reset fields on a retained owner row. The active
        // selection and its XP reset must commit with this pet's deletion.
        const released = await retryOnDeadlock(() =>
          ctx.drizzle.transaction(async (tx) => {
            const claim = await claimUserSnapshot({
              client: tx,
              userId: user.userId,
              updatedAt: user.updatedAt,
              readiness,
              where: ownerMutationWhere(user),
              set: { petExperience: 0, activePetId: null },
            });
            if (!claim.success) return false;
            const removed = await deleteUserPetForReleasePet(tx, pet);
            if (removed.rowsAffected !== 1) throw petMutationConflict();
            return true;
          }),
        );
        return released
          ? actionReadinessResponse(
              {
                success: true,
                ...getReleasePetUserUpdate(),
                message:
                  "Your companion returned to the sanctuary. Its progress and unused experience were removed.",
              },
              readiness,
              ctx.drizzle,
            )
          : changedResponse();
      } catch (error) {
        if (isPetMutationConflict(error)) return changedResponse();
        throw error;
      }
    }),

  /** Save presentation and battle settings without charging reputation. */
  updatePet: protectedProcedure
    .input(updatePetSchema)
    .output(petSettingsResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        user: initialUser,
        pet,
        settings,
      } = await fetchPetOwner(ctx.drizzle, ctx.userId, input.petId, true);
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const restriction = petMutationBlockMessage(user, pet);
      if (restriction || !pet) return errorResponse(restriction ?? "Pet not found");
      if (input.battleEnabled && !PET_BATTLE_CONFIG.enabled)
        return errorResponse("Companion battles are not available yet.");
      if (input.battleEnabled && pet.rank > getMaxPetRank(user.rank))
        return errorResponse("Your rank does not support this companion rank.");
      const genderBlock = getPetGenderUpdateError(pet, input.gender);
      if (genderBlock) return errorResponse(genderBlock);
      const { petId: _petId, ...patch } = input;
      const changed = await updateOwnedPet(ctx.drizzle, user, pet, patch, readiness);
      return changed
        ? actionReadinessResponse(
            {
              success: true,
              message: "Companion settings updated.",
              ...getSavedPetSettingsUpdate(
                user,
                pet,
                patch,
                changed,
                !!readiness.notice,
              ),
            },
            readiness,
            ctx.drizzle,
          )
        : changedResponse();
    }),

  /** Save validated companion AI rules against its current revision. */
  updateAiConfig: protectedProcedure
    .input(updatePetAiSchema)
    .output(petSettingsResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        user: initialUser,
        pet,
        settings,
      } = await fetchPetOwner(ctx.drizzle, ctx.userId, input.petId, true);
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const restriction = petMutationBlockMessage(user, pet);
      if (restriction || !pet) return errorResponse(restriction ?? "Pet not found");
      if (pet.rank > getMaxPetRank(user.rank))
        return errorResponse("Your rank does not support this companion rank.");
      const patch = {
        aiRules: input.rules,
        includeDefaultRules: input.includeDefaultRules,
      };
      const changed = await updateOwnedPet(ctx.drizzle, user, pet, patch, readiness);
      return changed
        ? actionReadinessResponse(
            {
              success: true,
              message: "Companion AI settings updated.",
              ...getSavedPetSettingsUpdate(
                user,
                pet,
                patch,
                changed,
                !!readiness.notice,
              ),
            },
            readiness,
            ctx.drizzle,
          )
        : changedResponse();
    }),

  /** Spend the active or parked bank together with its companion stat gains. */
  assignExperience: protectedProcedure
    .input(assignPetExperienceSchema)
    .output(
      userDeltaResponseSchema.extend({
        // Only exact committed projections are returned; fractional writes use client refetches.
        petUpdate: z
          .object({
            offence: z.number(),
            defence: z.number(),
            strength: z.number(),
            speed: z.number(),
            intelligence: z.number(),
            willpower: z.number(),
            id: z.string(),
            previousRevision: z.number(),
            revision: z.number(),
            experience: z.number(),
            storedExperience: z.number(),
            updatedAt: z.date(),
            unusedExperience: z.number(),
            canRankUp: z.boolean(),
            rankUpReason: z.string().nullable(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const {
        user: initialUser,
        pet,
        settings,
      } = await fetchPetOwner(ctx.drizzle, ctx.userId, input.petId, true);
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const restriction = petMutationBlockMessage(user, pet);
      if (restriction || !pet) return errorResponse(restriction ?? "Pet not found");
      if (pet.rank > getMaxPetRank(user.rank))
        return errorResponse("Your rank does not support this companion rank.");
      if (!isPetAppearanceReady(pet))
        return errorResponse(
          "Finish your pet's appearance before assigning experience.",
        );
      const caps = getPetStatCaps(pet);
      const gains = Object.fromEntries(
        CombatStatNames.map((stat) => [stat, Math.floor(input[stat])]),
      ) as Record<(typeof CombatStatNames)[number], number>;
      if (CombatStatNames.every((stat) => gains[stat] === 0))
        return errorResponse("Select some stats to train.");
      const stats = {
        offence: pet.offence,
        defence: pet.defence,
        strength: pet.strength,
        speed: pet.speed,
        intelligence: pet.intelligence,
        willpower: pet.willpower,
      };
      for (const stat of CombatStatNames) {
        const cap = getCombatStatCap(caps, stat);
        if (stats[stat] + gains[stat] > cap)
          return errorResponse("One or more companion stats exceed this rank's cap.");
        stats[stat] += gains[stat];
      }
      const spent = getAssignedCombatStatTotal(stats) - getAssignedCombatStatTotal(pet);
      const isActive = user.activePetId === pet.id;
      const availableExperience = isActive ? user.petExperience : pet.storedExperience;
      if (spent > availableExperience)
        return errorResponse("Not enough unused companion experience.");
      const now = new Date();
      const bank = isActive ? userData.petExperience : userPet.storedExperience;
      // The bank debit and revision-guarded gains share one match, so a concurrent
      // swap or allocation cannot spend XP without delivering its stat increases.
      const assigned = await retryOnDeadlock(() =>
        executeAssignedForAssignExperience(
          ctx.drizzle,
          user,
          now,
          bank,
          availableExperience,
          spent,
          stats,
          (snapshot) => ownerSnapshotWhere(snapshot, readiness),

          pet,
          readiness,
        ),
      );
      return assigned.rowsAffected > 0
        ? actionReadinessResponse(
            {
              success: true,
              message: `${spent.toLocaleString("en-US")} companion experience assigned.`,
              ...getAssignExperienceUserUpdate({
                user,
                pet,
                stats,
                availableExperience,
                spent,
                now,
              }),
            },
            readiness,
            ctx.drizzle,
          )
        : changedResponse();
    }),

  /** Evolve an eligible companion for free and require art for its new rank. */
  rankUp: protectedProcedure
    .input(petSelectionSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        user: initialUser,
        pet,
        settings,
      } = await fetchPetOwner(ctx.drizzle, ctx.userId, input.petId, true);
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      const restriction = petMutationBlockMessage(user, pet);
      if (restriction || !pet) return errorResponse(restriction ?? "Pet not found");
      const blocked = petRankUpBlockMessage(pet, user);
      if (blocked) return errorResponse(blocked);
      const next = PET_RANKS.find((entry) => entry.rank === pet.rank + 1);
      if (!next) return errorResponse("Your pet has reached its highest rank.");
      // Each evolution gets its own bounded allowance, even if the previous rank exhausted it.
      const changed = await updateOwnedPet(
        ctx.drizzle,
        user,
        pet,
        {
          rank: next.rank,
          generationAttempts: 0,
          generationStatus: "PENDING",
          generationToken: null,
          generationStartedAt: null,
        },
        readiness,
      );
      return changed
        ? actionReadinessResponse(
            {
              success: true,
              ...getUnchangedPetUserUpdate(),
              message: `Your companion is now ${next.name}. Generate its evolved appearance to continue training.`,
            },
            readiness,
            ctx.drizzle,
          )
        : changedResponse();
    }),

  /**
   * Claim one attempt atomically before calling the image provider, then accept only
   * its matching lease. Attempts count accepted images only: a failed generation refunds
   * its attempt in the settle write, and an abandoned (expired, unsettled) claim's attempt
   * is replaced by the next claim. Accepted artwork remains usable until replacement
   * succeeds; redraws and evolutions retain the companion's saved appearance traits.
   */
  generateAppearance: protectedProcedure
    .input(generatePetAppearanceSchema)
    .output(userDeltaResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const {
        user: initialUser,
        pet,
        settings,
      } = await fetchPetOwner(ctx.drizzle, ctx.userId, input.petId, true);
      const provider = getPetArtProvider(settings);
      if (!initialUser) return errorResponse("User not found");
      const readiness = prepareActionReadiness(initialUser, settings);
      if (readiness.error) return errorResponse(readiness.error);
      const user = readiness.user;
      if (!pet) return errorResponse("Pet not found");
      const restriction = petMutationBlockMessage(user, pet);
      if (restriction) return errorResponse(restriction);
      if (!pet.species)
        return errorResponse(
          "This companion's species could not be loaded. Please contact support.",
        );
      if (pet.rank > getMaxPetRank(user.rank))
        return errorResponse("Your rank does not support this companion rank.");
      const now = new Date();
      const dayKey = getUtcDayKey(now);
      if (hasActiveGeneration(pet, now))
        return errorResponse(
          "Your companion's appearance is already generating. Please wait.",
        );
      if (
        pet.generationStartedAt &&
        now.getTime() - pet.generationStartedAt.getTime() < PET_GENERATION_RETRY_MS
      )
        return errorResponse(
          "Please wait a moment before retrying your companion's appearance.",
        );
      // An abandoned claim never produced an image; the new claim replaces its attempt.
      const attempts = getChargedGenerationAttempts(pet, now);
      if (attempts >= PET_MAX_GENERATION_ATTEMPTS)
        return errorResponse(
          `You have used all ${PET_MAX_GENERATION_ATTEMPTS} image attempts for this rank. Your companion is still yours.`,
        );
      if (input.appearance) {
        if (!canChoosePetAppearance(pet))
          return errorResponse(
            "Your companion keeps its saved appearance traits after its first image.",
          );
        // Cosmetics roll independently of species; rewards need not be in daily offers.
        const choices = getDailyPetOptions(
          user.userId,
          getUserFederalStatus(user),
          [],
          dayKey,
        );
        // Saved cosmetics remain eligible even after the daily offerings rotate.
        const selected = input.appearance;
        if (
          selected.dayKey !== dayKey ||
          (selected.paletteIndex !== pet.paletteIndex &&
            !choices.palettes.some(
              (option) => option.index === selected.paletteIndex,
            )) ||
          (selected.characteristicIndex !== pet.characteristicIndex &&
            !choices.characteristics.some(
              (option) => option.index === selected.characteristicIndex,
            )) ||
          (selected.auraIndex !== pet.auraIndex &&
            !choices.auras.some((option) => option.index === selected.auraIndex))
        )
          return errorResponse(
            "Today's appearance choices changed. Refresh and choose again.",
          );
      }
      const appearance = input.appearance && {
        paletteIndex: input.appearance.paletteIndex,
        characteristicIndex: input.appearance.characteristicIndex,
        auraIndex: input.appearance.auraIndex,
      };
      // Claim before spending on the provider; retain accepted cosmetics until replacement succeeds.
      const token = nanoid();
      const claim = await retryOnDeadlock(() =>
        updateUserPetForGenerateAppearance(
          ctx.drizzle,
          token,
          now,
          attempts,

          pet,
          (snapshot) => ownerSnapshotWhere(snapshot, readiness),
          user,
          readiness,
        ),
      );
      if (claim.rowsAffected === 0) return changedResponse();
      try {
        const { avatar, avatarFacing } = await generatePetAppearance(
          { ...pet, ...appearance },
          provider,
          async (imageUrl) => {
            await insertUserUploadForGenerateAppearance(ctx.drizzle, ctx, imageUrl);
          },
        );
        const accepted = await retryOnDeadlock(() =>
          updateUserPetForGenerateAppearance2(
            ctx.drizzle,
            appearance,
            avatar,
            avatarFacing,
            pet,
            ctx,
            token,
          ),
        );
        if (accepted.rowsAffected !== 1)
          return actionReadinessResponse(
            errorResponse(
              "The companion changed before the image completed. Refresh to see its current appearance.",
            ),
            readiness,
            ctx.drizzle,
          );
        return actionReadinessResponse(
          {
            success: true,
            message: "Your companion's appearance is ready.",
            ...getUnchangedPetUserUpdate(),
          },
          readiness,
          ctx.drizzle,
        );
      } catch (error) {
        // Returned failures bypass tRPC's onError; retain diagnostics while the UI offers a retry.
        logError(error, "Companion appearance generation failed", {
          petId: pet.id,
          rank: pet.rank,
        });
        // Attempts limit accepted images, so a failed one is refunded and its retry is free.
        // A failed redraw keeps usable art. An evolution whose free retry also fails keeps
        // its previous look at the new rank so it can still fight and evolve; founders
        // still need art and may retry until an image is accepted.
        const keepsPreviousLook =
          !!pet.avatar &&
          pet.artRank < pet.rank &&
          (pet.generationStatus === "FAILED" || isAbandonedGeneration(pet, now));
        const settled = await retryOnDeadlock(() =>
          updateUserPetForGenerateAppearance3(
            ctx.drizzle,
            keepsPreviousLook,
            pet,
            ctx,
            token,
          ),
        );
        if (keepsPreviousLook && settled.rowsAffected === 1)
          return actionReadinessResponse(
            errorResponse(
              "The evolved image could not be verified, so we kept its previous look. No image attempt was used. Your companion can fight and evolve again; staff can redraw it.",
            ),
            readiness,
            ctx.drizzle,
          );
        return actionReadinessResponse(
          errorResponse(
            "The appearance could not be generated or verified. No image attempt was used and your companion is kept. A retry only uses an attempt if its image is accepted, and never charges adoption again.",
          ),
          readiness,
          ctx.drizzle,
        );
      }
    }),
});

/** Keep the chosen price, label and atomic balance column together for both purchases. */
const getPetPayment = (
  user: Pick<UserData, "reputationPoints" | "seichiSilver">,
  currency: PetPaymentCurrency,
  reputationCost: number,
) => {
  const isSilver = currency === "SEICHI_SILVER";
  return {
    cost: reputationCost === 0 ? 0 : isSilver ? PET_SEICHI_SILVER_COST : reputationCost,
    label: isSilver ? "Seichi Silver" : "reputation points",
    balance: isSilver ? user.seichiSilver : user.reputationPoints,
    column: isSilver ? userData.seichiSilver : userData.reputationPoints,
  };
};

/** Generation tokens are server-only lease credentials. */
const omitGenerationToken = <T extends UserPet>({
  generationToken: _generationToken,
  ...pet
}: T) => pet;

/** Sanctuary adoption requires an eligible, awake player at its current location. */
const acquisitionBlockMessage = (user: UserData) => {
  if (user.isBanned) return "You are banned";
  if (user.status !== "AWAKE" || user.battleId)
    return "You must be awake and out of combat to adopt a companion.";
  if (user.isAi || getMaxPetRank(user.rank) === 0)
    return "Only player characters can adopt a companion.";
  if (user.sector !== MAP_WAKE_ISLAND_SECTOR)
    return `Visit ${PET_SANCTUARY_NAME} on Wake Island to adopt a companion.`;
  return null;
};

/** Reject expected ownership and combat-state restrictions before any write. */
const petMutationBlockMessage = (
  user: UserData | undefined,
  pet: UserPet | undefined,
) => {
  if (!user) return "User not found";
  if (!pet) return "Pet not found";
  if (user.petTask?.petId === pet.id)
    return "Your companion is away on a profession job. Collect its results or cancel the job first.";
  if (user.isBanned) return "You are banned";
  if (user.status !== "AWAKE" || user.battleId)
    return "You must be awake and out of combat to change your companion.";
  return null;
};

/** Why a companion cannot be fed right now, ahead of any meal checks. */
const petFeedBlockMessage = (
  user: UserData | undefined,
  pet: UserPet | undefined,
  now: Date,
) => {
  const restriction = petMutationBlockMessage(user, pet);
  if (restriction || !user || !pet) return restriction ?? "Pet not found";
  if (pet.rank > getMaxPetRank(user.rank))
    return "Your rank does not support this companion rank.";
  if (!isPetAppearanceReady(pet))
    return "Finish your companion's appearance before feeding it.";
  const feedAvailableAt = getPetFeedAvailableAt(pet.lastFedAt);
  if (feedAvailableAt && feedAvailableAt > now)
    return `Feed this companion once every ${PET_FEED_COOLDOWN_HOURS} hours. Wait until its next feeding is available.`;
  return null;
};

/** Keep the validated rank, active identity and ability to mutate current at commit. */
const ownerMutationWhere = (user: UserData) => [
  eq(userData.isBanned, false),
  isNull(userData.battleId),
  user.activePetId
    ? eq(userData.activePetId, user.activePetId)
    : isNull(userData.activePetId),
  eq(userData.rank, user.rank),
  user.petTask
    ? sql`JSON_CONTAINS(${userData.petTask}, ${JSON.stringify(user.petTask)})`
    : isNull(userData.petTask),
];
/** Pin account identity and its monotonic revision alongside the domain guards. */
const ownerSnapshotWhere = (user: UserData, readiness?: ActionReadinessWrite) =>
  and(
    eq(userData.userId, user.userId),
    eq(userData.updatedAt, user.updatedAt),
    readiness?.where ?? eq(userData.status, "AWAKE"),
    ...ownerMutationWhere(user),
  );

/** Snapshot conflicts remain recoverable mutation results, not server exceptions. */
const changedResponse = () =>
  errorResponse("Your character or companion changed. Refresh and try again.");

/** Active release losing its pet snapshot must roll back the owner's XP reset. */
const petMutationConflict = () =>
  Object.assign(new Error("Companion snapshot changed"), {
    name: "PetMutationConflict",
  });
/** Recognize only the internal signal that requires the active-release rollback. */
const isPetMutationConflict = (error: unknown) =>
  error instanceof Error && error.name === "PetMutationConflict";

/** Publish a pet patch guarded by the owner and pet snapshots. */
const updateOwnedPet = async (
  client: DrizzleClient,
  user: UserData,
  pet: UserPet,
  patch: Partial<UserPet>,
  readiness?: ActionReadinessWrite,
) => {
  const now = new Date();
  const assignments = Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const column = userPet[key as keyof UserPet];
      // Use the column encoder just as Drizzle's set() does, including JSON,
      // nullable generation fields, booleans and millisecond timestamps.
      return sql`${column} = ${sql.param(value, column)}`;
    });
  // Drizzle cannot build a multi-table UPDATE. Both snapshot guards gate the
  // patch and the account claim together.
  const result = await retryOnDeadlock(() =>
    executeResultForUpdateOwnedPet(
      client,
      user,
      now,
      assignments,
      (snapshot) => ownerSnapshotWhere(snapshot, readiness),

      pet,
      readiness,
    ),
  );
  return result.rowsAffected > 0 ? now : undefined;
};
