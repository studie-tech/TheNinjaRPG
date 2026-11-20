import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { nextUtcDayAt } from "@/utils/time";

/** Keep the shared welcome edition fresh at publication windows and UTC rollover. */
export const useSplash = (enabled: boolean, timeDiff = 0) => {
  const utils = api.useUtils();
  const [mountedAt] = useState(() => new Date(Date.now() - timeDiff));
  const [utcRefreshStartedAt, setUtcRefreshStartedAt] = useState<Date>();
  const query = api.splash.get.useQuery(undefined, { enabled, staleTime: 300_000 });
  // A pending midnight stays fixed through rerenders in the scheduler's grace window.
  const snapshotAt = query.data?.fetchedAt ?? mountedAt;
  const utcReferenceAt =
    utcRefreshStartedAt && utcRefreshStartedAt > snapshotAt
      ? utcRefreshStartedAt
      : snapshotAt;
  useRefreshAt(
    [query.data?.nextChangeAt, nextUtcDayAt(utcReferenceAt)],
    () => {
      const startedAt = new Date(Date.now() - timeDiff);
      // Cancel even an initial fetch: it may have read the board before this boundary.
      void utils.splash.get
        .cancel()
        .then(() => query.refetch({ cancelRefetch: true }))
        .finally(() =>
          setUtcRefreshStartedAt((current) =>
            current && current > startedAt ? current : startedAt,
          ),
        );
    },
    timeDiff,
    enabled,
    query.data?.fetchedAt,
  );
  return query;
};

/** Reconcile the archive, review counts and live board after confirmed editorial mutations. */
export const useSplashMutations = (feedback: {
  onSuccess: (
    result: { success: boolean; message: string },
    createdId?: string,
  ) => void;
  onError: (error: { message: string }) => void;
}) => {
  const utils = api.useUtils();
  const reconcile = async (
    result: { success: boolean; message: string },
    created = false,
  ) => {
    feedback.onSuccess(result, created && result.success ? result.message : undefined);
    if (result.success)
      await Promise.all([
        utils.splash.get.invalidate(),
        utils.splash.getForEdit.invalidate(),
        utils.contentReview.getQueue.invalidate(),
        utils.contentReview.getCounts.invalidate(),
      ]);
  };
  const create = api.splash.create.useMutation({
    onSuccess: (result) => reconcile(result, true),
    onError: feedback.onError,
  });
  const update = api.splash.update.useMutation({
    onSuccess: (result) => reconcile(result),
    onError: feedback.onError,
  });
  const setEnabled = api.splash.setEnabled.useMutation({
    onSuccess: (result) => reconcile(result),
    onError: feedback.onError,
  });
  return { create, update, setEnabled };
};
