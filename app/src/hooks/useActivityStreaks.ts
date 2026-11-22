import { api } from "@/app/_trpc/client";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { nextStreakRefreshAt } from "@/libs/activityStreak";

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
