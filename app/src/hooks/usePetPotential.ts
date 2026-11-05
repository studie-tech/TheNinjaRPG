import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";
import type { UserDeltaResponse } from "@/validators/userCache";

/** Reconcile potential and two-companion transfers across every affected owner view. */
export const usePetPotential = () => {
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const [message, setMessage] = useState<string | null>(null);
  // Potential and transfers can change multiple pet views; reconcile canonical snapshots.
  const refresh = () =>
    Promise.all([
      utils.pets.getPet.invalidate(),
      utils.pets.getCollection.invalidate(),
    ]);
  const options = {
    onMutate: prepareUserUpdate,
    onSuccess: async (
      result: UserDeltaResponse,
      _input: unknown,
      revision: number | undefined,
    ) => {
      setMessage(result.message);
      showMutationToast(result);
      await Promise.all([
        refresh(),
        result.success
          ? updateUser(result, { revision })
          : utils.profile.getUser.invalidate(),
      ]);
    },
    onError: async (error: { message: string }) => {
      setMessage(error.message);
      await Promise.all([refresh(), utils.profile.getUser.invalidate()]);
    },
  };
  const reveal = api.pets.revealPotential.useMutation(options);
  const allocate = api.pets.allocatePotential.useMutation(options);
  const transfer = api.pets.transferExperience.useMutation(options);
  return {
    reveal,
    allocate,
    transfer,
    message,
    isPending: reveal.isPending || allocate.isPending || transfer.isPending,
  };
};
