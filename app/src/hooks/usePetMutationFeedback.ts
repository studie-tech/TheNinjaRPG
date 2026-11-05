import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import type { useUserInfo } from "@/utils/UserContext";
import type { UserDeltaResponse } from "@/validators/userCache";

/** Inline feedback and cache recovery for pet mutations that answer with a user update. */
export const usePetMutationFeedback = ({
  setMessage,
  updateUser,
}: {
  setMessage: (message: string | null) => void;
  updateUser: ReturnType<typeof useUserInfo>["updateUser"];
}) => {
  const utils = api.useUtils();
  /** Reconcile pet views after a committed or uncertain mutation. */
  const invalidatePetData = async () => {
    await Promise.all([
      utils.pets.getPet.invalidate(),
      utils.pets.getCollection.invalidate(),
    ]);
  };
  const finishMutation = async (
    result: UserDeltaResponse,
    _variables: unknown,
    revision: number | undefined,
  ) => {
    setMessage(result.success ? null : result.message);
    showMutationToast(result);
    await Promise.all([
      invalidatePetData(),
      result.success
        ? updateUser(result, { revision })
        : utils.profile.getUser.invalidate(),
    ]);
  };
  const failMutation = async (cause: { message: string }) => {
    setMessage(cause.message);
    // A failed response can follow a committed write; reload before offering it again.
    await Promise.all([invalidatePetData(), utils.profile.getUser.invalidate()]);
  };
  return { invalidatePetData, finishMutation, failMutation };
};
