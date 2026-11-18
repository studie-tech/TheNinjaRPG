import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";

/** Bind staff overrides to the target account and refresh affected companion views after commit. */
export const useStaffPetPotential = (
  userId: string,
  isOpen: boolean,
  onSuccess: () => void,
  onMessage: (message: string) => void,
) => {
  const utils = api.useUtils();
  const pets = api.pets.getPotentialsForStaff.useQuery({ userId }, { enabled: isOpen });
  const mutation = api.pets.setPotentialForStaff.useMutation({
    onSuccess: async (result, input) => {
      onMessage(result.message);
      if (!result.success) return;
      showMutationToast(result);
      onSuccess();
      await Promise.all([
        utils.pets.getPotentialsForStaff.invalidate({ userId: input.userId }),
        utils.pets.getCollection.invalidate(),
        utils.pets.getPet.invalidate(),
      ]);
    },
    onError: (error) => onMessage(error.message),
  });
  return { pets, mutation };
};
