import { useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { getTerritoryWarNoticePollInterval } from "@/deltas/territoryWar";
import { useRefreshAt } from "@/hooks/useRefreshAt";

/** Share the notice query and recover missed openings on deadlines, focus and reconnect. */
export const useTerritoryWarNotice = (
  enabled: boolean,
  timeDiff: number,
  isPageActive: boolean,
) => {
  const notice = api.territoryWar.getNotice.useQuery(undefined, {
    enabled: enabled && isPageActive,
    staleTime: 30_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    // The scheduler can be late or have no eligible sector/guardian. Keep discovering
    // every 30 seconds once an opening is due, including after a failed boundary read.
    refetchInterval: (query) =>
      getTerritoryWarNoticePollInterval(query.state.data, Date.now() - timeDiff),
    refetchIntervalInBackground: false,
  });
  const [now, setNow] = useState(() => Date.now());
  const endsAt = notice.data?.event?.endsAt.getTime();
  const nextStartsAt = notice.data?.nextStartsAt?.getTime();
  const deadlines = useMemo(() => [endsAt, nextStartsAt], [endsAt, nextStartsAt]);
  useEffect(() => {
    setNow(Date.now());
  }, [endsAt, nextStartsAt, timeDiff, isPageActive, enabled]);
  useRefreshAt(
    deadlines,
    () => {
      setNow(Date.now());
      void notice.refetch({ cancelRefetch: false });
    },
    timeDiff,
    enabled && isPageActive,
  );
  // Receipt time rejects notices that expired while their request was in flight.
  const event = notice.data?.event;
  return enabled &&
    event &&
    event.endsAt.getTime() > Math.max(now, notice.dataUpdatedAt) - timeDiff
    ? event
    : null;
};
