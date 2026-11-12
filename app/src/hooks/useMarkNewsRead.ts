import { useEffect, useRef } from "react";
import { api } from "@/app/_trpc/client";
import { clearNewsNotifications } from "@/deltas/forum";
import { useUserData } from "@/utils/UserContext";

/**
 * Mark the news read when the player opens the news board with unread news, and drop the
 * News badge from the cached profile once the server confirms it. Runs once per mount.
 */
export const useMarkNewsRead = () => {
  const { data: userData, notifications, updateNotifications } = useUserData();
  const hasRequested = useRef(false);
  const { mutate: readNews } = api.forum.readNews.useMutation();
  const unreadNews =
    notifications?.find((entry) => entry.href === "/news")?.notificationCount ?? 0;

  useEffect(() => {
    if (!userData || unreadNews <= 0 || hasRequested.current) return;
    hasRequested.current = true;
    readNews(undefined, {
      onSuccess: (result) => {
        if (result.success) void updateNotifications(clearNewsNotifications);
      },
    });
  }, [userData, unreadNews, readNews, updateNotifications]);
};
