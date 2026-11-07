import type React from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { GroupedBarHistogram } from "@/layout/GroupedBarHistogram";
import QueueLengthFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/QueueLengthFiltering";
import { showMutationToast } from "@/libs/toast";

export const QueueLengthHistogram: React.FC = () => {
  const filteringState = useFiltering();
  const filter = getFilter(filteringState);
  const utils = api.useUtils();

  const { data } = api.data.getQueueLengthStatistics.useQuery(filter);

  const { mutate: clearAllQueueLengths } = api.data.clearAllQueueLengths.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        await utils.data.getQueueLengthStatistics.invalidate();
      }
    },
  });

  return (
    <GroupedBarHistogram
      title="Queue Lengths"
      subtitle="Distribution of queue wait times"
      rows={data}
      toPoint={toPoint}
      xLabel="Minutes"
      yLabel="Number of Queues"
      filter={<QueueLengthFiltering state={filteringState} />}
      clearTitle="Clear All Queue Length Data"
      clearText="Are you sure you want to clear all queue length data? This action cannot be undone and will reset all queue length statistics. This action will be logged for future audit and review."
      onClear={() => clearAllQueueLengths()}
      emptyText="No queue length data available."
      canvasId="queueLengthHistogram"
    />
  );
};

/** Adapt queue wait counts into the shared histogram's ranked-tier series. */
const toPoint = (row: RouterOutputs["data"]["getQueueLengthStatistics"][number]) => ({
  group: row.rankedRank,
  x: row.ceiledMinutes,
  y: row.count,
});
