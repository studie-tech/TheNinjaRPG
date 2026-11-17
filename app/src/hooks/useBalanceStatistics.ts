import { api } from "@/app/_trpc/client";

/** Keep live counters and newly completed archive listings fresh across UTC period boundaries. */
export const balanceReportQueryOptions = {
  staleTime: 60_000,
  refetchInterval: 60_000,
} as const;

/** Reconcile every report affected by a confirmed statistics reset, including cached overview data. */
export const useBalanceStatisticsCache = () => {
  const utils = api.useUtils();
  return {
    refresh: () =>
      Promise.all([
        utils.data.getBalanceOverview.invalidate(),
        utils.data.getJutsuBalanceStatistics.invalidate(),
        utils.data.getItemBalanceStatistics.invalidate(),
        utils.data.getBloodlineBalanceStatistics.invalidate(),
        utils.data.getAiBalanceStatistics.invalidate(),
        utils.data.getStatistics.invalidate(),
      ]),
  };
};
