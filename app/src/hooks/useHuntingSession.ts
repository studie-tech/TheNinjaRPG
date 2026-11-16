import { api } from "@/app/_trpc/client";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { huntingRefetchInterval } from "@/libs/hunting/contracts";
import { useUserInfo } from "@/utils/UserContext";

/** Load the caller's hunting encounter, refreshing it when preparation or cooldown ends. */
export const useHuntingSession = (enabled: boolean) => {
  const { timeDiff } = useUserInfo();
  const query = api.hunting.getSession.useQuery(undefined, {
    enabled,
    refetchInterval: (q) => huntingRefetchInterval(q.state.data),
    refetchOnMount: "always",
  });
  useRefreshAt(
    [query.data?.session.readyAt, query.data?.cooldownUntil],
    () => void query.refetch(),
    timeDiff,
    enabled,
    query.data?.serverTime,
  );
  return query;
};
