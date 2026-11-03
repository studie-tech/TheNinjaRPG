import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getClaimedStreaks } from "@/deltas/activityStreak";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { nextStreakRefreshAt } from "@/libs/activityStreak";
import { showMutationToast } from "@/libs/toast";
import { useUserInfo } from "@/utils/UserContext";

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
  const streaks = useQueryCacheUpdate<
    RouterOutputs["activityStreak"]["getUserStreaks"]
  >(getQueryKey(api.activityStreak.getUserStreaks, undefined, "query"));
  const { prepareUserUpdate, updateUser, timeDiff } = useUserInfo();
  return api.activityStreak.claimStreakDay.useMutation({
    onMutate: () => ({
      userRevision: prepareUserUpdate(),
      streaks: streaks.prepareUpdate(),
    }),
    onSuccess: async (data, _variables, context) => {
      showMutationToast(data);
      if (data.success)
        await Promise.allSettled([
          streaks.updateCache(
            data.streakUpdate
              ? (current) =>
                  getClaimedStreaks(
                    current,
                    data.streakUpdate!,
                    new Date(Date.now() - timeDiff),
                  )
              : undefined,
            context.streaks,
          ),
          // Claims retain permanent pass ownership; only unsupported responses need that list again.
          ...(data.streakUpdate
            ? []
            : [utils.activityStreak.getAvailablePasses.invalidate()]),
          updateUser(data.userPatch, {
            revision: context?.userRevision,
            delta: data.userDelta,
          }),
        ]);
    },
  });
};
