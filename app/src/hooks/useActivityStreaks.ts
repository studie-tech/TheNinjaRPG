import { api } from "@/app/_trpc/client";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { nextStreakRefreshAt } from "@/libs/activityStreak";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";

/** Share the streak cache and refresh when daily claim or continuity eligibility changes. */
export const useActivityStreaks = (enabled = true, timeDiff = 0) => {
  const query = api.activityStreak.getUserStreaks.useQuery(undefined, {
    enabled,
    staleTime: 300_000,
  });
  useRefreshAt(
    [nextStreakRefreshAt(query.data?.streaks ?? [], new Date(Date.now() - timeDiff))],
    () => {
      void query.refetch({ cancelRefetch: false });
    },
    timeDiff,
    enabled,
  );
  return query;
};

/** Claims reconcile progress and apply confirmed scalar rewards to the profile cache. */
export const useClaimStreakDay = () => {
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useUserData();
  return api.activityStreak.claimStreakDay.useMutation({
    onMutate: () => ({ userRevision: prepareUserUpdate() }),
    onSuccess: async (data, _variables, context) => {
      showMutationToast(data);
      if (data.success)
        await Promise.allSettled([
          utils.activityStreak.getUserStreaks.invalidate(),
          utils.activityStreak.getAvailablePasses.invalidate(),
          updateUser(data.userPatch, {
            revision: context?.userRevision,
            delta: data.userDelta,
          }),
        ]);
    },
  });
};
