"use client";

import { MAX_PLAYER_LEVEL } from "@/drizzle/constants";
import {
  buildFilter,
  ContentFiltering,
  defineFilteringSchema,
  useContentFiltering,
} from "@/layout/ContentFiltering";

interface RankedRankDistributionFilteringProps {
  state: RankedRankDistributionFilteringState;
}

const makeSchema = () =>
  defineFilteringSchema({
    fields: [
      {
        id: "minCount",
        label: "Minimum Count",
        type: "number",
        defaultValue: undefined,
        normalizeForFilter: (v) => (v !== undefined && v >= 1 ? v : undefined),
      },
      {
        id: "minLevel",
        label: "Min Level",
        type: "number",
        defaultValue: undefined,
        min: 1,
        max: MAX_PLAYER_LEVEL,
      },
      {
        id: "maxLevel",
        label: "Max Level",
        type: "number",
        defaultValue: undefined,
        min: 1,
        max: MAX_PLAYER_LEVEL,
      },
    ] as const,
  });

const RankedRankDistributionFiltering: React.FC<
  RankedRankDistributionFilteringProps
> = (props) => {
  return (
    <ContentFiltering
      schema={makeSchema()}
      state={props.state.cf}
      triggerButtonId="filter-ranked-rank-dist"
    />
  );
};

export default RankedRankDistributionFiltering;

export const getFilter = (state: RankedRankDistributionFilteringState) =>
  buildFilter(state.cf, makeSchema());

export const useFiltering = () => {
  const cf = useContentFiltering(makeSchema());
  return {
    ...cf.values,
    cf,
  };
};

export type RankedRankDistributionFilteringState = ReturnType<typeof useFiltering>;
