import { getQueryKey } from "@trpc/react-query";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { getClaimedStreaks } from "@/deltas/activityStreak";
import { useTutorialStep } from "@/hooks/tutorial";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { showMutationToast } from "@/libs/toast";
import { useUserInfo } from "@/utils/UserContext";

// Kept apart from useActivityStreaks, which the shell layout loads on every page: the
// tutorial hooks this claim completes must stay out of that bundle.
/** Claims reconcile progress and apply confirmed scalar rewards to the profile cache. */
export const useClaimStreakDay = () => {
  const utils = api.useUtils();
  const streaks = useQueryCacheUpdate<
    RouterOutputs["activityStreak"]["getUserStreaks"]
  >(getQueryKey(api.activityStreak.getUserStreaks, undefined, "query"));
  const { prepareUserUpdate, updateUser, timeDiff } = useUserInfo();
  const { completeTutorialAction } = useTutorialStep();
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
      // The Academy Trials end with the first claim on the Dashboard.
      if (data.success) await completeTutorialAction("claimStreak");
    },
  });
};
