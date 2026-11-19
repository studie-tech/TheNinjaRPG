import { api } from "@/app/_trpc/client";
import { useRefreshAt } from "@/hooks/useRefreshAt";
import { nextUtcDayAt } from "@/utils/time";

/** Keep the shared welcome edition fresh at publication windows and UTC rollover. */
export const useSplash = (enabled: boolean, timeDiff = 0) => {
  const query = api.splash.get.useQuery(undefined, { enabled, staleTime: 300_000 });
  useRefreshAt(
    [query.data?.nextChangeAt, nextUtcDayAt(new Date(Date.now() - timeDiff))],
    () => {
      void query.refetch({ cancelRefetch: false });
    },
    timeDiff,
    enabled,
    query.data?.fetchedAt,
  );
  return query;
};

/** Reconcile both staff and player copies after the server confirms publication. */
export const useSaveSplash = (feedback: {
  onSuccess: (result: { success: boolean; message: string }) => void;
  onError: (error: { message: string }) => void;
}) => {
  const utils = api.useUtils();
  return api.splash.update.useMutation({
    onSuccess: async (result) => {
      feedback.onSuccess(result);
      if (result.success)
        await Promise.all([
          utils.splash.get.invalidate(),
          utils.splash.getForEdit.invalidate(),
        ]);
    },
    onError: feedback.onError,
  });
};
