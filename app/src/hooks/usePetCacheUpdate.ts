import { hashKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterInputs, type RouterOutputs } from "@/app/_trpc/client";
import {
  getAssignedPetCollection,
  getAssignedPetExperience,
  getSavedPetSettings,
  getSavedPetSettingsCollection,
  getSavedPetSettingsOwnerPatch,
} from "@/deltas/pets";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import type { useUserInfo } from "@/utils/UserContext";

/** Reconcile committed companion settings and XP across the initiating pet view and shared collection. */
export const usePetCacheUpdate = (
  input: RouterInputs["pets"]["getPet"],
  userCache: Pick<ReturnType<typeof useUserInfo>, "prepareUserUpdate" | "updateUser">,
) => {
  const utils = api.useUtils();
  const pet = useQueryCacheUpdate<RouterOutputs["pets"]["getPet"]>(
    getQueryKey(api.pets.getPet, input, "query"),
  );
  const collection = useQueryCacheUpdate<RouterOutputs["pets"]["getCollection"]>(
    getQueryKey(api.pets.getCollection, undefined, "query"),
  );
  /** Capture the selected pet's query key and both revisions before allocating XP. */
  const preparePetUpdate = () => ({
    pet: pet.prepareUpdate(),
    collection: collection.prepareUpdate(),
  });
  /** Reconcile the captured pet and collection, refreshing other pet views and unsafe projections. */
  const updatePet = async (
    update: RouterOutputs["pets"]["assignExperience"]["petUpdate"],
    snapshot: ReturnType<typeof preparePetUpdate>,
  ) => {
    await Promise.all([
      utils.pets.getPet.invalidate(undefined, {
        predicate: (query) => hashKey(query.queryKey) !== hashKey(snapshot.pet.key),
      }),
      pet.updateCache(
        (current) => getAssignedPetExperience(current, update),
        snapshot.pet,
      ),
      collection.updateCache(
        (current) => getAssignedPetCollection(current, update),
        snapshot.collection,
      ),
    ]);
  };
  /** Capture account and pet caches together before a deterministic settings save. */
  const prepareSettingsUpdate = () => ({
    user: userCache.prepareUserUpdate(),
    pet: preparePetUpdate(),
  });
  /** Recover unknown outcomes; a matching account revision authorizes the public settings projection. */
  const updateSettings = async (
    result: RouterOutputs["pets"]["updatePet"],
    snapshot: ReturnType<typeof prepareSettingsUpdate>,
  ) => {
    const update = result.success ? result.petSettingsUpdate : undefined;
    const ownerApplied =
      update &&
      (await userCache.updateUser(
        (user) => getSavedPetSettingsOwnerPatch(user, update),
        { revision: snapshot.user },
      ));
    if (!update) await userCache.updateUser(result, { revision: snapshot.user });
    await Promise.all([
      utils.pets.getPet.invalidate(undefined, {
        predicate: (query) => hashKey(query.queryKey) !== hashKey(snapshot.pet.pet.key),
      }),
      pet.updateCache(
        (current) => getSavedPetSettings(current, ownerApplied ? update : undefined),
        snapshot.pet.pet,
      ),
      collection.updateCache(
        (current) =>
          getSavedPetSettingsCollection(current, ownerApplied ? update : undefined),
        snapshot.pet.collection,
      ),
    ]);
  };
  return { preparePetUpdate, updatePet, prepareSettingsUpdate, updateSettings };
};
