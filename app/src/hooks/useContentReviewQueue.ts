import { useEffect, useRef } from "react";
import { api, type RouterInputs } from "@/app/_trpc/client";
import { useRequiredUserInfo } from "@/utils/UserContext";
import { withContentReviewCount } from "@/utils/userNotificationCounts";

/** Consume each queue page's outdating notice once and share confirmed counts with navigation. */
export const useContentReviewQueue = (
  input: RouterInputs["contentReview"]["getQueue"],
  enabled: boolean,
) => {
  const utils = api.useUtils();
  const { updateNotifications } = useRequiredUserInfo();
  const counts = api.contentReview.getCounts.useQuery();
  const queue = api.contentReview.getQueue.useInfiniteQuery(input, {
    enabled,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const consumedReads = useRef(
    new Map<string, { updatedAt: number; pageCount: number }>(),
  );
  const key = JSON.stringify(input);

  useEffect(() => {
    if (!enabled || !queue.data) return;
    const previous = consumedReads.current.get(key);
    if (previous?.updatedAt === queue.dataUpdatedAt) return;
    const pages = queue.data.pages;
    consumedReads.current.set(key, {
      updatedAt: queue.dataUpdatedAt,
      pageCount: pages.length,
    });
    // Forward pagination keeps existing pages; a refetch reads the whole loaded queue.
    const receivedPages =
      previous && pages.length > previous.pageCount
        ? pages.slice(previous.pageCount)
        : pages;
    if (!receivedPages.some((page) => page.outdatedCount > 0)) return;
    // The observed counts query owns errors and retries; retained queue pages must not repeat the read.
    void utils.contentReview.getCounts.invalidate();
  }, [enabled, key, queue.data, queue.dataUpdatedAt, utils]);

  useEffect(() => {
    if (!counts.data) return;
    const pending = counts.data.canReview ? (counts.data.statuses.PENDING ?? 0) : 0;
    void updateNotifications((current) => withContentReviewCount(current, pending));
  }, [counts.data, updateNotifications]);

  return { counts: counts.data, queue };
};
