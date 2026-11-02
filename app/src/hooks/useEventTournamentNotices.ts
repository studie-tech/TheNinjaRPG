import { getQueryKey } from "@trpc/react-query";
import type Pusher from "pusher-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import {
  getEventTournamentNoticePollInterval,
  getVisibleEventTournamentNotices,
} from "@/deltas/tournament";
import { useQueryCacheUpdate } from "@/hooks/useQueryCacheUpdate";
import { useRefreshAt } from "@/hooks/useRefreshAt";

/** Reconcile tournament notices after a confirmed event change, including a pending cold read. */
export const useEventTournamentNoticeCache = () => {
  const key = useMemo(
    () => getQueryKey(api.tournament.getEventNotices, undefined, "query"),
    [],
  );
  const { prepareUpdate, updateCache } =
    useQueryCacheUpdate<RouterOutputs["tournament"]["getEventNotices"]>(key);
  const refreshEventTournamentNotices = useCallback(
    () => updateCache(undefined, prepareUpdate()),
    [prepareUpdate, updateCache],
  );
  return { refreshEventTournamentNotices };
};

/** Discover remote invitations and ready checks while expiring prompts against the server clock. */
export const useEventTournamentNotices = ({
  enabled,
  isPageActive,
  timeDiff,
  pusher,
  userId,
}: {
  enabled: boolean;
  isPageActive: boolean;
  timeDiff: number;
  pusher: Pusher | undefined;
  userId: string | null | undefined;
}) => {
  const { refreshEventTournamentNotices } = useEventTournamentNoticeCache();
  const notices = api.tournament.getEventNotices.useQuery(undefined, {
    enabled: enabled && isPageActive,
    staleTime: 0,
    // Empty responses retain one-minute invitation discovery. A registered seat
    // between rounds does not need faster reads inside the ready-check window.
    refetchInterval: (query) =>
      getEventTournamentNoticePollInterval(!!query.state.data?.length),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const [now, setNow] = useState(() => Date.now());
  const deadlines = useMemo(
    () => notices.data?.map((notice) => notice.deadline) ?? [],
    [notices.data],
  );
  useEffect(() => {
    setNow(Date.now());
  }, [notices.dataUpdatedAt, enabled, isPageActive, timeDiff]);
  useRefreshAt(
    deadlines,
    () => {
      setNow(Date.now());
      void notices.refetch({ cancelRefetch: false });
    },
    timeDiff,
    enabled && isPageActive,
  );
  useEffect(() => {
    if (!enabled || !isPageActive || !pusher || !userId) return;
    // PusherHandler owns this user subscription. Its confirmation also follows
    // reconnects and closes the initial notice-read/subscription gap.
    const channel = pusher.channel(userId);
    const recover = () => void refreshEventTournamentNotices();
    channel?.bind("pusher:subscription_succeeded", recover);
    return () => {
      channel?.unbind("pusher:subscription_succeeded", recover);
    };
  }, [enabled, isPageActive, pusher, userId, refreshEventTournamentNotices]);
  // Reject a prompt that expires in flight or during a failed deadline refresh.
  return enabled
    ? getVisibleEventTournamentNotices(
        notices.data,
        Math.max(now, notices.dataUpdatedAt) - timeDiff,
      )
    : [];
};
