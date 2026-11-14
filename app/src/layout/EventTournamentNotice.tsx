"use client";

import { useEventTournamentNotices } from "@/hooks/useEventTournamentNotices";
import { usePageActive } from "@/hooks/usePageActive";
import Link from "@/layout/Link";
import { useUserDataSelector } from "@/utils/UserContext";

/** Persistent ready-check prompt also reaches participants away from the tournament page. */
export const EventTournamentNotice = () => {
  const {
    data: user,
    timeDiff,
    pusher,
    userId,
  } = useUserDataSelector((user) => user.userId);
  const isPageActive = usePageActive();
  const data = useEventTournamentNotices({
    enabled: !!user,
    isPageActive,
    timeDiff,
    pusher,
    userId,
  });
  if (!data?.length) return null;
  return (
    <aside
      aria-label="Tournament notifications"
      className="fixed inset-x-3 bottom-[calc(var(--game-bottom-nav-h,0.5rem)+0.5rem)] z-40 mx-auto max-w-lg space-y-2 rounded-lg border border-orange-500 bg-background p-3 shadow-xl"
    >
      {data.map((notice) => (
        <Link
          className="block text-sm"
          key={notice.tournamentId}
          href={`/tournaments/${notice.tournamentId}`}
        >
          <b>
            {notice.message}: {notice.name}
          </b>
          <span className="block text-orange-500 underline">
            Respond by {new Date(notice.deadline).toLocaleString()}
          </span>
        </Link>
      ))}
    </aside>
  );
};
