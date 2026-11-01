import { hashKey } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { api, type RouterInputs, type RouterOutputs } from "@/app/_trpc/client";
import { getAssignedPetCollection, getAssignedPetExperience } from "@/deltas/pets";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";

/** Reconcile committed pet XP across the initiating pet view and shared collection. */
export const usePetCacheUpdate = (input: RouterInputs["pets"]["getPet"]) => {
  const utils = api.useUtils();
  const pet = useQueryCacheUpdate<RouterOutputs["pets"]["getPet"]>(
    getQueryKey(api.pets.getPet, input, "query"),
  );
  const collection = useQueryCacheUpdate<RouterOutputs["pets"]["getCollection"]>(
    getQueryKey(api.pets.getCollection, undefined, "query"),
  );
  const preparePetUpdate = () => ({
    pet: pet.prepareUpdate(),
    collection: collection.prepareUpdate(),
  });
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
  return { preparePetUpdate, updatePet };
};
