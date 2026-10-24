"use client";

import { api } from "@/app/_trpc/client";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import { useUserData } from "@/utils/UserContext";

export const TerritoryWarNotice = () => {
  const { data: user, timeDiff } = useUserData();
  const current = api.territoryWar.getNotice.useQuery(undefined, {
    enabled: !!user,
    refetchInterval: 30000,
  });
  useRefreshAt([current.data?.endsAt], () => void current.refetch(), timeDiff);
  if (!current.data || current.data.endsAt.getTime() <= Date.now() - timeDiff)
    return null;
  return (
    <aside
      className="mb-3 rounded-lg border border-orange-500 bg-popover p-3 text-sm"
      aria-label="Territory War announcement"
    >
      <Link href="/territory-war" className="flex flex-wrap justify-between gap-2">
        <b>Territory War · Sector {current.data.sector}</b>
        <span>
          Ends in <Countdown targetDate={current.data.endsAt} timeDiff={timeDiff} /> ·
          View teams and standings →
        </span>
      </Link>
    </aside>
  );
};
