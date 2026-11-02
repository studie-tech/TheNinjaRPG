import { useEffect, useMemo } from "react";
import { api } from "@/app/_trpc/client";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { DAY_S } from "@/utils/time";

/** Discover participation slowly; keep visible war progress and known deadlines current. */
export const useActiveWars = (
  villageId: string,
  {
    enabled = true,
    polling = false,
    timeDiff = 0,
  }: {
    enabled?: boolean;
    polling?: "discovery" | "live" | false;
    timeDiff?: number;
  } = {},
) => {
  const query = api.war.getActiveWars.useQuery(
    { villageId },
    {
      enabled,
      staleTime: 10_000,
      refetchInterval:
        polling === "live" ? 10_000 : polling === "discovery" ? 60_000 : false,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: "always",
      refetchOnReconnect: "always",
      notifyOnChangeProps: ["data"],
    },
  );
  const { refetch } = query;
  useEffect(() => {
    // Opening a live surface refreshes a discovery snapshot immediately.
    if (enabled && polling === "live") void refetch({ cancelRefetch: false });
  }, [enabled, polling, refetch]);
  const deadlines = useMemo(
    () =>
      query.data?.flatMap((war) => [
        war.combatStartedAt,
        war.combatStartedAt && war.rules
          ? war.combatStartedAt.getTime() + war.rules.durationDays * DAY_S * 1000
          : null,
      ]) ?? [],
    [query.data],
  );
  useRefreshAt(
    deadlines,
    () => void refetch({ cancelRefetch: false }),
    timeDiff,
    enabled,
  );
  return query;
};
