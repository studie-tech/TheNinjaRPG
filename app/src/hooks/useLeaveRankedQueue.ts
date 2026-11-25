import { api } from "@/app/_trpc/client";
import { useRankedQueueCountCache } from "@/hooks/useRankedQueueCount";
import { showMutationToast } from "@/libs/toast";
import { useUserDataSelector } from "@/utils/UserContext";

/** Reconcile ranked exits from the arena or global notice against their captured profile. */
export const useLeaveRankedQueue = () => {
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useUserDataSelector((user) => user.userId);
  const { refreshRankedQueueCount } = useRankedQueueCountCache();

  return api.pvpRank.leaveRankedPvpQueue.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      void updateUser(data, { revision });
      if (data.success) {
        await Promise.all([
          utils.pvpRank.getRankedPvpQueue.invalidate(),
          refreshRankedQueueCount(),
        ]);
      }
    },
    onError: (_error, _variables, revision) => {
      void updateUser(undefined, { revision });
    },
    onSettled: (data) => {
      // A refused or unconfirmed exit may have raced matchmaking or another activity.
      if (!data?.success) void utils.raids.getQueuedActivity.invalidate();
    },
  });
};
