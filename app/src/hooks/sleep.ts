import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { useUserInfo } from "@/utils/UserContext";

/**
 * Toggle sleep from any page using the shared user-cache revision guard.
 * A late response reconciles newer cache state instead of overwriting it.
 */
export const useSleepToggle = () => {
  const { prepareUserUpdate, updateUser } = useUserInfo();

  const { mutate: toggleSleep, isPending: isTogglingSleep } =
    api.home.toggleSleep.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        if (data.success && data.newStatus) {
          await updateUser({ status: data.newStatus }, { revision });
        } else {
          showMutationToast(data);
        }
      },
    });

  return {
    toggleSleep,
    isTogglingSleep,
  };
};
