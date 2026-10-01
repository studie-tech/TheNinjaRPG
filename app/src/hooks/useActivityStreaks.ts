import { api } from "@/app/_trpc/client";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { nextStreakRefreshAt } from "@/libs/activityStreak";
import { showMutationToast } from "@/libs/toast";

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

/** Every streak claim refreshes progress and the user snapshot affected by its cost/rewards. */
export const useClaimStreakDay = () => {
  const utils = api.useUtils();
  return api.activityStreak.claimStreakDay.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success)
        await Promise.allSettled([
          utils.activityStreak.getUserStreaks.invalidate(),
          utils.activityStreak.getAvailablePasses.invalidate(),
          utils.profile.getUser.invalidate(),
        ]);
    },
  });
};
