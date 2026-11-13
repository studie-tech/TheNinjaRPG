import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserInfo } from "@/utils/UserContext";

/** Save a mastery queue edit, toasting its outcome and keeping the last rejection for display. */
export const useMasteryTrainingQueue = () => {
  const { prepareUserUpdate, updateUser } = useRequiredUserInfo();
  const [error, setError] = useState<string | null>(null);
  const { mutate: saveQueue, isPending } =
    api.train.updateMasteryTrainingQueue.useMutation({
      onMutate: () => ({ revision: prepareUserUpdate() }),
      onSuccess: (result) => {
        showMutationToast(result);
        setError(result.success ? null : result.message);
      },
      onError: (cause) => setError(cause.message),
      onSettled: (result, _error, _variables, context) =>
        updateUser(result, {
          revision: context?.revision,
          achievementProgress: result?.achievementProgress,
        }),
    });
  return { saveQueue, isPending, error };
};
