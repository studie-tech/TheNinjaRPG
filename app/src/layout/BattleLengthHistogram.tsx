import type React from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { BattleTypeLabels } from "@/drizzle/constants";
import BattleLengthFiltering, {
  getFilter,
  useFiltering,
} from "@/layout/BattleLengthFiltering";
import { GroupedBarHistogram } from "@/layout/GroupedBarHistogram";
import { showMutationToast } from "@/libs/toast";

export const BattleLengthHistogram: React.FC = () => {
  const filteringState = useFiltering();
  const filter = getFilter(filteringState);
  const utils = api.useUtils();

  const { data } = api.data.getBattleLengthStatistics.useQuery(filter);

  const { mutate: clearAllBattleLengths } = api.data.clearAllBattleLengths.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success) {
        await utils.data.getBattleLengthStatistics.invalidate();
      }
    },
  });

  return (
    <GroupedBarHistogram
      title="Battle Lengths"
      subtitle="Distribution of battle durations"
      rows={data}
      toPoint={toPoint}
      xLabel="Rounds"
      yLabel="Share of battles of that type (%)"
      filter={<BattleLengthFiltering state={filteringState} />}
      clearTitle="Clear All Battle Length Data"
      clearText="Are you sure you want to clear all battle length data? This action cannot be undone and will reset all battle length statistics. This action will be logged for future audit and review."
      onClear={() => clearAllBattleLengths()}
      emptyText="No battle length data available."
      canvasId="battleLengthHistogram"
    />
  );
};

/**
 * Adapt round counts into the shared histogram's battle-type series. Each type's counts are
 * normalized to a share of that type's battles, shown as a percentage.
 */
const toPoint = (row: RouterOutputs["data"]["getBattleLengthStatistics"][number]) => ({
  group: BattleTypeLabels[row.battleType],
  x: row.rounds,
  y: Math.round(row.normalized * 1000) / 10,
});
